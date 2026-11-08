package org.spellandironrift.guard;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Dedicated-server entry point. All behaviour lives in {@link Guard} (game event subscribers). */
@Mod(value = GuardMod.MODID, dist = Dist.DEDICATED_SERVER)
public final class GuardMod {
    public static final String MODID = "spellironrift_guard";
    public static final Logger LOG = LoggerFactory.getLogger("SpellAndIronRiftGuard");

    public GuardMod() {
        GuardConfig.load();
    }
}
