package org.spellandironrift.client.net;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/** Sends the one-use launcher ticket once after joining a server. */
@EventBusSubscriber(modid = "spellironrift", value = Dist.CLIENT)
public final class RiftAuthClient {
    private static boolean sent;

    private RiftAuthClient() {}

    @SubscribeEvent
    public static void onLoggingIn(ClientPlayerNetworkEvent.LoggingIn event) {
        if (sent) return;
        String ticket = System.getenv("RIFT_GAME_TICKET");
        if (ticket == null || ticket.isBlank()) return;
        sent = true;
        PacketDistributor.sendToServer(new AuthTicketPayload(ticket));
    }

    @SubscribeEvent
    public static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
        sent = false;
    }
}
