package org.spellandironrift.client.gui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.network.chat.Component;
import org.spellandironrift.client.config.RiftConfig;
import org.spellandironrift.client.graphics.GraphicsPresets;

/** Graphics presets, language, and a door to the full vanilla options. */
public class RiftSettingsScreen extends RiftSubScreen {
    private static final String[] PRESETS = { "minimal", "balanced", "high", "ultra" };
    private static final String[][] LANGS = { { "ru_ru", "Русский" }, { "uk_ua", "Українська" }, { "en_us", "English (Beta)" } };
    private Component status = Component.empty();

    public RiftSettingsScreen(Screen parent) { super(Component.translatable("spellironrift.settings.title"), parent); }

    @Override
    protected void init() {
        super.init();
        int x = px + 18, y = py + 62, bw = (pw - 36 - 3 * 8) / 4;
        for (int i = 0; i < PRESETS.length; i++) {
            String id = PRESETS[i];
            addRenderableWidget(new RiftButton(x + i * (bw + 8), y, bw, 30, Component.translatable("spellironrift.preset." + id),
                    Component.translatable(id.equals(RiftConfig.get().preset()) ? "spellironrift.preset.current" : "spellironrift.preset.apply"), i % 5, () -> applyPreset(id)));
        }
        y += 72;
        int lw = (pw - 36 - 2 * 8) / 3;
        for (int i = 0; i < LANGS.length; i++) {
            String[] l = LANGS[i];
            addRenderableWidget(new RiftButton(x + i * (lw + 8), y, lw, 26, Component.literal(l[1]), null, 3, () -> setLanguage(l[0])));
        }
        addRenderableWidget(new RiftButton(px + pw - 14 - 220, py + ph - 38, 220, 26, Component.translatable("spellironrift.settings.vanilla"), null, 2,
                () -> minecraft.setScreen(new OptionsScreen(this, minecraft.options))));
    }

    private void applyPreset(String id) {
        GraphicsPresets.Result r = GraphicsPresets.apply(Minecraft.getInstance(), id);
        RiftConfig.savePresetRequest(id);
        status = Component.translatable(r.shadersMissing() ? "spellironrift.preset.shadersNextLaunch" : "spellironrift.preset.applied", Component.translatable("spellironrift.preset." + id));
        rebuildWidgets();
    }

    private void setLanguage(String code) {
        Minecraft mc = Minecraft.getInstance();
        if (code.equals(mc.options.languageCode)) return;
        mc.getLanguageManager().setSelected(code);
        mc.options.languageCode = code;
        mc.options.save();
        mc.reloadResourcePacks();
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        g.drawString(font, Component.translatable("spellironrift.settings.graphics"), px + 18, py + 48, RiftStyle.GOLD, false);
        g.drawString(font, Component.translatable("spellironrift.settings.language"), px + 18, py + 120, RiftStyle.GOLD, false);
        int y = py + 172;
        for (var line : font.split(Component.translatable("spellironrift.settings.hint"), pw - 36)) { g.drawString(font, line, px + 18, y, RiftStyle.TEXT_DIM, false); y += 11; }
        g.drawString(font, status, px + 18, y + 8, RiftStyle.ARCANE, false);
    }
}
