package org.spellandironrift.client;

import java.util.Set;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ScreenEvent;
import org.spellandironrift.client.gui.RiftMainMenuScreen;

/**
 * Replaces the vanilla title screen and closes every path to singleplayer, world creation,
 * the server list and Realms. Matching by class name keeps this stable across mapping changes
 * (NeoForge 1.21.1 runs with Mojang names at runtime).
 */
@EventBusSubscriber(modid = RiftClientMod.MODID, value = Dist.CLIENT)
public final class ScreenHooks {
    private static final Set<String> BLOCKED = Set.of(
            "net.minecraft.client.gui.screens.worldselection.SelectWorldScreen",
            "net.minecraft.client.gui.screens.worldselection.CreateWorldScreen",
            "net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen",
            "net.minecraft.client.gui.screens.DirectJoinServerScreen",
            "net.minecraft.client.gui.screens.EditServerScreen",
            "net.minecraft.client.gui.screens.multiplayer.SafetyScreen",
            "com.mojang.realmsclient.RealmsMainScreen");

    private ScreenHooks() {}

    @SubscribeEvent(priority = EventPriority.HIGHEST)
    public static void onOpen(ScreenEvent.Opening event) {
        Screen next = event.getNewScreen();
        if (next == null) return;
        if (next instanceof TitleScreen || BLOCKED.contains(next.getClass().getName())) {
            event.setNewScreen(new RiftMainMenuScreen());
        }
    }
}
