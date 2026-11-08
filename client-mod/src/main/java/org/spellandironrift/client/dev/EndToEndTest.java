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
import org.spellandironrift.client.sound.RiftMusic;

/**
 * Automated end-to-end run used only by the GitHub test (environment variable RIFT_E2E=1; does nothing otherwise).
 * Plays the path of a real player: menu → "Enter the Rift" → tunnel → world → System window → quit,
 * saving a screenshot at each step. The test fails if this never logs "E2E: passed" or a crash report appears.
 */
@EventBusSubscriber(modid = RiftClientMod.MODID, value = Dist.CLIENT)
public final class EndToEndTest {
    private static final boolean ON = "1".equals(System.getenv("RIFT_E2E"));
    /** Two-player run: this client stays in the world until another player has joined and finished awakening. */
    private static final boolean WAIT_PLAYER = "1".equals(System.getenv("RIFT_E2E_WAIT_PLAYER"));
    private static long otherSeenAt;
    private static final long STARTED = System.currentTimeMillis();
    private static int stage;
    private static long stageAt = System.currentTimeMillis();
    private static long menuReadyAt;
    private static int menuStep;

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
            case 0 -> { // main menu is up (the loading overlay is gone and the menu has faded in) and the server answered
                boolean ready = mc.screen instanceof RiftMainMenuScreen && mc.getOverlay() == null && ServerPing.result().state() == ServerPing.State.ONLINE;
                if (!ready) menuReadyAt = 0;
                else if (menuReadyAt == 0) menuReadyAt = System.currentTimeMillis();
                else if (System.currentTimeMillis() - menuReadyAt > 2500 && t > 4000) { shot("1-menu"); next("menu shown, server online"); }
            }
            case 1 -> { // the buttons as they look when pointed at; the menu stays up long enough for its music
                if (!(mc.screen instanceof RiftMainMenuScreen menu)) break;
                if (menuStep == 0 && t > 800) { menu.showFocus(0); menuStep++; }
                else if (menuStep == 1 && t > 1600) { shot("1b-menu-enter-focus"); menuStep++; }
                else if (menuStep == 2 && t > 2000) { menu.showFocus(2); menuStep++; }
                else if (menuStep == 3 && t > 2800) { shot("1c-menu-row-focus"); menuStep++; }
                else if (menuStep == 4 && t > 3200) { menu.showFocus(-1); menuStep++; }
                else if (menuStep == 5 && t > 10000) {
                    RiftClientMod.LOG.info("E2E: menu music {}", RiftMusic.playing() ? "playing" : "NOT playing");
                    // the menu was photographed at the requested size; the rest runs in a small window so that two
                    // software-rendered clients and the server keep real-time pace on the CI machine
                    if (mc.getWindow().getWidth() > 1000) org.lwjgl.glfw.GLFW.glfwSetWindowSize(mc.getWindow().getWindow(), 854, 480);
                    menu.pressEnter();
                    next("pressed Enter the Rift");
                }
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
            case 6 -> { if (readyToLeave(mc, t)) { shot("5-world"); openSystemWindow(mc); next("opened the System window"); } }
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
        if (stage < 99 && System.currentTimeMillis() - STARTED > (WAIT_PLAYER ? 25 : 12) * 60_000L) fail("timed out at stage " + stage);
    }

    /** One player: 13 s for the own awakening. Two players: until the other one joined 18 s ago (8 s scene + margin). */
    private static boolean readyToLeave(Minecraft mc, long t) {
        if (!WAIT_PLAYER) return t > 13000;
        if (otherSeenAt == 0 && mc.level != null && mc.level.players().size() >= 2) {
            otherSeenAt = System.currentTimeMillis();
            RiftClientMod.LOG.info("E2E: another player is here");
        }
        if (otherSeenAt == 0 && t > 15 * 60_000L) fail("the second player never came");
        return otherSeenAt > 0 && System.currentTimeMillis() - otherSeenAt > 18000;
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
