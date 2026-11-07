package org.spellandironrift.client.gui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Shared look for secondary screens: panorama, graphite panel with a forged frame, gold title, back button. */
public abstract class RiftSubScreen extends Screen {
    protected final Screen parent;
    protected int px, py, pw, ph;

    protected RiftSubScreen(Component title, Screen parent) { super(title); this.parent = parent; }

    @Override
    protected void init() {
        pw = Math.min(width - 40, 620);
        ph = Math.min(height - 40, 380);
        px = (width - pw) / 2;
        py = (height - ph) / 2;
        addRenderableWidget(new RiftButton(px + 14, py + ph - 38, 150, 26, Component.translatable("spellironrift.back"), null, 4, this::onClose));
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        renderPanorama(g, partialTick);
        g.fillGradient(0, 0, width, height, 0xB0070710, 0xE007070B);
        RiftStyle.frame(g, px, py, pw, ph, 0xF0181622, 0xF00C0B11, RiftStyle.GOLD_LO);
        g.fill(px + 12, py + 34, px + pw - 12, py + 35, RiftStyle.withAlpha(RiftStyle.GOLD_LO, 0.7f));
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        g.pose().pushPose();
        g.pose().translate(px + 16, py + 12, 0);
        g.pose().scale(1.5f, 1.5f, 1f);
        g.drawString(font, title.getString().toUpperCase(java.util.Locale.ROOT), 0, 0, RiftStyle.GOLD_HI, true);
        g.pose().popPose();
    }

    @Override
    public void onClose() { minecraft.setScreen(parent); }
}
