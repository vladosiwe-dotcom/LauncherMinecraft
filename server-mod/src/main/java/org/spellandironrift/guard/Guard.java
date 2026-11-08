package org.spellandironrift.guard;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import com.mojang.authlib.GameProfile;
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
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Checks every joining player against Spell and Iron Rift accounts.
 *
 * <p>The player's UUID is trustworthy only on an online-mode server, where Mojang has verified it during the
 * login handshake; the guard therefore refuses to run with online-mode=false. For a verified UUID the account
 * server answers: allowed (nickname, role) or not (not registered / banned with a reason). Allowed players get
 * the role's operator level and their project nickname in chat and the player list; others are disconnected
 * with an explanation. Online players are re-checked periodically, so a ban or role change applies at once.
 */
@EventBusSubscriber(modid = GuardMod.MODID, value = Dist.DEDICATED_SERVER)
public final class Guard {
    private record Verdict(boolean allowed, String nick, String role, String reason, String banReason) {}

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private static final Gson GSON = new Gson();
    private static final Map<UUID, Verdict> CURRENT = new ConcurrentHashMap<>();
    private static Map<String, Verdict> cache = new ConcurrentHashMap<>();
    private static Set<String> managedOps = new HashSet<>();
    private static boolean active;
    private static int ticks;

    private Guard() {}

    private static Path cacheFile() { return FMLPaths.CONFIGDIR.get().resolve("spellironrift-guard-cache.json"); }
    private static Path opsFile() { return FMLPaths.CONFIGDIR.get().resolve("spellironrift-guard-ops.json"); }

    @SubscribeEvent
    public static void onStarted(ServerStartedEvent event) {
        MinecraftServer server = event.getServer();
        if (!GuardConfig.enabled()) {
            GuardMod.LOG.warn("Spell and Iron Rift Guard is off: set apiBase and serverKey in {}", GuardConfig.file());
            return;
        }
        if (!server.usesAuthentication()) {
            GuardMod.LOG.error("Spell and Iron Rift Guard needs online-mode=true: without Mojang's check a player UUID can be faked. The guard stays off.");
            return;
        }
        try {
            if (Files.isRegularFile(cacheFile())) cache = new ConcurrentHashMap<>(GSON.fromJson(Files.readString(cacheFile()), new TypeToken<Map<String, Verdict>>() {}.getType()));
            if (Files.isRegularFile(opsFile())) managedOps = new HashSet<>(GSON.fromJson(Files.readString(opsFile()), new TypeToken<Set<String>>() {}.getType()));
        } catch (Exception e) {
            GuardMod.LOG.warn("Guard cache unreadable, starting empty: {}", e.toString());
        }
        active = true;
        GuardMod.LOG.info("Spell and Iron Rift Guard is on ({})", GuardConfig.get().apiBase);
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (active && event.getEntity() instanceof ServerPlayer player) check(player);
    }

    @SubscribeEvent
    public static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        CURRENT.remove(event.getEntity().getUUID());
    }

    @SubscribeEvent
    public static void onTick(ServerTickEvent.Post event) {
        if (!active) return;
        if (++ticks < Math.max(10, GuardConfig.get().recheckSeconds) * 20) return;
        ticks = 0;
        for (ServerPlayer p : event.getServer().getPlayerList().getPlayers()) check(p);
    }

    /** Project nickname in chat, above the head and in the player list. */
    @SubscribeEvent
    public static void onName(PlayerEvent.NameFormat event) {
        Verdict v = CURRENT.get(event.getEntity().getUUID());
        if (v != null && v.allowed() && v.nick() != null) event.setDisplayname(Component.literal(v.nick()));
    }

    @SubscribeEvent
    public static void onTabName(PlayerEvent.TabListNameFormat event) {
        Verdict v = CURRENT.get(event.getEntity().getUUID());
        if (v != null && v.allowed() && v.nick() != null) event.setDisplayName(Component.literal(v.nick()));
    }

    private static void check(ServerPlayer player) {
        UUID id = player.getUUID();
        MinecraftServer server = player.server;
        lookup(id).whenComplete((verdict, error) -> server.execute(() -> {
            if (player.hasDisconnected()) return;
            Verdict v = verdict;
            if (v == null) { // account server unreachable
                Verdict cached = cache.get(id.toString());
                v = GuardConfig.get().useCacheWhenOffline && cached != null ? cached
                        : new Verdict(false, null, null, "unreachable", null);
            } else {
                cache.put(id.toString(), v);
                save(cacheFile(), cache);
            }
            apply(server, player, v);
        }));
    }

    private static CompletableFuture<Verdict> lookup(UUID id) {
        GuardConfig.Values c = GuardConfig.get();
        HttpRequest req = HttpRequest.newBuilder(URI.create(c.apiBase.replaceAll("/$", "") + "/api/server/players/" + id))
                .header("x-rift-server-key", c.serverKey).timeout(Duration.ofSeconds(10)).GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(res -> {
            if (res.statusCode() != 200) {
                GuardMod.LOG.error("Account server answered {} for {}; check serverKey", res.statusCode(), id);
                return (Verdict) null;
            }
            JsonObject o = GSON.fromJson(res.body(), JsonObject.class);
            boolean allowed = o.has("allowed") && o.get("allowed").getAsBoolean();
            return new Verdict(allowed, str(o, "nick"), str(o, "role"), str(o, "reason"), str(o, "banReason"));
        }).exceptionally(e -> null);
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null;
    }

    private static void apply(MinecraftServer server, ServerPlayer player, Verdict v) {
        PlayerList list = server.getPlayerList();
        GameProfile profile = player.getGameProfile();
        if (!v.allowed()) {
            CURRENT.remove(player.getUUID());
            removeManagedOp(list, profile);
            Component msg = switch (v.reason() == null ? "" : v.reason()) {
                // literal text: players do not have this server-only mod, so translation keys would show raw
                case "banned" -> Component.literal("Аккаунт Spell and Iron Rift заблокирован / account banned.\nПричина / reason: "
                        + (v.banReason() == null || v.banReason().isBlank() ? "—" : v.banReason()));
                case "unreachable" -> Component.literal("Сервер аккаунтов недоступен, попробуйте через минуту.\nThe account server is unavailable, try again in a minute.");
                default -> Component.literal("Нужен аккаунт Spell and Iron Rift: зарегистрируйтесь и войдите через лаунчер.\nA Spell and Iron Rift account is required: register in the launcher.");
            };
            player.connection.disconnect(msg);
            GuardMod.LOG.info("Refused {} ({}): {}", profile.getName(), player.getUUID(), v.reason());
            return;
        }
        Verdict before = CURRENT.put(player.getUUID(), v);
        int level = "admin".equals(v.role()) ? GuardConfig.get().adminOpLevel : "moderator".equals(v.role()) ? GuardConfig.get().moderatorOpLevel : 0;
        String key = player.getUUID().toString();
        ServerOpListEntry current = list.getOps().get(profile);
        if (level > 0) {
            if (current == null || current.getLevel() != level) {
                // only touch operators the guard created, never ones the owner added by hand
                if (current == null || managedOps.contains(key)) {
                    list.getOps().add(new ServerOpListEntry(profile, level, false));
                    managedOps.add(key);
                    save(opsFile(), managedOps);
                    list.sendPlayerPermissionLevel(player);
                }
            }
        } else {
            removeManagedOp(list, profile);
            list.sendPlayerPermissionLevel(player);
        }
        if (before == null || !java.util.Objects.equals(before.nick(), v.nick())) {
            player.refreshDisplayName();
            player.refreshTabListName();
        }
    }

    private static void removeManagedOp(PlayerList list, GameProfile profile) {
        String key = profile.getId().toString();
        if (managedOps.remove(key)) {
            list.getOps().remove(profile);
            save(opsFile(), managedOps);
        }
    }

    private static void save(Path file, Object value) {
        try {
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(value), StandardCharsets.UTF_8);
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            GuardMod.LOG.warn("Could not save {}: {}", file, e.toString());
        }
    }
}
