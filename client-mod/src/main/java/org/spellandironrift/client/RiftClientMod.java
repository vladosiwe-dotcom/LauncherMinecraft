package org.spellandironrift.client;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spellandironrift.client.config.RiftConfig;

/** Client-only entry point. Everything the mod does is UI; it adds no blocks, items or network packets. */
@Mod(value = RiftClientMod.MODID, dist = Dist.CLIENT)
public final class RiftClientMod {
    public static final String MODID = "spellironrift";
    public static final Logger LOG = LoggerFactory.getLogger("SpellAndIronRift");

    public RiftClientMod(IEventBus modBus, ModContainer container) {
        RiftConfig.load();
        LOG.info("Spell and Iron Rift client loaded; official server {}:{}", RiftConfig.get().serverHost(), RiftConfig.get().serverPort());
    }
}
