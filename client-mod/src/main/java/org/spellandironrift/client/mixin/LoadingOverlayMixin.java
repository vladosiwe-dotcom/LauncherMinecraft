package org.spellandironrift.client.mixin;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.LoadingOverlay;
import org.spellandironrift.client.gui.RiftTransition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * If the server sends a resource pack, Minecraft reloads resources behind its own Mojang loading screen.
 * While the player is flying into the rift, the tunnel is drawn over it. Only the picture changes:
 * the vanilla method still runs first, so loading, progress and closing the overlay work as usual.
 */
@Mixin(LoadingOverlay.class)
public abstract class LoadingOverlayMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void spellironrift$drawTunnel(GuiGraphics graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
        RiftTransition.renderOverReload(graphics);
    }
}
