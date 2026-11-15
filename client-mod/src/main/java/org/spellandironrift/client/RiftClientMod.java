package org.spellandironrift.client;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spellandironrift.client.config.RiftConfig;

/** Client-only entry point. The mod provides the UI and sends the one-use Rift authentication ticket. */
@Mod(value = RiftClientMod.MODID, dist = Dist.CLIENT)
public final class RiftClientMod {
    public static final String MODID = "spellironrift";
    public static final Logger LOG = LoggerFactory.getLogger("SpellAndIronRift");

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        event.registrar("1").playToServer(
                org.spellandironrift.client.net.AuthTicketPayload.TYPE,
                org.spellandironrift.client.net.AuthTicketPayload.STREAM_CODEC,
                (payload, context) -> { }
        );
    }

    public RiftClientMod(IEventBus modBus, ModContainer container) {
        RiftConfig.load();
        modBus.addListener(RiftClientMod::registerPayloads);
        modBus.addListener(org.spellandironrift.client.gui.RiftTransition::registerLayers);
        LOG.info("Spell and Iron Rift client loaded; official server {}:{}", RiftConfig.get().serverHost(), RiftConfig.get().serverPort());
    }
}
