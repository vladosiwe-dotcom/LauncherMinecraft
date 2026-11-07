package org.spellandironrift.client.config;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.client.Minecraft;
import net.neoforged.fml.loading.FMLPaths;
import org.spellandironrift.client.RiftClientMod;

/**
 * Settings written by the launcher into <game>/spellironrift/launcher.json before every start
 * (server address, API base for news, chosen graphics preset). Contains no secrets.
 */
public final class RiftConfig {
    public record Values(String serverHost, int serverPort, String apiBase, String preset, String buildVersion) {}

    private static final Gson GSON = new Gson();
    private static Values values = new Values("play.spellandiron.net", 25565, "", "balanced", "?");

    private RiftConfig() {}

    public static Path dir() { return FMLPaths.GAMEDIR.get().resolve("spellironrift"); }

    public static void load() {
        Path file = dir().resolve("launcher.json");
        if (!Files.isRegularFile(file)) {
            RiftClientMod.LOG.warn("launcher.json not found — the game was not started from the Spell and Iron Rift launcher; using defaults");
            return;
        }
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            JsonObject server = o.getAsJsonObject("server");
            String host = server.get("host").getAsString();
            int port = server.get("port").getAsInt();
            if (!host.matches("[A-Za-z0-9.-]{1,253}") || port < 1 || port > 65535) throw new IOException("bad server address");
            String api = o.has("apiBase") ? o.get("apiBase").getAsString() : "";
            if (!api.isEmpty() && !api.startsWith("https://") && !api.startsWith("http://localhost") && !api.startsWith("http://127.0.0.1")) api = "";
            values = new Values(host, port, api, o.has("preset") ? o.get("preset").getAsString() : "balanced", o.has("buildVersion") ? o.get("buildVersion").getAsString() : "?");
        } catch (Exception e) {
            RiftClientMod.LOG.error("Could not read launcher.json, using defaults", e);
        }
    }

    public static Values get() { return values; }

    /** Remember a preset the player picked in-game so the launcher installs matching shader files next time. */
    public static void savePresetRequest(String preset) {
        try {
            Files.createDirectories(dir());
            JsonObject o = new JsonObject();
            o.addProperty("preset", preset);
            Files.writeString(dir().resolve("client-prefs.json"), GSON.toJson(o), StandardCharsets.UTF_8);
            values = new Values(values.serverHost(), values.serverPort(), values.apiBase(), preset, values.buildVersion());
        } catch (IOException e) {
            RiftClientMod.LOG.warn("Could not save client-prefs.json", e);
        }
    }

    public static String languageCode() { return Minecraft.getInstance().options.languageCode; }
}
