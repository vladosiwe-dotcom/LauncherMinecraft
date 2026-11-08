package org.spellandironrift.client.gui;

import com.mojang.blaze3d.platform.GlStateManager;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.MeshData;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.resources.ResourceLocation;
import org.joml.Matrix4f;
import org.spellandironrift.client.RiftClientMod;

/**
 * Immediate-mode drawing for the rift: coloured quads with additive blending (glowing edges, motes, tunnel rings)
 * and a soft glow sprite. GuiGraphics batches its own fills, so callers flush it before drawing through here.
 */
public final class RiftDraw {
    public static final ResourceLocation GLOW = id("textures/gui/glow.png");
    public static final ResourceLocation BACKDROP = id("textures/gui/menu_backdrop.png");
    public static final ResourceLocation SIGIL = id("textures/gui/sigil.png");

    private RiftDraw() {}

    public static ResourceLocation id(String path) {
        return ResourceLocation.fromNamespaceAndPath(RiftClientMod.MODID, path);
    }

    /** Starts a batch of coloured quads. */
    public static BufferBuilder begin(boolean additive) {
        RenderSystem.enableBlend();
        RenderSystem.disableCull();
        if (additive) RenderSystem.blendFunc(GlStateManager.SourceFactor.SRC_ALPHA, GlStateManager.DestFactor.ONE);
        else RenderSystem.defaultBlendFunc();
        RenderSystem.setShader(GameRenderer::getPositionColorShader);
        return Tesselator.getInstance().begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
    }

    public static void end(BufferBuilder b) {
        MeshData mesh = b.build();
        if (mesh != null) BufferUploader.drawWithShader(mesh);
        RenderSystem.defaultBlendFunc();
        RenderSystem.enableCull();
    }

    public static void quad(BufferBuilder b, Matrix4f m, float x1, float y1, float x2, float y2, float x3, float y3, float x4, float y4, int c1, int c2, int c3, int c4) {
        b.addVertex(m, x1, y1, 0).setColor(c1);
        b.addVertex(m, x2, y2, 0).setColor(c2);
        b.addVertex(m, x3, y3, 0).setColor(c3);
        b.addVertex(m, x4, y4, 0).setColor(c4);
    }

    public static void rect(BufferBuilder b, Matrix4f m, float x, float y, float w, float h, int argb) {
        quad(b, m, x, y, x, y + h, x + w, y + h, x + w, y, argb, argb, argb, argb);
    }

    /** A straight segment of the given width. */
    public static void line(BufferBuilder b, Matrix4f m, float x1, float y1, float x2, float y2, float width, int argb) {
        float dx = x2 - x1, dy = y2 - y1, len = (float) Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-4f) return;
        float nx = -dy / len * width / 2, ny = dx / len * width / 2;
        quad(b, m, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x2 - nx, y2 - ny, x2 + nx, y2 + ny, argb, argb, argb, argb);
    }

    /** Polyline through points xs/ys (segments overlap slightly at joints, which is invisible under additive glow). */
    public static void polyline(BufferBuilder b, Matrix4f m, float[] xs, float[] ys, int n, float width, int argb) {
        for (int i = 0; i < n - 1; i++) line(b, m, xs[i], ys[i], xs[i + 1], ys[i + 1], width, argb);
    }

    /** Soft additive glow: an ellipse centred at cx, cy with radii rx, ry. */
    public static void glow(GuiGraphics g, float cx, float cy, float rx, float ry, int rgb, float alpha) {
        if (alpha <= 0.003f || rx <= 0 || ry <= 0) return;
        g.flush();
        RenderSystem.enableBlend();
        RenderSystem.blendFunc(GlStateManager.SourceFactor.SRC_ALPHA, GlStateManager.DestFactor.ONE);
        g.setColor(((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f, Math.min(1f, alpha));
        g.pose().pushPose();
        g.pose().translate(cx - rx, cy - ry, 0);
        g.pose().scale(rx * 2 / 128f, ry * 2 / 128f, 1f);
        g.blit(GLOW, 0, 0, 128, 128, 0f, 0f, 128, 128, 128, 128);
        g.pose().popPose();
        g.setColor(1f, 1f, 1f, 1f);
        RenderSystem.defaultBlendFunc();
    }

    public static int argb(int rgb, float alpha) {
        int a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        return (a << 24) | (rgb & 0xFFFFFF);
    }

    public static int mix(int a, int b, float t) {
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return ((int) (ar + (br - ar) * t) << 16) | ((int) (ag + (bg - ag) * t) << 8) | (int) (ab + (bb - ab) * t);
    }

    public static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    public static float ease(float t) {
        t = clamp(t, 0f, 1f);
        return t * t * (3 - 2 * t);
    }
}
