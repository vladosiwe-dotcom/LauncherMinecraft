package org.spellandironrift.client.dev;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.Screen;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.spellandironrift.client.RiftClientMod;
import org.spellandironrift.client.gui.RiftMainMenuScreen;
import org.spellandironrift.client.gui.RiftScene;
import org.spellandironrift.client.net.ServerPing;

/**
 * Automated end-to-end run used only by the GitHub test (environment variable RIFT_E2E=1; does nothing otherwise).
 * Plays the path of a real player: menu → "Enter the Rift" → tunnel → world → System window → quit,
 * saving a screenshot at each step. The test fails if this never logs "E2E: passed" or a crash report appears.
 */
@EventBusSubscriber(modid = RiftClientMod.MODID, value = Dist.CLIENT)
public final class EndToEndTest {
    private static final boolean ON = "1".equals(System.getenv("RIFT_E2E"));
    private static final long STARTED = System.currentTimeMillis();
    private static int stage;
    private static long stageAt = System.currentTimeMillis();

    private EndToEndTest() {}

    private static void next(String what) {
        stage++;
        stageAt = System.currentTimeMillis();
        RiftClientMod.LOG.info("E2E: {}", what);
    }

    private static void shot(String name) {
        Minecraft mc = Minecraft.getInstance();
        Screenshot.grab(mc.gameDirectory, "e2e-" + name + ".png", mc.getMainRenderTarget(), msg -> RiftClientMod.LOG.info("E2E: screenshot {}", name));
    }

    @SubscribeEvent
    public static void onTick(ClientTickEvent.Post event) {
        if (!ON || stage >= 99) return;
        Minecraft mc = Minecraft.getInstance();
        long t = System.currentTimeMillis() - stageAt;
        RiftScene scene = RiftScene.INSTANCE;
        switch (stage) {
            case 0 -> { // main menu is up and the server answered the ping
                if (mc.screen instanceof RiftMainMenuScreen && ServerPing.result().state() == ServerPing.State.ONLINE && t > 4000) { shot("1-menu"); next("menu shown, server online"); }
            }
            case 1 -> {
                if (t > 600 && mc.screen instanceof RiftMainMenuScreen menu) { menu.pressEnter(); next("pressed Enter the Rift"); }
            }
            case 2 -> { // dive into the rift (picture taken mid-dive)
                if (scene.phase == RiftScene.Phase.ENTER && scene.enterT > 1.0f) { shot("2-dive"); next("camera dive"); }
                else if (scene.phase != RiftScene.Phase.ENTER) next("dive already over");
            }
            case 3 -> { // tunnel while the game connects (may be too short to catch on a local server)
                if (scene.phase == RiftScene.Phase.TUNNEL && scene.phaseT > 0.4f) { shot("3-tunnel"); next("tunnel"); }
                else if (mc.level != null || scene.phase == RiftScene.Phase.ARRIVED) next("connected before the tunnel picture");
            }
            case 4 -> {
                if (mc.level != null && mc.player != null && mc.screen == null) next("in the world as " + mc.player.getGameProfile().getName());
                else if (scene.phase == RiftScene.Phase.BACK || scene.phase == RiftScene.Phase.MENU && t > 3000) fail("connection failed: " + (scene.backReason != null ? scene.backReason.getString() : "?"));
            }
            case 5 -> { if (t > 350) { shot("4-arrival"); next("arrival light"); } }
            case 6 -> { if (t > 13000) { shot("5-world"); openSystemWindow(mc); next("opened the System window"); } }
            case 7 -> { if (t > 2500) { shot("6-system"); mc.setScreen(null); next("closed the System window"); } }
            case 8 -> {
                if (t > 1500) {
                    RiftClientMod.LOG.info("E2E: passed");
                    stage = 99;
                    mc.stop();
                }
            }
            default -> { }
        }
        if (stage < 99 && System.currentTimeMillis() - STARTED > 12 * 60_000L) fail("timed out at stage " + stage);
    }

    private static void fail(String why) {
        RiftClientMod.LOG.error("E2E: FAILED: {}", why);
        stage = 99;
        Minecraft.getInstance().stop();
    }

    /** Solo Status is a separate mod: open its window by class name so this mod does not depend on it. */
    private static void openSystemWindow(Minecraft mc) {
        try {
            Class<?> win = Class.forName("com.vladosiwe.solostatus.client.ui.SystemScreen$Win");
            Class<?> cls = Class.forName("com.vladosiwe.solostatus.client.ui.SystemScreen");
            mc.setScreen((Screen) cls.getConstructor(win).newInstance((Object) null));
        } catch (Throwable e) {
            RiftClientMod.LOG.warn("E2E: Solo Status window not available: {}", e.toString());
        }
    }

}
