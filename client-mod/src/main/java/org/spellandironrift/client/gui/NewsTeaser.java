package org.spellandironrift.client.gui;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.spellandironrift.client.config.RiftConfig;

/** The newest news item for the card in the menu corner. Fetched once per game session; hidden if unavailable. */
public final class NewsTeaser {
    public record Item(String tag, String date, String title, String body) {}

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private static volatile Item item;
    private static volatile boolean requested;

    private NewsTeaser() {}

    public static Item get() {
        if (!requested) fetch();
        return item;
    }

    private static void fetch() {
        requested = true;
        String api = RiftConfig.get().apiBase();
        if (api.isEmpty()) return;
        String code = RiftConfig.languageCode();
        String lang = code.startsWith("uk") ? "uk" : code.startsWith("ru") ? "ru" : "en";
        HttpRequest req = HttpRequest.newBuilder(URI.create(api + "/api/public/news?lang=" + lang)).timeout(Duration.ofSeconds(10)).GET().build();
        HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).thenAccept(res -> {
            if (res.statusCode() != 200) return;
            JsonArray arr = new Gson().fromJson(res.body(), JsonArray.class);
            if (arr == null || arr.isEmpty()) return;
            JsonObject o = arr.get(0).getAsJsonObject();
            item = new Item(o.get("tag").getAsString(), o.get("date").getAsString(), o.get("title").getAsString(), o.get("body").getAsString());
        }).exceptionally(e -> null);
    }
}
