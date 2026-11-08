package org.spellandironrift.client.gui;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
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
    private final float[] hoverRow = new float[4];
    private boolean wasOverEnter;

    // layout of the buttons, in stage units (the stage is W x 360)
    private static final int ENTER_W = 220, ENTER_H = 32, ENTER_Y = 298;
    private static final int ROW_Y = 337, ROW_H = 19, ROW_GAP = 6;
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
        boolean overEnter = inside(sx, sy, scene.W / 2f - ENTER_W / 2f, ENTER_Y, ENTER_W, ENTER_H) || (keyboard && focus == 0);
        hoverEnter += ((overEnter ? 1 : 0) - hoverEnter) * Math.min(1, scene.dt * 10);
        if (overEnter && !wasOverEnter && ping.state() == ServerPing.State.ONLINE && scene.phase == RiftScene.Phase.MENU && uiShown > 0.9f)
            minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.AMETHYST_BLOCK_CHIME, 1.7f, 0.35f));
        wasOverEnter = overEnter;
        scene.steer(powerTarget, overEnter && ping.state() == ServerPing.State.ONLINE && scene.phase == RiftScene.Phase.MENU ? 1 : 0);

        scene.renderBackdrop(g, width, height);
        scene.pushStage(g);
        scene.renderRift(g);
        float lookX = overEnter ? scene.W / 2f : sx, lookY = overEnter ? ENTER_Y + ENTER_H / 2f : sy;
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
        g.drawString(f, top, 75, 22, argb(RiftStyle.GOLD, la), false);
        // the large TTF glyphs grow upwards from the given y (about 18 units above it, 6 below): RIFT sits under the eyebrow
        g.drawString(f, with(LOGO, "RIFT"), 75, 52, argb(0x241A0B, la), false);
        g.drawString(f, with(LOGO, "RIFT"), 74, 51, argb(RiftStyle.GOLD_HI, la), false);

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
        g.drawString(f, count, cx + 10, cy + 23, argb(RiftStyle.TEXT, ca), false);
        g.drawString(f, tr(BODY, "spellironrift.menu.players", online ? String.valueOf(ping.max()) : "—"), cx + 14 + f.width(count), cy + 22, argb(RiftStyle.TEXT_DIM, ca), false);
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
        int bx = W / 2 - ENTER_W / 2, by = ENTER_Y, bw = ENTER_W, bh = ENTER_H;
        boolean sealed = offline;
        float time = (System.currentTimeMillis() % 100000L) / 1000f;
        int gold = RiftStyle.GOLD & 0xFFFFFF;
        if (!sealed) RiftDraw.glow(g, W / 2f, by + bh / 2f, bw * (0.55f + 0.1f * hoverEnter), bh * 1.3f, RiftStyle.VIOLET & 0xFFFFFF, (0.18f + 0.3f * hoverEnter) * ea);
        int border = sealed ? 0x4A4757 : RiftDraw.mix(0x7D5E2B, gold, 0.35f + 0.65f * hoverEnter);
        RiftStyle.frame(g, bx, by, bw, bh,
                argb(sealed ? 0x1C1A24 : RiftDraw.mix(0x231B38, 0x34245F, hoverEnter), 0.97f * ea),
                argb(sealed ? 0x0C0B10 : 0x0B0911, 0.97f * ea), argb(border, ea));
        // inner forged line and corner studs
        RiftStyle.inset(g, bx + 3, by + 3, bw - 6, bh - 6, argb(sealed ? 0x2C2A36 : 0x7D5E2B, (0.35f + 0.25f * hoverEnter) * ea));
        for (int[] c : new int[][]{{bx + 1, by + 1}, {bx + bw - 3, by + 1}, {bx + 1, by + bh - 3}, {bx + bw - 3, by + bh - 3}})
            g.fill(c[0], c[1], c[0] + 2, c[1] + 2, argb(sealed ? 0x4A4757 : RiftStyle.GOLD_HI & 0xFFFFFF, ea));
        // light running across the plate every few seconds
        if (!sealed) {
            float sweep = (time % 4.5f) / 1.1f; // 0..1 during the first 1.1 s of each 4.5 s
            if (sweep < 1) {
                int sxp = bx + 2 + Math.round((bw - 16) * ease(sweep));
                for (int i = 0; i < 12; i++) {
                    float k = 1 - Math.abs(i - 6) / 6f;
                    g.fill(sxp + i, by + 2, sxp + i + 1, by + bh - 2, argb(0xFFF4D8, 0.10f * k * ea));
                }
            }
        }
        // rune sockets on both ends
        int sock = bh - 12;
        for (int side = 0; side < 2; side++) {
            int sx0 = side == 0 ? bx + 7 : bx + bw - 7 - sock, sy0 = by + 6;
            RiftStyle.frame(g, sx0, sy0, sock, sock, argb(0x120F1C, ea), argb(0x0A0910, ea), argb(sealed ? 0x2C2A36 : RiftDraw.mix(0x7D5E2B, gold, hoverEnter), ea));
            float pulse = 0.5f + 0.5f * (float) Math.sin(time * 3 + side * Math.PI);
            int runeC = sealed ? 0x4A4757 : RiftDraw.mix(RiftStyle.VIOLET & 0xFFFFFF, RiftStyle.ARCANE & 0xFFFFFF, Math.max(hoverEnter, 0.35f * pulse));
            RiftStyle.rune(g, 0, sx0 + (sock - 10) / 2, sy0 + (sock - 14) / 2, 2, argb(runeC, ea));
        }
        Component label = tr(HEADING, sealed ? "spellironrift.menu.offline_title" : "spellironrift.menu.enter");
        int lx = W / 2 - f.width(label) / 2 + Math.round(hoverEnter);
        g.drawString(f, label, lx + 1, by + 7, argb(0x120C05, 0.8f * ea), false);
        g.drawString(f, label, lx, by + 6, argb(sealed ? RiftStyle.TEXT_DIM : RiftDraw.mix(RiftStyle.GOLD & 0xFFFFFF, RiftStyle.GOLD_HI & 0xFFFFFF, 0.5f + 0.5f * hoverEnter), ea), false);
        Component sub = online ? (ping.pingMs() > 0 ? with(BODY, cfg.serverHost() + " · ").append(tr(BODY, "spellironrift.menu.ping", ping.pingMs())) : with(BODY, cfg.serverHost()))
                : offline ? tr(BODY, "spellironrift.menu.offline_sub", ServerPing.secondsToNextCheck()) : tr(BODY, "spellironrift.menu.checking_sub");
        g.drawString(f, sub, W / 2 - f.width(sub) / 2, by + 20, argb(RiftStyle.TEXT_DIM, ea), false);
        if (keyboard && focus == 0) g.renderOutline(bx - 2, by - 2, bw + 4, bh + 4, argb(RiftStyle.GOLD, 0.6f * ea));
        hits.add(new Hit(bx, by, bw, bh, this::enter));

        // ---- secondary row: forged buttons with a rune each
        float ra = appear(0.55f, a);
        String[] keys = {"spellironrift.menu.character", "spellironrift.menu.settings", "spellironrift.menu.news", "spellironrift.menu.quit"};
        int[] runes = {1, 2, 3, 4};
        Runnable[] actions = {this::openCharacter, this::openSettings, this::openNews, this::quit};
        int rw = Math.min(104, (W - 48 - 3 * ROW_GAP) / 4), rx = W / 2 - (4 * rw + 3 * ROW_GAP) / 2;
        for (int i = 0; i < keys.length; i++) {
            int x = rx + i * (rw + ROW_GAP);
            boolean hov = inside(mx, my, x, ROW_Y, rw, ROW_H) || (keyboard && focus == i + 1);
            hoverRow[i] += ((hov ? 1 : 0) - hoverRow[i]) * Math.min(1, scene.dt * 12);
            float hv = hoverRow[i];
            boolean quitBtn = i == 3;
            int accent = quitBtn ? 0xD0606E : gold;
            if (hv > 0.02f) RiftDraw.glow(g, x + rw / 2f, ROW_Y + ROW_H / 2f, rw * 0.55f, ROW_H * 1.1f, quitBtn ? 0xFF6070 : RiftStyle.VIOLET & 0xFFFFFF, 0.22f * hv * ra);
            RiftStyle.frame(g, x, ROW_Y, rw, ROW_H, argb(RiftDraw.mix(0x1F1C29, quitBtn ? 0x3A1C26 : 0x2B1F48, hv), 0.92f * ra), argb(0x0D0C12, 0.94f * ra),
                    argb(RiftDraw.mix(0x4A4757, accent, hv), ra));
            int s = ROW_H - 6;
            RiftStyle.frame(g, x + 3, ROW_Y + 3, s, s, argb(0x120F1C, ra), argb(0x0A0910, ra), argb(RiftDraw.mix(0x23212C, quitBtn ? 0x7A3540 : 0x7D5E2B, hv), ra));
            RiftStyle.rune(g, runes[i], x + 3 + (s - 5) / 2, ROW_Y + 3 + (s - 7) / 2, 1,
                    argb(RiftDraw.mix(quitBtn ? 0x7A3540 : RiftStyle.VIOLET_LO & 0xFFFFFF, quitBtn ? 0xFF8090 : RiftStyle.ARCANE & 0xFFFFFF, hv), ra));
            Component lab = with(BODY_MEDIUM, Component.translatable(keys[i]).getString().toUpperCase(java.util.Locale.ROOT));
            int tx = x + s + 6 + (rw - s - 9 - f.width(lab)) / 2 + Math.round(hv);
            g.drawString(f, lab, tx, ROW_Y + 6, argb(RiftDraw.mix(RiftStyle.TEXT_DIM & 0xFFFFFF, quitBtn ? 0xFFC0C8 : RiftStyle.GOLD_HI & 0xFFFFFF, hv), ra), false);
            if (hv > 0.02f) g.fill(x + s + 6, ROW_Y + ROW_H - 3, x + s + 6 + Math.round((rw - s - 10) * hv), ROW_Y + ROW_H - 2, argb(accent, 0.85f * ra));
            hits.add(new Hit(x, ROW_Y, rw, ROW_H, actions[i]));
        }

        // ---- newest news (only when there is room and the news service answered)
        NewsTeaser.Item news = NewsTeaser.get();
        if (news != null && W >= 600) {
            float na = appear(0.65f, a);
            int nx = 24, nw = 150, nh = 46, ny = ROW_Y - 10 - nh;
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

        // ---- build version, under the server card
        Component footer = tr(BODY, "spellironrift.menu.footer", cfg.buildVersion(), "NeoForge 1.21.1");
        g.drawString(f, footer, W - 24 - f.width(footer), cy + ch + 5, argb(0x6E6880, appear(0.7f, a)), false);
    }

    private static void diamond(GuiGraphics g, int cx, int cy, int rgb, float a) {
        int c = argb(rgb, a);
        g.fill(cx - 1, cy - 2, cx + 1, cy + 2, c);
        g.fill(cx - 2, cy - 1, cx + 2, cy + 1, c);
    }

    private void click() {
        minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
    }

    /** End-to-end test: shows the keyboard highlight on one entry (0 = Enter the Rift, 1..4 the row). */
    public void showFocus(int index) { keyboard = index >= 0; focus = Math.max(0, index); }

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

    /** Same as clicking the main button (used by the automated end-to-end test). */
    public void pressEnter() { enter(); }

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
            if (inside(sx, sy, h.x(), h.y(), h.w(), h.h())) { click(); h.action().run(); return true; }
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
                click();
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
