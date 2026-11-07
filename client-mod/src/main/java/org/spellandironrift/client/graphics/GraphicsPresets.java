package org.spellandironrift.client.graphics;

import java.lang.reflect.Method;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.GraphicsStatus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.ParticleStatus;
import net.neoforged.fml.ModList;
import org.spellandironrift.client.RiftClientMod;

/**
 * The four Spell and Iron Rift presets. Values mirror shared/src/presets.ts in the launcher, which writes
 * the same keys into options.txt before launch; this class applies them live from the in-game settings screen.
 * Shaders are toggled through Iris' public API only if Iris is installed (the launcher installs it and a
 * compatible shader pack only for High/Ultra).
 */
public final class GraphicsPresets {
    public record Result(boolean shadersMissing) {}

    private GraphicsPresets() {}

    public static Result apply(Minecraft mc, String id) {
        Options o = mc.options;
        int oldMip = o.mipmapLevels().get();
        boolean shaders;
        switch (id) {
            case "minimal" -> { set(o, 8, 6, GraphicsStatus.FAST, ParticleStatus.MINIMAL, false, CloudStatus.OFF, 0, 0, 0.75, 120, false); shaders = false; }
            case "high" -> { set(o, 16, 10, GraphicsStatus.FANCY, ParticleStatus.ALL, true, CloudStatus.FANCY, 3, 4, 1.0, 260, true); shaders = true; }
            case "ultra" -> { set(o, 24, 12, GraphicsStatus.FANCY, ParticleStatus.ALL, true, CloudStatus.FANCY, 5, 4, 1.25, 260, true); shaders = true; }
            default -> { set(o, 12, 8, GraphicsStatus.FANCY, ParticleStatus.DECREASED, true, CloudStatus.FAST, 2, 2, 1.0, 144, true); shaders = false; }
        }
        o.save();
        if (oldMip != o.mipmapLevels().get()) {
            mc.updateMaxMipLevel(o.mipmapLevels().get());
            mc.delayTextureReload();
        }
        mc.levelRenderer.allChanged();
        return new Result(!setIrisShaders(shaders) && shaders);
    }

    private static void set(Options o, int render, int sim, GraphicsStatus gfx, ParticleStatus particles, boolean shadows, CloudStatus clouds,
                            int blend, int mip, double entityDist, int fps, boolean ao) {
        o.renderDistance().set(render);
        o.simulationDistance().set(sim);
        o.graphicsMode().set(gfx);
        o.particles().set(particles);
        o.entityShadows().set(shadows);
        o.cloudStatus().set(clouds);
        o.biomeBlendRadius().set(blend);
        o.mipmapLevels().set(mip);
        o.entityDistanceScaling().set(entityDist);
        o.framerateLimit().set(fps);
        o.ambientOcclusion().set(ao);
    }

    /** @return true if Iris is present and accepted the change */
    private static boolean setIrisShaders(boolean enabled) {
        if (!ModList.get().isLoaded("iris")) return false;
        try {
            Class<?> api = Class.forName("net.irisshaders.iris.api.v0.IrisApi");
            Object instance = api.getMethod("getInstance").invoke(null);
            Object config = api.getMethod("getConfig").invoke(instance);
            Method set = config.getClass().getMethod("setShadersEnabledAndApply", boolean.class);
            set.invoke(config, enabled);
            return true;
        } catch (ReflectiveOperationException | LinkageError e) {
            RiftClientMod.LOG.warn("Iris API not available, shaders unchanged", e);
            return false;
        }
    }
}
