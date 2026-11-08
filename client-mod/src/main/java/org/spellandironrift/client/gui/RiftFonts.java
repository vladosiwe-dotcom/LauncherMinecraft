package org.spellandironrift.client.gui;

import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.ResourceLocation;

/**
 * The launcher's typefaces in game: Cormorant SC for the logo, headings and the main button,
 * Rubik for everything else (assets/spellironrift/font/*.json, both under the SIL Open Font License).
 */
public final class RiftFonts {
    public static final ResourceLocation LOGO = RiftDraw.id("logo");          // Cormorant SC Bold, large
    public static final ResourceLocation HEADING = RiftDraw.id("heading");    // Cormorant SC Bold, button / status
    public static final ResourceLocation HEADING_SMALL = RiftDraw.id("heading_small"); // Cormorant SC Bold, card titles
    public static final ResourceLocation EYEBROW = RiftDraw.id("eyebrow");    // Cormorant SC Bold, small caps labels
    public static final ResourceLocation COUNT = RiftDraw.id("count");        // Cormorant SC Bold, the online number
    public static final ResourceLocation BODY = RiftDraw.id("body");          // Rubik Regular
    public static final ResourceLocation BODY_MEDIUM = RiftDraw.id("body_medium"); // Rubik Medium

    private RiftFonts() {}

    public static MutableComponent with(ResourceLocation font, Component c) {
        return Component.empty().append(c).withStyle(s -> s.withFont(font));
    }

    public static MutableComponent with(ResourceLocation font, String s) {
        return Component.literal(s).withStyle(st -> st.withFont(font));
    }

    public static MutableComponent tr(ResourceLocation font, String key, Object... args) {
        return Component.translatable(key, args).withStyle(s -> s.withFont(font));
    }
}
