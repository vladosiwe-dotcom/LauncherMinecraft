package org.spellandironrift.client.gui;

import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import java.util.concurrent.CompletableFuture;
import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.client.resources.PlayerSkin;
import net.minecraft.util.Mth;
import org.spellandironrift.client.RiftClientMod;

/**
 * Draws the signed-in player's real 3D model (Steve/wide or Alex/slim arms) with their current skin,
 * without needing a world. Head and upper body follow a look target; idle animation adds breathing,
 * arm sway, weight shift, occasional glances and a short "cast" gesture.
 */
public final class PlayerModelRenderer {
    private PlayerModel<AbstractClientPlayer> wide, slim;
    private volatile PlayerSkin skin;
    private final long born = System.currentTimeMillis();
    private long lastFrame = System.nanoTime();

    // smoothed angles (degrees)
    private float headYaw, headPitch, bodyYaw;
    private float castTimer; // seconds left of the cast gesture
    private float glanceTimer, nextGlance = 6f, glanceX, glanceY;
    private int lastMouseX, lastMouseY;
    /**
     * Screen-space to model-space yaw direction. The GUI flips Z (scale(s, s, -s)) so the model's
     * front (-Z) faces the viewer; if the head turns away from the cursor on a given driver/version, flip this to -1.
     */
    static final float LOOK_SIGN = 1f;
    private float idleTime;

    public PlayerModelRenderer() {
        Minecraft mc = Minecraft.getInstance();
        GameProfile profile = mc.getGameProfile();
        skin = DefaultPlayerSkin.get(profile.getId());
        // The session profile has no texture properties; fetch the full profile off-thread, then resolve the skin.
        CompletableFuture.supplyAsync(() -> {
            var result = mc.getMinecraftSessionService().fetchProfile(profile.getId(), false);
            return result != null ? result.profile() : profile;
        }, Util.backgroundExecutor())
                .thenCompose(p -> mc.getSkinManager().getOrLoad(p))
                .thenAccept(s -> skin = s)
                .exceptionally(e -> { RiftClientMod.LOG.warn("Skin lookup failed, using default skin", e); return null; });
    }

    public PlayerSkin skin() { return skin; }
    public boolean isSlim() { return skin.model() == PlayerSkin.Model.SLIM; }
    public void cast() { castTimer = 0.9f; }

    /** 0 = standing, 1 = walking (legs and arms swing); set by the rift scene while the character steps into the rift. */
    public float stride;

    private PlayerModel<AbstractClientPlayer> model() {
        Minecraft mc = Minecraft.getInstance();
        if (isSlim()) {
            if (slim == null) slim = new PlayerModel<>(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER_SLIM), true);
            return slim;
        }
        if (wide == null) wide = new PlayerModel<>(mc.getEntityModels().bakeLayer(ModelLayers.PLAYER), false);
        return wide;
    }

    /**
     * @param cx,feetY screen position of the character's feet centre
     * @param scale pixels per block (the model is ~1.9 blocks tall)
     * @param lookX,lookY point the character looks at (mouse or hovered button)
     * @param extraYaw additional body rotation (character screen drag)
     */
    public void render(GuiGraphics g, int cx, int feetY, float scale, int lookX, int lookY, float extraYaw) {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - lastFrame) / 1e9f);
        lastFrame = now;
        float t = (System.currentTimeMillis() - born) / 1000f;

        // idle glance: if the mouse has not moved for a while, look somewhere else briefly
        if (lookX != lastMouseX || lookY != lastMouseY) { idleTime = 0; lastMouseX = lookX; lastMouseY = lookY; } else idleTime += dt;
        if (idleTime > 4f) {
            nextGlance -= dt;
            if (nextGlance <= 0 && glanceTimer <= 0) {
                glanceTimer = 1.6f; nextGlance = 5f + (float) Math.random() * 5f;
                glanceX = cx + (float) (Math.random() - 0.5) * scale * 4; glanceY = feetY - scale * (1.2f + (float) Math.random());
            }
        }
        float tx = lookX, ty = lookY;
        if (glanceTimer > 0) { glanceTimer -= dt; tx = glanceX; ty = glanceY; }

        float headY = feetY - scale * 1.62f;
        float dx = (tx - cx) / scale, dy = (ty - headY) / scale;
        float targetHeadYaw = LOOK_SIGN * (float) Math.toDegrees(Math.atan(dx / 1.6f)) * 1.1f;
        float targetPitch = (float) Math.toDegrees(Math.atan(dy / 1.6f)) * 0.8f;
        float targetBody = targetHeadYaw * 0.35f;
        float k = Math.min(1f, dt * 6f);
        headYaw = Mth.lerp(k, headYaw, Mth.clamp(targetHeadYaw, -70f, 70f));
        headPitch = Mth.lerp(k, headPitch, Mth.clamp(targetPitch, -35f, 40f));
        bodyYaw = Mth.lerp(k * 0.6f, bodyYaw, Mth.clamp(targetBody, -25f, 25f));
        if (castTimer > 0) castTimer -= dt;

        PlayerModel<AbstractClientPlayer> m = model();
        m.young = false;
        m.crouching = false;
        m.riding = false;
        // head (relative to body)
        m.head.yRot = (float) Math.toRadians(headYaw - bodyYaw);
        m.head.xRot = (float) Math.toRadians(headPitch);
        m.head.zRot = (float) Math.sin(t * 0.7) * 0.03f;
        // weight shift and breathing
        m.body.yRot = 0; m.body.xRot = 0;
        m.body.zRot = (float) Math.sin(t * 0.45) * 0.02f;
        float sway = (float) Math.sin(t * 1.35);
        m.rightArm.xRot = sway * 0.05f; m.leftArm.xRot = -sway * 0.05f;
        m.rightArm.zRot = 0.06f + (float) Math.cos(t * 1.1) * 0.035f;
        m.leftArm.zRot = -0.06f - (float) Math.cos(t * 1.1) * 0.035f;
        m.rightArm.yRot = 0; m.leftArm.yRot = 0;
        if (castTimer > 0) { // raise the right arm towards the rift
            float p = Mth.sin((0.9f - castTimer) / 0.9f * Mth.PI);
            m.rightArm.xRot = -2.4f * p;
            m.rightArm.zRot = 0.25f * p;
        }
        m.rightLeg.xRot = 0; m.leftLeg.xRot = 0; m.rightLeg.zRot = 0.02f; m.leftLeg.zRot = -0.02f;
        if (stride > 0) {
            float swing = (float) Math.sin(t * 14) * 0.6f * stride;
            m.rightLeg.xRot = swing; m.leftLeg.xRot = -swing;
            m.rightArm.xRot = -swing * 0.8f; m.leftArm.xRot = swing * 0.8f;
        }
        m.hat.copyFrom(m.head);
        m.jacket.copyFrom(m.body);
        m.rightSleeve.copyFrom(m.rightArm); m.leftSleeve.copyFrom(m.leftArm);
        m.rightPants.copyFrom(m.rightLeg); m.leftPants.copyFrom(m.leftLeg);

        float breathe = (float) Math.sin(t * 2.1) * 0.012f;
        PoseStack pose = g.pose();
        pose.pushPose();
        // Model units: 1 block = 16 model pixels, head top at y=-0.5, feet at y=+1.5 (y down, like the screen).
        pose.translate(cx, feetY - scale * 1.5f * (1 + breathe), 150);
        pose.scale(scale, scale * (1 + breathe), -scale);
        pose.mulPose(Axis.YP.rotationDegrees(bodyYaw + extraYaw));
        Lighting.setupForEntityInInventory();
        VertexConsumer vc = g.bufferSource().getBuffer(m.renderType(skin.texture()));
        m.renderToBuffer(pose, vc, LightTexture.FULL_BRIGHT, OverlayTexture.NO_OVERLAY, -1);
        g.flush();
        Lighting.setupFor3DItems();
        pose.popPose();
    }
}
