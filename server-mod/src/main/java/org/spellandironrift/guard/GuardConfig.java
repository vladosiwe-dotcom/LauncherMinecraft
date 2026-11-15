package org.spellandironrift.guard;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.neoforged.fml.loading.FMLPaths;

/**
 * config/spellironrift-guard.json. Created with defaults on first start; the owner fills in apiBase and the
 * server key from Rift Control (Player accounts → Game server key). Until both are set the guard rejects joins.
 */
public final class GuardConfig {
    public static final class Values {
        public String apiBase = "";
        public String serverKey = "";
        /** Must match the serverId requested by the launcher when issuing its one-use ticket. */
        public String serverId = "main";
        /** Operator level for each role (3 = kick/ban/most commands, 4 = everything). */
        public int moderatorOpLevel = 3;
        public int adminOpLevel = 4;
    }

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static Values values = new Values();

    private GuardConfig() {}

    public static Path file() { return FMLPaths.CONFIGDIR.get().resolve("spellironrift-guard.json"); }

    public static void load() {
        Path f = file();
        try {
            if (Files.isRegularFile(f)) values = GSON.fromJson(Files.readString(f, StandardCharsets.UTF_8), Values.class);
            else Files.writeString(f, GSON.toJson(new Values()), StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException e) {
            GuardMod.LOG.error("Could not read {}; the guard stays off", f, e);
            values = new Values();
        }
        if (values == null) values = new Values();
        String api = values.apiBase.trim();
        if (!api.isEmpty() && !api.startsWith("https://") && !api.startsWith("http://127.0.0.1") && !api.startsWith("http://localhost")) {
            GuardMod.LOG.error("apiBase must be https:// (or a local http address); the guard stays off");
            values.apiBase = "";
        }
    }

    public static Values get() { return values; }

    public static boolean enabled() { return !values.apiBase.isBlank() && !values.serverKey.isBlank(); }
}
