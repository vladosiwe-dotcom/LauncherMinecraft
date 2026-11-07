package org.spellandironrift.client.gui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

/** Menu button: forged frame, rune socket, violet glow and a gold sweep on hover. Replaces vanilla buttons entirely. */
public class RiftButton extends AbstractButton {
    private final Runnable action;
    private final int rune;
    private final Component hint;
    private float hover; // 0..1 eased hover progress
    private long lastFrame = System.nanoTime();

    public RiftButton(int x, int y, int w, int h, Component label, Component hint, int rune, Runnable action) {
        super(x, y, w, h, label);
        this.action = action;
        this.rune = rune;
        this.hint = hint;
    }

    @Override
    public void onPress() { action.run(); }

    public float hoverProgress() { return hover; }

    @Override
    protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        boolean hot = (isHoveredOrFocused() && active);
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - lastFrame) / 1e9f);
        lastFrame = now;
        hover = Mth.lerp(Math.min(1f, dt * 10f), hover, hot ? 1f : 0f);
        float time = (System.currentTimeMillis() % 100000L) / 1000f;
        int x = getX(), y = getY(), w = getWidth(), h = getHeight();

        // glow behind the frame
        if (hover > 0.02f) {
            for (int i = 4; i >= 1; i--) g.fill(x - i, y - i, x + w + i, y + h + i, RiftStyle.withAlpha(RiftStyle.VIOLET, 0.05f * hover * (5 - i)));
        }
        int border = RiftStyle.lerpColor(RiftStyle.IRON, RiftStyle.GOLD, hover);
        RiftStyle.frame(g, x, y, w, h, RiftStyle.lerpColor(0xF01F1C29, 0xF02B1F48, hover), 0xF00D0C12, border);

        // rune socket
        int s = h - 6;
        RiftStyle.frame(g, x + 3, y + 3, s, s, 0xFF120F1C, 0xFF0A0910, RiftStyle.lerpColor(RiftStyle.IRON_LO, RiftStyle.GOLD_LO, hover));
        int runeColor = RiftStyle.lerpColor(RiftStyle.VIOLET_LO, RiftStyle.ARCANE, hover * (0.75f + 0.25f * (float) Math.sin(time * 6)));
        int scale = Math.max(1, (s - 4) / 7);
        RiftStyle.rune(g, rune, x + 3 + (s - 5 * scale) / 2, y + 3 + (s - 7 * scale) / 2, scale, active ? runeColor : RiftStyle.IRON);

        // gold sweep line on hover
        if (hover > 0.02f) {
            int sweepW = (int) ((w - s - 12) * hover);
            g.fill(x + s + 8, y + h - 3, x + s + 8 + sweepW, y + h - 2, RiftStyle.withAlpha(RiftStyle.GOLD, 0.85f));
        }

        Font font = Minecraft.getInstance().font;
        int textX = x + s + 10 + (int) (3 * hover);
        int color = !active ? RiftStyle.IRON : RiftStyle.lerpColor(RiftStyle.TEXT, RiftStyle.GOLD_HI, hover);
        g.drawString(font, getMessage().getString().toUpperCase(java.util.Locale.ROOT), textX, y + (h - 8) / 2 - (hint != null ? 4 : 0), color, true);
        if (hint != null) g.drawString(font, hint, textX, y + (h - 8) / 2 + 6, RiftStyle.withAlpha(RiftStyle.TEXT_DIM, 0.6f + 0.4f * hover), false);
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput out) { defaultButtonNarrationText(out); }
}
