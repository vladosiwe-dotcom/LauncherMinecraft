package org.spellandironrift.client.mixin;

import net.minecraft.client.sounds.MusicManager;
import org.spellandironrift.client.sound.RiftMusic;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** While the Rift menu theme plays, vanilla's music manager does not start its own tracks on top of it. */
@Mixin(MusicManager.class)
public abstract class MusicManagerMixin {
    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void spellironrift$holdForMenuTheme(CallbackInfo ci) {
        if (RiftMusic.playing()) ci.cancel();
    }
}
