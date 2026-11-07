package org.spellandironrift.client.gui;

import net.minecraft.client.gui.GuiGraphics;

/** Palette and pixel-art drawing helpers shared by every Spell and Iron Rift screen. */
public final class RiftStyle {
    public static final int INK = 0xFF07070B;
    public static final int GRAPHITE = 0xFF15131C;
    public static final int GRAPHITE_HI = 0xFF221F2D;
    public static final int IRON_HI = 0xFF8D8A99;
    public static final int IRON = 0xFF4A4757;
    public static final int IRON_LO = 0xFF23212C;
    public static final int GOLD_HI = 0xFFF3DFA6;
    public static final int GOLD = 0xFFC9A35B;
    public static final int GOLD_LO = 0xFF7D5E2B;
    public static final int VIOLET = 0xFF9A6BFF;
    public static final int VIOLET_LO = 0xFF4B2A9E;
    public static final int ARCANE = 0xFF5FC8FF;
    public static final int TEXT = 0xFFEBE6F3;
    public static final int TEXT_DIM = 0xFFA49DB4;

    /** 5x7 rune glyphs (one per menu entry), drawn as pixel blocks. Each row is a 5-bit mask. */
    public static final int[][] RUNES = {
            {0b00100, 0b01110, 0b10101, 0b00100, 0b00100, 0b00100, 0b00100}, // gateway
            {0b01110, 0b10001, 0b01110, 0b00100, 0b11111, 0b00100, 0b01010}, // figure
            {0b10101, 0b01110, 0b11011, 0b01110, 0b10101, 0b00100, 0b00100}, // gear-star
            {0b11111, 0b10001, 0b10111, 0b10001, 0b10111, 0b10001, 0b11111}, // scroll
            {0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b00000, 0b11111}, // seal
    };

    private RiftStyle() {}

    public static int withAlpha(int argb, float alpha) {
        int a = Math.max(0, Math.min(255, (int) (alpha * 255)));
        return (a << 24) | (argb & 0x00FFFFFF);
    }

    public static int lerpColor(int a, int b, float t) {
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, aa = (a >>> 24);
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255, ba = (b >>> 24);
        return ((int) (aa + (ba - aa) * t) << 24) | ((int) (ar + (br - ar) * t) << 16) | ((int) (ag + (bg - ag) * t) << 8) | (int) (ab + (bb - ab) * t);
    }

    /** Forged frame: chamfered gold/iron border around a dark plate. */
    public static void frame(GuiGraphics g, int x, int y, int w, int h, int plateTop, int plateBottom, int border) {
        int c = 3; // chamfer size in pixels
        g.fill(x + c, y, x + w - c, y + 1, border);
        g.fill(x + c, y + h - 1, x + w - c, y + h, border);
        g.fill(x, y + c, x + 1, y + h - c, border);
        g.fill(x + w - 1, y + c, x + w, y + h - c, border);
        for (int i = 1; i < c; i++) {
            g.fill(x + c - i, y + i, x + c - i + 1, y + i + 1, border);
            g.fill(x + w - c + i - 1, y + i, x + w - c + i, y + i + 1, border);
            g.fill(x + c - i, y + h - i - 1, x + c - i + 1, y + h - i, border);
            g.fill(x + w - c + i - 1, y + h - i - 1, x + w - c + i, y + h - i, border);
        }
        g.fillGradient(x + 1, y + 1, x + w - 1, y + h - 1, plateTop, plateBottom);
    }

    public static void rune(GuiGraphics g, int index, int x, int y, int scale, int color) {
        int[] rows = RUNES[Math.floorMod(index, RUNES.length)];
        for (int r = 0; r < rows.length; r++)
            for (int col = 0; col < 5; col++)
                if ((rows[r] >> (4 - col) & 1) == 1) g.fill(x + col * scale, y + r * scale, x + (col + 1) * scale, y + (r + 1) * scale, color);
    }

    /** A ring of pixel blocks with rotating gaps — the rune circle behind the character. */
    public static void runeRing(GuiGraphics g, int cx, int cy, int radius, float time, int color) {
        int blocks = Math.max(24, radius / 2);
        for (int i = 0; i < blocks; i++) {
            double a = (i / (double) blocks) * Math.PI * 2 + time * 0.15;
            if (i % 6 == 0) continue;
            int px = cx + (int) Math.round(Math.cos(a) * radius);
            int py = cy + (int) Math.round(Math.sin(a) * radius * 0.32); // flattened: a circle on the floor
            float pulse = 0.35f + 0.25f * (float) Math.sin(time * 2 + i * 0.6);
            g.fill(px - 1, py - 1, px + 2, py + 1, withAlpha(color, pulse));
        }
    }
}
