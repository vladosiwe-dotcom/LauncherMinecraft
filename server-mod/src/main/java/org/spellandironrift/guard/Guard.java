package org.spellandironrift.guard;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.PlayerList;
import net.minecraft.server.players.ServerOpListEntry;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** Rift-only authentication for offline-mode Minecraft servers. */
public final class Guard {
    private record Verdict(boolean allowed, String nick, String role, String reason, String banReason) {}
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private static final Gson GSON = new Gson();
    private static final Map<UUID, Long> PENDING = new ConcurrentHashMap<>();
    private static final Map<UUID, Verdict> CURRENT = new ConcurrentHashMap<>();
    private static final Set<String> managedOps = new HashSet<>();
    private static boolean active;
    private static int ticks;

    private Guard() {}

    private static Path opsFile() { return GuardConfig.file().resolveSibling("spellironrift-guard-ops.json"); }

    @SubscribeEvent
    public static void registerPayloads(RegisterPayloadHandlersEvent event) {
        event.registrar("1").playToServer(AuthTicketPayload.TYPE, AuthTicketPayload.STREAM_CODEC, Guard::handleTicket);
    }

    @SubscribeEvent
    public static void onStarted(ServerStartedEvent event) {
        try {
            if (Files.isRegularFile(opsFile())) {
                Set<String> loaded = GSON.fromJson(Files.readString(opsFile()), Set.class);
                if (loaded != null) managedOps.addAll(loaded);
            }
        } catch (Exception e) {
            GuardMod.LOG.warn("Could not load managed operator list: {}", e.toString());
        }
        active = true;
        if (!GuardConfig.enabled()) {
            GuardMod.LOG.error("Rift Guard is FAIL-CLOSED: configure apiBase, serverKey and serverId in {}", GuardConfig.file());
        } else {
            GuardMod.LOG.info("Rift Guard enabled; serverId={}", GuardConfig.get().serverId);
        }
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (!active || !(event.getEntity() instanceof ServerPlayer player)) return;
        PENDING.put(player.getUUID(), System.currentTimeMillis());
        player.setInvulnerable(true);
        if (!GuardConfig.enabled()) {
            deny(player, "Rift authentication is not configured on this server.");
            return;
        }
        GuardMod.LOG.info("Waiting for Rift ticket from {}", player.getGameProfile().getName());
    }

    @SubscribeEvent
    public static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        PENDING.remove(event.getEntity().getUUID());
        CURRENT.remove(event.getEntity().getUUID());
    }

    private static void handleTicket(AuthTicketPayload payload, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)) return;
        UUID id = player.getUUID();
        if (!PENDING.containsKey(id)) {
            deny(player, "Unexpected or repeated Rift authentication packet.");
            return;
        }
        String ticket = payload.ticket();
        if (ticket == null || ticket.length() < 32 || ticket.length() > 256) {
            deny(player, "Invalid Rift game ticket.");
            return;
        }
        PENDING.remove(id);
        consumeTicket(player, ticket);
    }

    private static void consumeTicket(ServerPlayer player, String ticket) {
        GuardConfig.Values cfg = GuardConfig.get();
        JsonObject body = new JsonObject();
        body.addProperty("ticket", ticket);
        body.addProperty("serverId", cfg.serverId);
        body.addProperty("nick", player.getGameProfile().getName());
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(cfg.apiBase.replaceAll("/$", "") + "/api/server/auth/consume"))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .header("x-rift-server-key", cfg.serverKey)
                    .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body), StandardCharsets.UTF_8))
                    .build();
        } catch (Exception e) {
            deny(player, "Rift authentication endpoint is misconfigured.");
            return;
        }
        MinecraftServer server = player.server;
        HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
                .thenApply(response -> {
                    if (response.statusCode() != 200) throw new IllegalStateException("Rift backend HTTP " + response.statusCode());
                    return GSON.fromJson(response.body(), JsonObject.class);
                })
                .whenComplete((json, error) -> server.execute(() -> {
                    if (player.hasDisconnected()) return;
                    if (error != null || json == null || !json.has("allowed") || !json.get("allowed").getAsBoolean()) {
                        String reason = "Authentication rejected";
                        if (json != null && json.has("reason")) reason = json.get("reason").getAsString();
                        deny(player, error == null ? "Rift login rejected: " + reason : "Rift account service unavailable. Try again.");
                        GuardMod.LOG.warn("Rift authentication failed for {}: {}", player.getGameProfile().getName(), error == null ? reason : error.toString());
                        return;
                    }
                    String nick = json.has("nick") ? json.get("nick").getAsString() : player.getGameProfile().getName();
                    String role = json.has("role") ? json.get("role").getAsString() : "player";
                    CURRENT.put(player.getUUID(), new Verdict(true, nick, role, null, null));
                    player.setInvulnerable(false);
                    applyRole(server, player, role);
                    player.refreshDisplayName();
                    player.refreshTabListName();
                    GuardMod.LOG.info("Rift authenticated {} as {} ({})", player.getGameProfile().getName(), nick, role);
                }));
    }

    @SubscribeEvent
    public static void onTick(ServerTickEvent.Post event) {
        if (!active) return;
        long now = System.currentTimeMillis();
        for (ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            Long since = PENDING.get(player.getUUID());
            if (since != null && now - since > 10_000) {
                PENDING.remove(player.getUUID());
                deny(player, "Rift authentication timed out. Start the game through the Rift launcher.");
            }
        }
    }

    @SubscribeEvent
    public static void onName(PlayerEvent.NameFormat event) {
        Verdict verdict = CURRENT.get(event.getEntity().getUUID());
        if (verdict != null && verdict.allowed()) event.setDisplayname(Component.literal(verdict.nick()));
    }

    @SubscribeEvent
    public static void onTabName(PlayerEvent.TabListNameFormat event) {
        Verdict verdict = CURRENT.get(event.getEntity().getUUID());
        if (verdict != null && verdict.allowed()) event.setDisplayName(Component.literal(verdict.nick()));
    }

    private static void applyRole(MinecraftServer server, ServerPlayer player, String role) {
        PlayerList list = server.getPlayerList();
        ServerOpListEntry current = list.getOps().get(player.getGameProfile());
        int level = "admin".equals(role) ? GuardConfig.get().adminOpLevel : "moderator".equals(role) ? GuardConfig.get().moderatorOpLevel : 0;
        String key = player.getUUID().toString();
        if (level > 0) {
            if (current == null || current.getLevel() != level) {
                if (current == null || managedOps.contains(key)) {
                    list.getOps().add(new ServerOpListEntry(player.getGameProfile(), level, false));
                    managedOps.add(key);
                    saveOps();
                    list.sendPlayerPermissionLevel(player);
                }
            }
        } else {
            removeManagedOp(list, player);
            list.sendPlayerPermissionLevel(player);
        }
    }

    private static void removeManagedOp(PlayerList list, ServerPlayer player) {
        if (managedOps.remove(player.getUUID().toString())) {
            list.getOps().remove(player.getGameProfile());
            saveOps();
        }
    }

    private static void saveOps() {
        try {
            Path file = opsFile();
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(managedOps), StandardCharsets.UTF_8);
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            GuardMod.LOG.warn("Could not save managed operators: {}", e.toString());
        }
    }

    private static void deny(ServerPlayer player, String message) {
        PENDING.remove(player.getUUID());
        CURRENT.remove(player.getUUID());
        player.connection.disconnect(Component.literal(message));
    }
}
