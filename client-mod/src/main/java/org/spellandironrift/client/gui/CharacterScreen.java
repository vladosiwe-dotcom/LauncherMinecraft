package org.spellandironrift.client.gui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.client.resources.PlayerSkin;

/** Large view of the player's character. Drag to rotate; the head still follows the cursor. */
public class CharacterScreen extends RiftSubScreen {
    private final PlayerModelRenderer character;
    private float spin, spinVelocity;
    private boolean dragging;

    public CharacterScreen(Screen parent, PlayerModelRenderer character) {
        super(Component.translatable("spellironrift.character.title"), parent);
        this.character = character;
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        if (!dragging) { spin += spinVelocity; spinVelocity *= 0.92f; }
        int cx = px + pw * 2 / 3, feet = py + ph - 30;
        float scale = ph * 0.42f;
        float t = (System.currentTimeMillis() % 1_000_000L) / 1000f;
        RiftStyle.runeRing(g, cx, feet, (int) (scale * 0.7f), t, RiftStyle.ARCANE);
        character.render(g, cx, feet, scale, mouseX, mouseY, spin);

        int x = px + 18, y = py + 50;
        g.drawString(font, minecraft.getUser().getName(), x, y, RiftStyle.TEXT, true);
        boolean slim = character.skin().model() == PlayerSkin.Model.SLIM;
        g.drawString(font, Component.translatable(slim ? "spellironrift.character.alex" : "spellironrift.character.steve"), x, y + 16, RiftStyle.TEXT_DIM, false);
        for (var line : font.split(Component.translatable("spellironrift.character.hint"), pw / 2 - 40))
            g.drawString(font, line, x, (y += 12) + 30, RiftStyle.TEXT_DIM, false);
        g.drawString(font, Component.translatable("spellironrift.character.drag"), cx - font.width(Component.translatable("spellironrift.character.drag")) / 2, py + 44, RiftStyle.withAlpha(RiftStyle.TEXT_DIM, 0.7f), false);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (mx > px + pw / 3.0 && button == 0) { dragging = true; return true; }
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseDragged(double mx, double my, int button, double dx, double dy) {
        if (dragging) { spin += (float) dx * 1.2f; spinVelocity = (float) dx * 0.6f; return true; }
        return super.mouseDragged(mx, my, button, dx, dy);
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        dragging = false;
        return super.mouseReleased(mx, my, button);
    }
}
