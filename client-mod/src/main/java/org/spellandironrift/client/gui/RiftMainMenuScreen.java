package org.spellandironrift.client.gui;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import org.spellandironrift.client.config.RiftConfig;

/**
 * Spell and Iron Rift main menu: vertical menu on the left, the player's live 3D character on the right,
 * the panorama (replaced by our resource pack with a Rift location) behind, rune ring and rising motes.
 * There is no singleplayer, no world creation and no server list: "Enter the Rift" connects to the official server.
 */
public class RiftMainMenuScreen extends Screen {
    private final List<RiftButton> menu = new ArrayList<>();
    private PlayerModelRenderer character;
    private final List<float[]> motes = new ArrayList<>(); // x, y, speed, size, hue
    private final Random random = new Random();
    private long opened;

    public RiftMainMenuScreen() { super(Component.translatable("spellironrift.menu.title")); }

    @Override
    protected void init() {
        if (character == null) character = new PlayerModelRenderer();
        opened = System.currentTimeMillis();
        menu.clear();
        int w = Math.min(250, Math.max(190, width / 4));
        int h = 30, gap = 8;
        int x = Math.max(24, width / 14);
        int total = 5 * h + 4 * gap;
        int y = Math.max(height / 2 - total / 2 + 30, 96);
        RiftConfig.Values cfg = RiftConfig.get();
        add(new RiftButton(x, y, w, h, Component.translatable("spellironrift.menu.enter"), Component.literal(cfg.serverHost()), 0, this::enterRift));
        add(new RiftButton(x, y + (h + gap), w, h, Component.translatable("spellironrift.menu.character"), null, 1, () -> minecraft.setScreen(new CharacterScreen(this, character))));
        add(new RiftButton(x, y + 2 * (h + gap), w, h, Component.translatable("spellironrift.menu.settings"), null, 2, () -> minecraft.setScreen(new RiftSettingsScreen(this))));
        add(new RiftButton(x, y + 3 * (h + gap), w, h, Component.translatable("spellironrift.menu.news"), null, 3, () -> minecraft.setScreen(new NewsScreen(this))));
        add(new RiftButton(x, y + 4 * (h + gap), w, h, Component.translatable("spellironrift.menu.quit"), null, 4, () -> minecraft.stop()));
        if (motes.isEmpty()) for (int i = 0; i < 70; i++) motes.add(newMote(true));
    }

    private void add(RiftButton b) { menu.add(b); addRenderableWidget(b); }

    private void enterRift() {
        character.cast();
        RiftConfig.Values cfg = RiftConfig.get();
        String address = cfg.serverHost() + ":" + cfg.serverPort();
        ServerData data = new ServerData(Component.translatable("spellironrift.server.name").getString(), address, ServerData.Type.OTHER);
        data.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
        ConnectScreen.startConnecting(this, Minecraft.getInstance(), ServerAddress.parseString(address), data, false, null);
    }

    private float[] newMote(boolean anywhere) {
        return new float[] { random.nextFloat() * width, anywhere ? random.nextFloat() * height : height + 4, 6 + random.nextFloat() * 18, random.nextFloat() < 0.8f ? 1 : 2, random.nextInt(3) };
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        renderPanorama(g, partialTick);
        // darken the left for the menu, tint everything towards graphite/violet
        g.fillGradient(0, 0, width, height, 0x88070710, 0xCC07070B);
        for (int i = 0; i < width / 2; i += 4) g.fill(i, 0, i + 4, height, RiftStyle.withAlpha(0xFF07070B, 0.55f * (1 - i / (width / 2f))));
        float t = (System.currentTimeMillis() % 1_000_000L) / 1000f;
        // rift glow on the right
        int gx = (int) (width * 0.72f);
        for (int r = 6; r >= 1; r--) {
            int rw = r * width / 22;
            g.fill(gx - rw, 0, gx + rw, height, RiftStyle.withAlpha(RiftStyle.VIOLET_LO, 0.035f * (0.8f + 0.2f * (float) Math.sin(t * 0.8))));
        }
        // rising motes
        for (float[] m : motes) {
            m[1] -= m[2] * 0.016f;
            m[0] += (float) Math.sin((m[1] + m[2] * 30) / 40f) * 0.2f;
            if (m[1] < -4) { float[] n = newMote(false); System.arraycopy(n, 0, m, 0, 5); }
            int c = m[4] == 0 ? 0xFFAA82FF : m[4] == 1 ? 0xFF6ED2FF : 0xFFF3DFA6;
            float a = 0.35f + 0.35f * (float) Math.sin(t * 3 + m[0]);
            int s = (int) m[3];
            g.fill((int) m[0], (int) m[1], (int) m[0] + s, (int) m[1] + s, RiftStyle.withAlpha(c, a));
        }
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick); // background + buttons
        float appear = Math.min(1f, (System.currentTimeMillis() - opened) / 600f);
        float t = (System.currentTimeMillis() % 1_000_000L) / 1000f;

        // logo
        int lx = menu.isEmpty() ? 24 : menu.get(0).getX();
        int ly = menu.isEmpty() ? 30 : menu.get(0).getY() - 78;
        g.drawString(font, Component.translatable("spellironrift.logo.top"), lx + 2, ly, RiftStyle.withAlpha(RiftStyle.GOLD, appear), true);
        g.pose().pushPose();
        g.pose().translate(lx, ly + 12, 0);
        g.pose().scale(4f, 4f, 1f);
        g.drawString(font, "RIFT", 1, 1, RiftStyle.withAlpha(0xFF241A0B, appear), false);
        g.drawString(font, "RIFT", 0, 0, RiftStyle.withAlpha(RiftStyle.GOLD_HI, appear), false);
        g.pose().popPose();
        g.fill(lx, ly + 50, lx + 120, ly + 51, RiftStyle.withAlpha(RiftStyle.GOLD_LO, appear));
        g.fill(lx + 120, ly + 49, lx + 123, ly + 52, RiftStyle.withAlpha(RiftStyle.VIOLET, appear * (0.6f + 0.4f * (float) Math.sin(t * 2))));

        // character: looks at the cursor, or at the hovered button
        int cx = (int) (width * 0.72f);
        int feet = (int) (height * 0.86f);
        float scale = Math.min(height * 0.36f, width * 0.2f);
        RiftStyle.runeRing(g, cx, feet, (int) (scale * 0.75f), t, RiftStyle.ARCANE);
        RiftStyle.runeRing(g, cx, feet, (int) (scale * 0.55f), -t * 1.4f, RiftStyle.VIOLET);
        int lookX = mouseX, lookY = mouseY;
        for (RiftButton b : menu) if (b.isHoveredOrFocused()) { lookX = b.getX() + b.getWidth(); lookY = b.getY() + b.getHeight() / 2; }
        character.render(g, cx, feet, scale, lookX, lookY, 0f);

        // footer: pack version and server
        RiftConfig.Values cfg = RiftConfig.get();
        Component footer = Component.translatable("spellironrift.menu.footer", cfg.buildVersion(), "NeoForge 1.21.1");
        g.drawString(font, footer, 8, height - 12, RiftStyle.withAlpha(RiftStyle.TEXT_DIM, 0.7f), false);
    }

    @Override
    public boolean shouldCloseOnEsc() { return false; }

    @Override
    public boolean isPauseScreen() { return false; }
}
