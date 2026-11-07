package org.spellandironrift.client.gui;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import org.spellandironrift.client.config.RiftConfig;

/** News from the Spell and Iron Rift backend in the player's language (ru / uk / en). */
public class NewsScreen extends RiftSubScreen {
    private record Item(String tag, String date, String title, String body) {}
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build();

    private volatile List<Item> items;
    private volatile boolean failed;
    private double scroll;
    private int contentHeight;

    public NewsScreen(Screen parent) { super(Component.translatable("spellironrift.news.title"), parent); }

    @Override
    protected void init() {
        super.init();
        if (items != null) return;
        String api = RiftConfig.get().apiBase();
        if (api.isEmpty()) { failed = true; return; }
        String lang = RiftConfig.languageCode().startsWith("uk") ? "uk" : RiftConfig.languageCode().startsWith("ru") ? "ru" : "en";
        HttpRequest req = HttpRequest.newBuilder(URI.create(api + "/api/public/news?lang=" + lang)).timeout(Duration.ofSeconds(10)).GET().build();
        HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).thenAccept(res -> {
            if (res.statusCode() != 200) { failed = true; return; }
            List<Item> list = new ArrayList<>();
            for (JsonElement e : new Gson().fromJson(res.body(), JsonArray.class)) {
                JsonObject o = e.getAsJsonObject();
                list.add(new Item(o.get("tag").getAsString(), o.get("date").getAsString(), o.get("title").getAsString(), o.get("body").getAsString()));
            }
            items = list;
        }).exceptionally(e -> { failed = true; return null; });
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int x = px + 18, top = py + 44, bottom = py + ph - 46, w = pw - 36;
        if (items == null) {
            g.drawString(font, Component.translatable(failed ? "spellironrift.news.error" : "spellironrift.news.loading"), x, top, RiftStyle.TEXT_DIM, false);
            return;
        }
        if (items.isEmpty()) { g.drawString(font, Component.translatable("spellironrift.news.empty"), x, top, RiftStyle.TEXT_DIM, false); return; }
        g.enableScissor(px + 4, top, px + pw - 4, bottom);
        int y = top - (int) scroll;
        for (Item it : items) {
            g.fill(x - 6, y, x - 4, y + 10, RiftStyle.VIOLET);
            g.drawString(font, Component.translatable("spellironrift.news.tag." + it.tag()).getString().toUpperCase(java.util.Locale.ROOT) + "  ·  " + it.date(), x, y, RiftStyle.GOLD, false);
            y += 12;
            for (FormattedCharSequence line : font.split(Component.literal(it.title()), w)) { g.drawString(font, line, x, y, RiftStyle.TEXT, true); y += 11; }
            for (FormattedCharSequence line : font.split(Component.literal(it.body()), w)) { g.drawString(font, line, x, y, RiftStyle.TEXT_DIM, false); y += 10; }
            y += 12;
        }
        g.disableScissor();
        contentHeight = y + (int) scroll - top;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double sx, double sy) {
        int view = ph - 90;
        scroll = Math.max(0, Math.min(Math.max(0, contentHeight - view), scroll - sy * 20));
        return true;
    }
}
