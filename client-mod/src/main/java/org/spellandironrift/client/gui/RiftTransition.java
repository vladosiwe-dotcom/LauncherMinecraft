package org.spellandironrift.client.gui;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Renderable;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DisconnectedScreen;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.ProgressScreen;
import net.minecraft.client.gui.screens.ReceivingLevelScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import org.spellandironrift.client.RiftClientMod;
import org.spellandironrift.client.net.ServerPing;

import static org.spellandironrift.client.gui.RiftDraw.argb;
import static org.spellandironrift.client.gui.RiftDraw.ease;
import static org.spellandironrift.client.gui.RiftFonts.*;

/**
 * Draws the trip into the rift over the vanilla connecting and loading screens. The connection itself stays
 * vanilla (nothing about it is changed), only the picture: the camera dive, then the tunnel with the current
 * stage underneath, the vanilla Cancel button on top. When the world is ready, the light at the end of the tunnel
 * floods the screen and fades out over the world. A failed connection pulls back to the menu with the reason.
 */
@EventBusSubscriber(modid = RiftClientMod.MODID, value = Dist.CLIENT)
public final class RiftTransition {
    private static Field connectStatus;
    private static boolean connectStatusLooked;

    private RiftTransition() {}

    /** Mod-bus registration of the arrival layer (called from the mod constructor). */
    public static void registerLayers(RegisterGuiLayersEvent event) {
        event.registerAboveAll(RiftDraw.id("rift_arrival"), RiftTransition::renderArrival);
    }

    private static boolean isLoadingScreen(Screen s) {
        return s instanceof ConnectScreen || s instanceof ReceivingLevelScreen || s instanceof GenericMessageScreen || s instanceof ProgressScreen;
    }

    @SubscribeEvent
    public static void onRender(ScreenEvent.Render.Pre event) {
        RiftScene scene = RiftScene.INSTANCE;
        Screen screen = event.getScreen();
        if (!scene.travelling() || !isLoadingScreen(screen)) return;
        event.setCanceled(true);
        GuiGraphics g = event.getGuiGraphics();
        int w = screen.width, h = screen.height;
        scene.frame();
        scene.layout(w, h);
        scene.steer(1, 0);

        if (scene.tunnelA < 1) {
            scene.renderBackdrop(g, w, h);
            scene.pushStage(g);
            scene.renderRift(g);
            scene.renderCharacter(g, RiftMainMenuScreen.character(), RiftScene.INSTANCE.W / 2f, 200);
            g.pose().popPose();
            // the menu interface fades out over the first moments of the dive
            RiftMainMenuScreen menu = RiftMainMenuScreen.last();
            float uiA = 1 - ease(scene.enterT / 0.35f);
            if (menu != null && uiA > 0.01f) {
                scene.pushFlatStage(g);
                menu.renderUi(g, uiA, -1, -1, ServerPing.result());
                g.pose().popPose();
            }
        }
        scene.renderTunnel(g, w, h, scene.tunnelA);

        // stage of the connection and the vanilla buttons (Cancel)
        if (scene.phase == RiftScene.Phase.TUNNEL) {
            Font font = Minecraft.getInstance().font;
            float ta = ease(scene.phaseT / 0.6f);
            Component status = with(HEADING, statusOf(screen).getString().toUpperCase(java.util.Locale.ROOT));
            float u = h / 360f;
            int y = (int) (h - 70 * u);
            g.drawString(font, status, w / 2 - font.width(status) / 2, y, argb(RiftStyle.GOLD_HI, ta), false);
            Component hint = tr(BODY, "spellironrift.connect.cancel_hint");
            g.drawString(font, hint, w / 2 - font.width(hint) / 2, y + 14, argb(0x6E6880, ta), false);
            for (GuiEventListener child : screen.children()) {
                if (child instanceof Renderable r) r.render(g, event.getMouseX(), event.getMouseY(), event.getPartialTick());
            }
        }
    }

    /** What the vanilla screen says now (connecting, logging in, joining), or our wording for the loading screens. */
    private static Component statusOf(Screen screen) {
        if (screen instanceof ConnectScreen) {
            if (!connectStatusLooked) {
                connectStatusLooked = true;
                for (Field f : ConnectScreen.class.getDeclaredFields()) {
                    if (f.getType() == Component.class && !Modifier.isStatic(f.getModifiers())) {
                        try { f.setAccessible(true); connectStatus = f; } catch (Exception ignored) { }
                        break;
                    }
                }
            }
            if (connectStatus != null) {
                try {
                    Object v = connectStatus.get(screen);
                    if (v instanceof Component c && !c.getString().isBlank()) return c;
                } catch (Exception ignored) { }
            }
            return Component.translatable("spellironrift.connect.status");
        }
        return Component.translatable("spellironrift.connect.loading");
    }

    @SubscribeEvent
    public static void onOpening(ScreenEvent.Opening event) {
        RiftScene scene = RiftScene.INSTANCE;
        if (!scene.travelling()) return;
        if (event.getNewScreen() instanceof DisconnectedScreen ds) {
            Component reason = reasonOf(ds);
            event.setNewScreen(RiftMainMenuScreen.returning(Component.translatable("spellironrift.connect.failed", reason)));
        }
    }

    /** The disconnect reason (DisconnectedScreen keeps it in a details record or a plain Component field). */
    private static Component reasonOf(DisconnectedScreen screen) {
        for (Field f : DisconnectedScreen.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            try {
                f.setAccessible(true);
                Object v = f.get(screen);
                if (v == null) continue;
                for (Method m : v.getClass().getMethods()) {
                    if (m.getName().equals("reason") && m.getParameterCount() == 0 && Component.class.isAssignableFrom(m.getReturnType())) {
                        return (Component) m.invoke(v);
                    }
                }
            } catch (Exception ignored) { }
        }
        return screen.getTitle();
    }

    /** The world is open: start the arrival flash. */
    @SubscribeEvent
    public static void onTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (RiftScene.INSTANCE.travelling() && mc.screen == null && mc.level != null) RiftScene.INSTANCE.beginArrival();
    }

    /** Over the world: the tunnel's light grows to white, then the white fades and the world shows through. */
    private static void renderArrival(GuiGraphics g, DeltaTracker delta) {
        RiftScene scene = RiftScene.INSTANCE;
        if (scene.phase != RiftScene.Phase.ARRIVED) return;
        int w = g.guiWidth(), h = g.guiHeight();
        scene.frame();
        float t = scene.phaseT;
        if (t < 0.45f) scene.renderTunnel(g, w, h, 1);
        float white = t < 0.45f ? ease((t - 0.2f) / 0.25f) : 1 - ease((t - 0.45f) / 0.9f);
        if (white > 0.002f) g.fill(0, 0, w, h, argb(0xFFFFFF, white));
    }
}
