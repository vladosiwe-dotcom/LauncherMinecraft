package org.spellandironrift.client.gui;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import org.jetbrains.annotations.Nullable;
import org.spellandironrift.client.config.RiftConfig;
import org.spellandironrift.client.net.ServerPing;

import static org.spellandironrift.client.gui.RiftDraw.argb;
import static org.spellandironrift.client.gui.RiftDraw.clamp;
import static org.spellandironrift.client.gui.RiftDraw.ease;
import static org.spellandironrift.client.gui.RiftFonts.*;

/**
 * Spell and Iron Rift main menu. The rift in the centre is the server: open when it answers, sealed when not.
 * The player's character stands at its foot; the one main action sits under the character's feet; the server
 * card and the newest news sit quietly in the corners. There is no singleplayer, world creation or server list:
 * "Enter the Rift" connects to the official server, and the trip into the rift replaces the loading screens.
 */
public class RiftMainMenuScreen extends Screen {
    private static PlayerModelRenderer character;
    @Nullable private static RiftMainMenuScreen last;

    private record Hit(float x, float y, float w, float h, Runnable action) {}

    private final RiftScene scene = RiftScene.INSTANCE;
    private final List<Hit> hits = new ArrayList<>();
    private final long opened = System.currentTimeMillis();
    private float uiShown;
    private int focus; // 0 enter, 1 character, 2 settings, 3 news, 4 quit
    private boolean keyboard;
    private float hoverEnter;
    @Nullable private Component error;
    private long errorAt;

    public RiftMainMenuScreen() {
        super(Component.translatable("spellironrift.menu.title"));
    }

    /** Menu shown after a failed connection: the camera pulls back out of the rift and the reason stays on screen. */
    public static RiftMainMenuScreen returning(Component reason) {
        RiftMainMenuScreen s = new RiftMainMenuScreen();
        RiftScene.INSTANCE.beginBack(reason);
        s.error = reason;
        s.errorAt = System.currentTimeMillis();
        return s;
    }

    public static PlayerModelRenderer character() {
        if (character == null) character = new PlayerModelRenderer();
        return character;
    }

    @Nullable
    public static RiftMainMenuScreen last() { return last; }

    @Override
    protected void init() {
        last = this;
        character();
        // back from the connecting screen (its Cancel button returns here)
        if (scene.travelling()) {
            Component reason = Component.translatable("spellironrift.connect.cancelled");
            scene.beginBack(reason);
            error = reason;
            errorAt = System.currentTimeMillis();
        }
        if (ServerPing.result().state() != ServerPing.State.ONLINE) ServerPing.checkNow();
    }

    @Override
    public boolean shouldCloseOnEsc() { return false; }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        // drawn in render(): the backdrop moves with the camera
    }

    // ------------------------------------------------------------------ render

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        scene.frame();
        scene.layout(width, height);
        ServerPing.tick();
        ServerPing.Result ping = ServerPing.result();
        float powerTarget = ping.state() == ServerPing.State.ONLINE ? 1 : ping.state() == ServerPing.State.OFFLINE ? 0 : 0.45f;
        float sx = scene.toStageX(mouseX), sy = scene.toStageY(mouseY);
        boolean overEnter = inside(sx, sy, scene.W / 2f - 107, 300, 214, 31) || (keyboard && focus == 0);
        hoverEnter += ((overEnter ? 1 : 0) - hoverEnter) * Math.min(1, scene.dt * 10);
        scene.steer(powerTarget, overEnter && ping.state() == ServerPing.State.ONLINE && scene.phase == RiftScene.Phase.MENU ? 1 : 0);

        scene.renderBackdrop(g, width, height);
        scene.pushStage(g);
        scene.renderRift(g);
        float lookX = overEnter ? scene.W / 2f : sx, lookY = overEnter ? 315 : sy;
        scene.renderCharacter(g, character(), lookX, lookY);
        g.pose().popPose();

        float target = scene.phase == RiftScene.Phase.MENU ? 1 : 0;
        uiShown += (target - uiShown) * Math.min(1, scene.dt * (target > uiShown ? 3 : 8));
        hits.clear();
        scene.pushFlatStage(g);
        renderUi(g, uiShown, sx, sy, ping);
        g.pose().popPose();

        if (scene.tunnelA > 0) scene.renderTunnel(g, width, height, scene.tunnelA);
    }

    /** Group fade-in on first open; a is the overall interface alpha. */
    private float appear(float delay, float a) {
        return a * ease((System.currentTimeMillis() - opened - delay * 1000) / 500f);
    }

    /** The interface layer in stage units. Also called by the transition while it fades out over the connect screen. */
    public void renderUi(GuiGraphics g, float a, float mx, float my, ServerPing.Result ping) {
        if (a <= 0.01f) return;
        int W = scene.W;
        Font f = font;
        boolean online = ping.state() == ServerPing.State.ONLINE, offline = ping.state() == ServerPing.State.OFFLINE;

        // ---- logo
        float la = appear(0.15f, a);
        g.flush();
        g.setColor(1, 1, 1, la);
        g.blit(RiftDraw.SIGIL, 24, 20, 42, 42, 0f, 0f, 128, 128, 128, 128);
        g.setColor(1, 1, 1, 1);
        Component top = Component.empty().append(with(EYEBROW, "SPELL ")).append(with(EYEBROW, "&").withColor(RiftStyle.VIOLET & 0xFFFFFF)).append(with(EYEBROW, " IRON"));
        g.drawString(f, top, 75, 24, argb(RiftStyle.GOLD, la), false);
        g.drawString(f, with(LOGO, "RIFT"), 75, 34, argb(0x241A0B, la), false);
        g.drawString(f, with(LOGO, "RIFT"), 74, 33, argb(RiftStyle.GOLD_HI, la), false);

        // ---- server card
        float ca = appear(0.3f, a);
        int cw = 152, cx = W - 24 - cw, cy = 24;
        String motd = offline ? Component.translatable("spellironrift.menu.offline_motd").getString() : ping.motd();
        List<FormattedCharSequence> motdLines = motd.isEmpty() ? List.of() : f.split(with(BODY, motd), cw - 20);
        if (motdLines.size() > 2) motdLines = motdLines.subList(0, 2);
        int ch = 52 + (motdLines.isEmpty() ? 0 : 6 + motdLines.size() * 8);
        RiftStyle.frame(g, cx, cy, cw, ch, argb(0x1F1C29, 0.86f * ca), argb(0x0D0C12, 0.9f * ca), argb(0x7D5E2B, ca));
        g.drawString(f, tr(EYEBROW, "spellironrift.menu.server"), cx + 10, cy + 8, argb(RiftStyle.GOLD, ca), false);
        Component pill = tr(BODY_MEDIUM, online ? "spellironrift.menu.online" : offline ? "spellironrift.menu.offline" : "spellironrift.menu.checking");
        int pc = online ? 0x62D68F : offline ? 0xFF6070 : 0xF0B64C;
        int pw = f.width(pill) + 12, px = cx + cw - 10 - pw;
        g.fill(px, cy + 7, px + pw, cy + 16, argb(0xFFFFFF, 0.05f * ca));
        boolean blink = !online && !offline && (System.currentTimeMillis() / 500) % 2 == 0;
        g.fill(px + 3, cy + 10, px + 6, cy + 13, argb(pc, blink ? 0.2f * ca : ca));
        g.drawString(f, pill, px + 9, cy + 8, argb(pc, ca), false);
        Component count = with(COUNT, online ? String.valueOf(ping.online()) : "—");
        g.drawString(f, count, cx + 10, cy + 20, argb(RiftStyle.TEXT, ca), false);
        g.drawString(f, tr(BODY, "spellironrift.menu.players", online ? String.valueOf(ping.max()) : "—"), cx + 14 + f.width(count), cy + 28, argb(RiftStyle.TEXT_DIM, ca), false);
        int meterW = cw - 20;
        g.fill(cx + 10, cy + 38, cx + 10 + meterW, cy + 40, argb(0xFFFFFF, 0.07f * ca));
        if (online && ping.max() > 0) {
            int fw = Math.round(meterW * clamp(ping.online() / (float) ping.max(), 0, 1));
            g.fillGradient(cx + 10, cy + 38, cx + 10 + fw, cy + 40, argb(RiftStyle.VIOLET, ca), argb(RiftStyle.ARCANE, ca));
        }
        RiftConfig.Values cfg = RiftConfig.get();
        g.drawString(f, with(BODY, cfg.serverHost()), cx + 10, cy + 44, argb(0x6E6880, ca), false);
        Component pingText = online && ping.pingMs() > 0 ? tr(BODY, "spellironrift.menu.ping", ping.pingMs()) : offline ? tr(BODY, "spellironrift.menu.no_answer") : with(BODY, "…");
        int ptx = cx + cw - 10 - f.width(pingText);
        g.drawString(f, pingText, ptx, cy + 44, argb(0x6E6880, ca), false);
        int bars = !online ? 0 : ping.pingMs() < 80 ? 4 : ping.pingMs() < 150 ? 3 : ping.pingMs() < 300 ? 2 : 1;
        for (int i = 0; i < 4; i++) {
            int bh = 2 + i, bx = ptx - 12 + i * 2;
            g.fill(bx, cy + 50 - bh, bx + 1, cy + 50, argb(i < bars ? 0x62D68F : 0x6E6880, ca));
        }
        if (!motdLines.isEmpty()) {
            g.fill(cx + 10, cy + 55, cx + cw - 10, cy + 56, argb(0x7D5E2B, 0.35f * ca));
            int my2 = cy + 59;
            for (FormattedCharSequence line : motdLines) { g.drawString(f, line, cx + 10, my2, argb(RiftStyle.TEXT_DIM, ca), false); my2 += 8; }
        }

        // ---- main action, under the character's feet
        float ea = appear(0.45f, a);
        int bx = W / 2 - 107, by = 300, bw = 214, bh = 31;
        boolean sealed = offline;
        int border = sealed ? 0x4A4757 : RiftDraw.mix(0x7D5E2B, RiftStyle.GOLD & 0xFFFFFF, hoverEnter);
        RiftStyle.frame(g, bx, by, bw, bh,
                argb(sealed ? 0x1C1A24 : RiftDraw.mix(0x241C3A, 0x30225A, hoverEnter), 0.97f * ea),
                argb(sealed ? 0x0C0B10 : 0x0C0A12, 0.97f * ea), argb(border, ea));
        if (!sealed) RiftDraw.glow(g, W / 2f, by + bh, bw * 0.45f, bh * 0.9f, RiftStyle.VIOLET & 0xFFFFFF, (0.25f + 0.25f * hoverEnter) * ea);
        diamond(g, bx + 10, by + bh / 2, sealed ? 0x4A4757 : RiftStyle.GOLD & 0xFFFFFF, ea);
        diamond(g, bx + bw - 11, by + bh / 2, sealed ? 0x4A4757 : RiftStyle.GOLD & 0xFFFFFF, ea);
        Component label = tr(HEADING, sealed ? "spellironrift.menu.offline_title" : "spellironrift.menu.enter");
        g.drawString(f, label, W / 2 - f.width(label) / 2, by + 6, argb(sealed ? RiftStyle.TEXT_DIM : RiftStyle.GOLD_HI, ea), false);
        Component sub = online ? (ping.pingMs() > 0 ? with(BODY, cfg.serverHost() + " · ").append(tr(BODY, "spellironrift.menu.ping", ping.pingMs())) : with(BODY, cfg.serverHost()))
                : offline ? tr(BODY, "spellironrift.menu.offline_sub", ServerPing.secondsToNextCheck()) : tr(BODY, "spellironrift.menu.checking_sub");
        g.drawString(f, sub, W / 2 - f.width(sub) / 2, by + 20, argb(RiftStyle.TEXT_DIM, ea), false);
        if (keyboard && focus == 0) g.renderOutline(bx - 2, by - 2, bw + 4, bh + 4, argb(RiftStyle.GOLD, 0.6f * ea));
        hits.add(new Hit(bx, by, bw, bh, this::enter));

        // ---- secondary row
        float ra = appear(0.55f, a);
        String[] keys = {"spellironrift.menu.character", "spellironrift.menu.settings", "spellironrift.menu.news", "spellironrift.menu.quit"};
        Runnable[] actions = {this::openCharacter, this::openSettings, this::openNews, this::quit};
        int total = 0;
        Component[] labels = new Component[keys.length];
        for (int i = 0; i < keys.length; i++) {
            labels[i] = with(BODY_MEDIUM, Component.translatable(keys[i]).getString().toUpperCase(java.util.Locale.ROOT));
            total += f.width(labels[i]) + (i > 0 ? 14 : 0);
        }
        int rx = W / 2 - total / 2, ry = 339;
        for (int i = 0; i < keys.length; i++) {
            if (i > 0) { diamond(g, rx + 5, ry + 3, 0x7D5E2B, ra * 0.8f); rx += 14; }
            int lw = f.width(labels[i]);
            boolean hov = inside(mx, my, rx - 2, ry - 2, lw + 4, 11) || (keyboard && focus == i + 1);
            g.drawString(f, labels[i], rx, ry, argb(hov ? RiftStyle.GOLD_HI : RiftStyle.TEXT_DIM, ra), false);
            if (hov) g.fill(rx, ry + 9, rx + lw, ry + 10, argb(RiftStyle.GOLD, ra));
            hits.add(new Hit(rx - 2, ry - 2, lw + 4, 11, actions[i]));
            rx += lw;
        }

        // ---- newest news (only when there is room and the news service answered)
        NewsTeaser.Item news = NewsTeaser.get();
        if (news != null && W >= 600) {
            float na = appear(0.65f, a);
            int nx = 24, nw = 150, nh = 46, ny = 360 - 24 - nh;
            boolean hov = inside(mx, my, nx, ny, nw, nh);
            RiftStyle.frame(g, nx, ny, nw, nh, argb(0x1F1C29, 0.86f * na), argb(0x0D0C12, 0.9f * na), argb(hov ? 0xC9A35B : 0x7D5E2B, na));
            Component tag = with(EYEBROW, Component.translatable("spellironrift.news.tag." + news.tag()).getString() + " · " + news.date());
            g.drawString(f, tag, nx + 9, ny + 7, argb(RiftStyle.GOLD, na), false);
            List<FormattedCharSequence> title = f.split(with(HEADING_SMALL, news.title()), nw - 18);
            if (!title.isEmpty()) g.drawString(f, title.get(0), nx + 9, ny + 18, argb(hov ? RiftStyle.GOLD_HI : RiftStyle.TEXT, na), false);
            List<FormattedCharSequence> body = f.split(with(BODY, news.body()), nw - 18);
            if (!body.isEmpty()) g.drawString(f, body.get(0), nx + 9, ny + 31, argb(RiftStyle.TEXT_DIM, na), false);
            hits.add(new Hit(nx, ny, nw, nh, this::openNews));
        }

        // ---- reason of the last failed connection
        if (error != null) {
            long age = System.currentTimeMillis() - errorAt;
            float erA = a * clamp(1 - (age - 8000) / 600f, 0, 1);
            if (erA <= 0.01f) error = null;
            else {
                Component msg = with(BODY, error.getString());
                int ew = Math.min(W - 48, f.width(msg) + 20);
                List<FormattedCharSequence> lines = f.split(msg, ew - 20);
                int eh = 8 + lines.size() * 9, ex = W / 2 - ew / 2, ey = 262 - eh;
                RiftStyle.frame(g, ex, ey, ew, eh, argb(0x2A1218, 0.92f * erA), argb(0x140A0E, 0.92f * erA), argb(0xFF6070, 0.8f * erA));
                int ly = ey + 5;
                for (FormattedCharSequence line : lines) { g.drawString(f, line, ex + 10, ly, argb(0xFFD0D6, erA), false); ly += 9; }
                hits.add(new Hit(ex, ey, ew, eh, () -> error = null));
            }
        }

        // ---- footer
        Component footer = tr(BODY, "spellironrift.menu.footer", cfg.buildVersion(), "NeoForge 1.21.1");
        g.drawString(f, footer, W - 24 - f.width(footer), 350, argb(0x6E6880, appear(0.7f, a)), false);
    }

    private static void diamond(GuiGraphics g, int cx, int cy, int rgb, float a) {
        int c = argb(rgb, a);
        g.fill(cx - 1, cy - 2, cx + 1, cy + 2, c);
        g.fill(cx - 2, cy - 1, cx + 2, cy + 1, c);
    }

    private static boolean inside(float x, float y, float rx, float ry, float rw, float rh) {
        return x >= rx && y >= ry && x < rx + rw && y < ry + rh;
    }

    // ------------------------------------------------------------------ actions

    private void enter() {
        if (scene.phase != RiftScene.Phase.MENU) return;
        ServerPing.State state = ServerPing.result().state();
        if (state == ServerPing.State.OFFLINE) { ServerPing.checkNow(); return; }
        if (state != ServerPing.State.ONLINE) return;
        error = null;
        scene.beginEnter();
        // The connection starts right away; the trip into the rift is drawn over the connecting screens.
        RiftConfig.Values cfg = RiftConfig.get();
        String address = cfg.serverHost() + ":" + cfg.serverPort();
        ServerData data = new ServerData(Component.translatable("spellironrift.server.name").getString(), address, ServerData.Type.OTHER);
        data.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
        ConnectScreen.startConnecting(this, Minecraft.getInstance(), ServerAddress.parseString(address), data, false, null);
    }

    private void openCharacter() { minecraft.setScreen(new CharacterScreen(this, character())); }
    private void openSettings() { minecraft.setScreen(new RiftSettingsScreen(this)); }
    private void openNews() { minecraft.setScreen(new NewsScreen(this)); }
    private void quit() { minecraft.stop(); }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button != 0 || scene.phase != RiftScene.Phase.MENU) return true;
        keyboard = false;
        float sx = scene.toStageX(mouseX), sy = scene.toStageY(mouseY);
        for (int i = hits.size() - 1; i >= 0; i--) {
            Hit h = hits.get(i);
            if (inside(sx, sy, h.x(), h.y(), h.w(), h.h())) { h.action().run(); return true; }
        }
        return true;
    }

    @Override
    public void mouseMoved(double mouseX, double mouseY) {
        keyboard = false;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (scene.phase != RiftScene.Phase.MENU) return true;
        switch (keyCode) {
            case 258 -> { keyboard = true; focus = Math.floorMod(focus + (hasShiftDown() ? -1 : 1), 5); return true; } // Tab
            case 262, 264 -> { keyboard = true; focus = Math.floorMod(focus + 1, 5); return true; }                    // → ↓
            case 263, 265 -> { keyboard = true; focus = Math.floorMod(focus - 1, 5); return true; }                    // ← ↑
            case 257, 335, 32 -> {                                                                                      // Enter, keypad Enter, Space
                switch (keyboard ? focus : 0) {
                    case 0 -> enter();
                    case 1 -> openCharacter();
                    case 2 -> openSettings();
                    case 3 -> openNews();
                    default -> quit();
                }
                return true;
            }
            default -> { return super.keyPressed(keyCode, scanCode, modifiers); }
        }
    }
}
