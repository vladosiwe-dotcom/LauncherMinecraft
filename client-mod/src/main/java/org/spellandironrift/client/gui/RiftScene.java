package org.spellandironrift.client.gui;

import com.mojang.blaze3d.vertex.BufferBuilder;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Random;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import org.joml.Matrix4f;

import static org.spellandironrift.client.gui.RiftDraw.*;

/**
 * The scene behind the main menu and the trip into the server, shared by every screen it appears on
 * (menu → connecting → loading terrain → in game), so particles and animation continue without a cut.
 *
 * <p>Layout works in "stage" units: a 16:9 screen of W×360 (W between 480 and 854) scaled to the window,
 * the same grid as the browser mockup. The rift is the centre of the composition and shows the server state:
 * open and bright when online, sealed and grey when the server does not answer.
 *
 * <p>Entering: the character turns and steps into the rift, the camera dives after it, and an endless tunnel
 * replaces the loading screens while the game connects. The connection starts at the click, so the animation
 * never delays it. Success ends in light over the world; an error or cancel stalls the tunnel and pulls back.
 */
public final class RiftScene {
    public static final RiftScene INSTANCE = new RiftScene();

    public static final int H = 360, RIFT_TOP = 30, RIFT_BOT = 276, FEET = 280, FOCUS_Y = 116;
    public enum Phase { MENU, ENTER, TUNNEL, ARRIVED, BACK }

    private static final int SEALED_V = 0x5C5870, SEALED_A = 0x767286, SEALED_C = 0xAAA6B8;
    private static final int OPEN_V = 0x9A6BFF, OPEN_A = 0x5FC8FF, OPEN_C = 0xF0ECFF, GOLD = 0xF3DFA6;

    // stage geometry in GUI coordinates
    public int W = 640;
    public float S = 1, OX, OY;
    private int lastW = -1, lastH = -1;

    // state
    public Phase phase = Phase.MENU;
    public float phaseT, enterT;
    public float power, pull, boost, cam, tunnelA;
    public float tunnelSpeed, tunnelExit, tunnelGrey;
    public Component backReason;
    public float time, dt;
    private long last = System.nanoTime();

    // rift
    private final float[] ptX = new float[19], ptY = new float[19], ptT = new float[19], ptPh = new float[19];
    private final float[] lx = new float[19], ly = new float[19], rx = new float[19], ry = new float[19];
    private final float[][] innerStars = new float[46][4];
    private final List<float[]> motes = new ArrayList<>(); // x, y, vx, vy, life, max, colour, size, pull
    private final List<float[]> arcs = new ArrayList<>();  // life, then x/y pairs
    private float nextArc = 1.5f;
    private final Random rnd = new Random();

    // tunnel
    private final float[][] tStars = new float[300][4];   // x, y, z, colour
    private final List<float[]> rings = new ArrayList<>(); // z, rot, spin, rune, radii[30]
    private float ringTimer;

    private RiftScene() {
        for (float[] s : innerStars) { s[0] = rnd.nextFloat(); s[1] = rnd.nextFloat() * 2 - 1; s[2] = 0.4f + rnd.nextFloat(); s[3] = 0.3f + rnd.nextFloat() * 0.7f; }
    }

    // ------------------------------------------------------------------ time, layout, state

    /** Advances time once per rendered frame (several screens may ask in the same frame). */
    public void frame() {
        long now = System.nanoTime();
        if (now - last < 1_000_000L) return; // already advanced this frame
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        time += dt;
        phaseT += dt;
        stepPhase();
    }

    public void layout(int width, int height) {
        W = Math.round(clamp(360f * width / Math.max(1, height), 480, 854));
        S = Math.min(width / (float) W, height / (float) H);
        OX = (width - W * S) / 2f;
        OY = (height - H * S) / 2f;
        if (width != lastW || height != lastH) { lastW = width; lastH = height; buildRift(); }
    }

    public boolean reduceMotion() {
        try { return Minecraft.getInstance().options.screenEffectScale().get() < 0.5; } catch (Exception e) { return false; }
    }

    public void beginEnter() {
        phase = Phase.ENTER; phaseT = 0; enterT = 0; backReason = null;
        resetTunnel();
    }

    public void beginTunnel() { phase = Phase.TUNNEL; phaseT = 0; }

    public void beginArrival() { phase = Phase.ARRIVED; phaseT = 0; }

    /** Error or cancel: the tunnel stalls, the camera pulls back and the character steps out of the rift. */
    public void beginBack(Component reason) {
        if (phase != Phase.ENTER && phase != Phase.TUNNEL) return;
        backReason = reason;
        phase = Phase.BACK; phaseT = 0;
    }

    public boolean travelling() { return phase == Phase.ENTER || phase == Phase.TUNNEL; }

    /** Server state drives the rift: 1 online, 0 offline, 0.45 while checking. Pull is the hover on the main button. */
    public void steer(float powerTarget, float pullTarget) {
        power += (powerTarget - power) * Math.min(1, dt * 1.8f);
        pull += (pullTarget - pull) * Math.min(1, dt * 4f);
    }

    private void stepPhase() {
        switch (phase) {
            case ENTER -> {
                enterT += dt;
                boost = 1.5f * ease((enterT - 0.3f) / 0.6f);
                cam = reduceMotion() ? ease((enterT - 0.6f) / 0.6f) : clamp((enterT - 0.55f) / 1.05f, 0, 1);
                tunnelA = ease((enterT - 1.3f) / 0.35f);
                if (enterT >= 1.65f) beginTunnel();
            }
            case TUNNEL -> { tunnelA = 1; cam = 1; }
            case ARRIVED -> {
                tunnelExit = ease(phaseT / 0.45f);
                if (phaseT >= 1.4f) { phase = Phase.MENU; cam = 0; tunnelA = 0; boost = 0; tunnelExit = 0; }
            }
            case BACK -> {
                tunnelA = 1 - ease(phaseT / 0.6f);
                cam = 1 - ease((phaseT - 0.2f) / 0.9f);
                boost += (0 - boost) * Math.min(1, dt * 2);
                if (phaseT >= 1.7f) { phase = Phase.MENU; cam = 0; tunnelA = 0; }
            }
            case MENU -> { boost += (0 - boost) * Math.min(1, dt * 3); cam = 0; tunnelA = 0; }
        }
    }

    // ------------------------------------------------------------------ camera

    private float camZ() { return 1 + 13 * (float) Math.pow(cam, 2.4); }
    private float camFx() { return centreAt(0.35f); }
    private float camTx() { return camFx() + (W / 2f - camFx()) * ease(cam); }
    private float camTy() { return FOCUS_Y + (180 - FOCUS_Y) * ease(cam); }

    /** Stage space with the camera applied (rift, character). */
    public void pushStage(GuiGraphics g) {
        float z = camZ();
        g.pose().pushPose();
        g.pose().translate(OX, OY, 0);
        g.pose().scale(S, S, 1);
        g.pose().translate(camTx(), camTy(), 0);
        g.pose().scale(z, z, 1);
        g.pose().translate(-camFx(), -FOCUS_Y, 0);
    }

    /** Stage space without the camera (menu interface). */
    public void pushFlatStage(GuiGraphics g) {
        g.pose().pushPose();
        g.pose().translate(OX, OY, 0);
        g.pose().scale(S, S, 1);
    }

    public float toStageX(double guiX) { return (float) ((guiX - OX) / S); }
    public float toStageY(double guiY) { return (float) ((guiY - OY) / S); }

    // ------------------------------------------------------------------ backdrop

    /** The drawn location behind everything; far away, so it grows slower than the rift while the camera dives. */
    public void renderBackdrop(GuiGraphics g, int width, int height) {
        g.fill(0, 0, width, height, 0xFF05040A);
        float zw = 1 + (camZ() - 1) * 0.3f;
        g.pose().pushPose();
        g.pose().translate(OX, OY, 0);
        g.pose().scale(S, S, 1);
        g.pose().translate(camTx() - camFx(), camTy() - FOCUS_Y, 0);
        g.pose().translate(camFx(), FOCUS_Y, 0);
        g.pose().scale(zw, zw, 1);
        g.pose().translate(-camFx(), -FOCUS_Y, 0);
        int x0 = (W - 854) / 2;
        g.blit(BACKDROP, x0, 0, 854, H, 0f, 0f, 427, 180, 427, 180);
        g.pose().popPose();
        // vignette: darker edges and bottom so the interface reads on top
        g.fillGradient(0, 0, width, height / 4, 0x8C050409, 0x00050409);
        g.fillGradient(0, height * 7 / 10, width, height, 0x00050409, 0xCC050409);
    }

    // ------------------------------------------------------------------ rift

    private void buildRift() {
        Random r = new Random(11);
        float cx = W / 2f;
        for (int i = 0; i <= 18; i++) {
            float t = i / 18f;
            int side = i % 2 == 1 ? 1 : -1;
            float amp = i == 0 || i == 18 ? 0 : (1.5f + r.nextFloat() * 3.5f) * side * (float) Math.pow(Math.sin(Math.PI * t), 0.5);
            ptX[i] = cx + amp; ptY[i] = RIFT_TOP + (RIFT_BOT - RIFT_TOP) * t; ptT[i] = t; ptPh[i] = r.nextFloat() * 6.28f;
        }
    }

    /** Lens-shaped opening, widest above the character's head. */
    private static float halfW(float t, float open) {
        return open * 15 * (float) Math.pow(Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.66)), 1.1);
    }

    private float centreAt(float t) {
        float f = clamp(t, 0, 1) * 18;
        int i = Math.min(17, (int) f);
        return ptX[i] + (ptX[i + 1] - ptX[i]) * (f - i);
    }

    public float intensity() {
        float breath = reduceMotion() ? 1 : 0.92f + 0.08f * (float) Math.sin(time * 1.6);
        return (0.35f + 0.65f * power) * breath * (1 + 0.3f * pull) * (1 + boost);
    }

    /** Rift, light and motes in stage space (the caller has pushed {@link #pushStage}). */
    public void renderRift(GuiGraphics g) {
        boolean calm = reduceMotion();
        float p = power, breath = calm ? 1 : 0.92f + 0.08f * (float) Math.sin(time * 1.6);
        float I = intensity();
        float open = (0.3f + 0.7f * p) * breath * (1 + 0.25f * pull) * (1 + 1.1f * boost);
        int cv = mix(SEALED_V, OPEN_V, p), ca = mix(SEALED_A, OPEN_A, p), cc = mix(SEALED_C, OPEN_C, p);
        float cx = W / 2f;

        glow(g, cx, 150, 230, 230, cv, 0.22f * I);
        glow(g, cx, FEET, 110, 18, ca, 0.5f * I);
        glow(g, cx, FEET, 70, 10, cv, 0.35f * I);

        for (int i = 0; i <= 18; i++) {
            float hw = halfW(ptT[i], open), j = calm ? 0 : (float) Math.sin(time * 5 + ptPh[i]) * 0.45f * open;
            lx[i] = ptX[i] - hw - j; ly[i] = ptY[i];
            rx[i] = ptX[i] + hw + j * 0.7f; ry[i] = ptY[i];
        }
        g.flush();
        Matrix4f m = g.pose().last().pose();

        // the other side, seen through the tear
        int top = mix(0x14121A, 0x1A0C3C, p), mid = mix(0x1E1C26, 0x2C1260, p), bot = mix(0x100F14, 0x0E0822, p);
        BufferBuilder b = begin(false);
        for (int i = 0; i < 18; i++) {
            int c1 = 0xFF000000 | gradient(top, mid, bot, ptT[i]), c2 = 0xFF000000 | gradient(top, mid, bot, ptT[i + 1]);
            quad(b, m, lx[i], ly[i], rx[i], ry[i], rx[i + 1], ry[i + 1], lx[i + 1], ly[i + 1], c1, c1, c2, c2);
        }
        end(b);

        b = begin(true);
        for (float[] s : innerStars) {
            float t = (s[0] + (calm ? 0 : time * 0.012f * s[2])) % 1f;
            float y = RIFT_TOP + (RIFT_BOT - RIFT_TOP) * t, x = centreAt(t) + s[1] * halfW(t, open) * 0.8f;
            float a = s[3] * p * (0.6f + 0.4f * (float) Math.sin(time * 3 + s[0] * 40));
            rect(b, m, x - 0.4f, y - 0.4f, 0.8f, 0.8f, argb(cc, a));
        }
        // edges: wide soft glow, bright colour, white-hot core
        polyline(b, m, lx, ly, 19, 12, argb(cv, 0.07f * I)); polyline(b, m, rx, ry, 19, 12, argb(cv, 0.07f * I));
        polyline(b, m, lx, ly, 19, 5, argb(cv, 0.22f * I)); polyline(b, m, rx, ry, 19, 5, argb(cv, 0.22f * I));
        polyline(b, m, lx, ly, 19, 2.2f, argb(ca, 0.5f * I)); polyline(b, m, rx, ry, 19, 2.2f, argb(ca, 0.5f * I));
        polyline(b, m, lx, ly, 19, 0.8f, argb(cc, 0.95f * Math.min(1, I))); polyline(b, m, rx, ry, 19, 0.8f, argb(cc, 0.95f * Math.min(1, I)));

        // short arcs of energy leaving the edge while the rift is open
        nextArc -= dt;
        if (!calm && p > 0.7f && nextArc <= 0) {
            nextArc = 1.6f + rnd.nextFloat() * 3.2f;
            int i = 2 + rnd.nextInt(15);
            boolean left = rnd.nextBoolean();
            float x = left ? lx[i] : rx[i], y = left ? ly[i] : ry[i], dir = left ? -1 : 1;
            float[] arc = new float[11];
            arc[0] = 0.14f; arc[1] = x; arc[2] = y;
            for (int k = 0; k < 4; k++) { x += dir * (3 + rnd.nextFloat() * 6); y += (rnd.nextFloat() - 0.6f) * 7; arc[3 + k * 2] = x; arc[4 + k * 2] = y; }
            arcs.add(arc);
        }
        for (Iterator<float[]> it = arcs.iterator(); it.hasNext(); ) {
            float[] a = it.next();
            a[0] -= dt;
            if (a[0] <= 0) { it.remove(); continue; }
            float k = a[0] / 0.14f;
            for (int s = 0; s < 4; s++) {
                line(b, m, a[1 + s * 2], a[2 + s * 2], a[3 + s * 2], a[4 + s * 2], 2, argb(ca, 0.35f * k));
                line(b, m, a[1 + s * 2], a[2 + s * 2], a[3 + s * 2], a[4 + s * 2], 0.7f, argb(cc, k));
            }
        }

        // motes: thrown out when open, drawn in on hover, falling like ash when sealed
        float rate = (calm ? 6 : 26) * (0.15f + 0.85f * p) * (1 + pull + 2 * boost);
        float n = rate * dt;
        while (n > 0) { if (rnd.nextFloat() < n) spawnMote(p); n -= 1; }
        for (Iterator<float[]> it = motes.iterator(); it.hasNext(); ) {
            float[] o = it.next();
            o[4] += dt;
            if (o[8] > 0) {
                float t = clamp((o[1] - RIFT_TOP) / (RIFT_BOT - RIFT_TOP), 0, 1), dx = centreAt(t) - o[0];
                o[2] += dx * 3 * dt; o[3] *= 0.98f;
                if (Math.abs(dx) < 2) o[4] = o[5];
            }
            if (o[4] >= o[5]) { it.remove(); continue; }
            o[0] += o[2] * dt; o[1] += o[3] * dt;
            float a = (float) Math.sin(Math.PI * o[4] / o[5]) * 0.85f;
            int c = o[6] == 0 ? cv : o[6] == 1 ? ca : GOLD;
            rect(b, m, o[0] - o[7] / 2, o[1] - o[7] / 2, o[7], o[7], argb(c, a));
        }
        end(b);
    }

    private void spawnMote(float p) {
        int c = rnd.nextFloat() < 0.55f ? 0 : rnd.nextFloat() < 0.75f ? 1 : 2;
        float s = rnd.nextFloat() < 0.8f ? 1.2f : 2f;
        if (pull > 0.5f && p > 0.5f) {
            double ang = rnd.nextDouble() * Math.PI * 2;
            float r = 40 + rnd.nextFloat() * 120;
            motes.add(new float[]{W / 2f + (float) Math.cos(ang) * r, clamp(150 + (float) Math.sin(ang) * r * 0.7f, RIFT_TOP, RIFT_BOT), 0, 0, 0, 1.6f + rnd.nextFloat(), c, s, 1});
        } else if (p < 0.4f) {
            motes.add(new float[]{W / 2f + (rnd.nextFloat() - 0.5f) * 60, RIFT_TOP + rnd.nextFloat() * 100, (rnd.nextFloat() - 0.5f) * 3, 4 + rnd.nextFloat() * 5, 0, 3 + rnd.nextFloat() * 2, 0, 1, 0});
        } else {
            int i = 1 + rnd.nextInt(17);
            boolean left = rnd.nextBoolean();
            motes.add(new float[]{left ? lx[i] : rx[i], left ? ly[i] : ry[i], (left ? -1 : 1) * (5 + rnd.nextFloat() * 16), -(3 + rnd.nextFloat() * 12), 0, 2 + rnd.nextFloat() * 2.4f, c, s, 0});
        }
        if (motes.size() > 400) motes.remove(0);
    }

    private static int gradient(int top, int mid, int bot, float t) {
        return t < 0.5f ? mix(top, mid, t * 2) : mix(mid, bot, (t - 0.5f) * 2);
    }

    // ------------------------------------------------------------------ character at the foot of the rift

    /**
     * The player's model, backlit by the rift. During the entry it turns to the rift and steps into it;
     * on the way back it steps out again.
     */
    public void renderCharacter(GuiGraphics g, PlayerModelRenderer character, float lookX, float lookY) {
        float spin = 0, walk = 0;
        if (phase == Phase.ENTER) { spin = 180 * ease(enterT / 0.32f); walk = ease((enterT - 0.28f) / 0.6f); }
        else if (phase == Phase.BACK) { walk = 1 - ease((phaseT - 0.9f) / 0.5f); spin = 180 * (1 - ease((phaseT - 1.35f) / 0.3f)); }
        else if (phase != Phase.MENU) { spin = 180; walk = 1; }
        if (walk >= 0.999f) return;
        float I = intensity();
        int cv = mix(SEALED_V, OPEN_V, power);
        glow(g, W / 2f, FEET - 66, 40, 80, cv, 0.55f * Math.min(1.4f, I) * (1 - walk));
        g.flush();
        g.pose().pushPose();
        g.pose().translate(W / 2f, FEET - walk * 10, 0);
        g.pose().scale(1 - 0.5f * walk, 1 - 0.5f * walk, 1);
        g.pose().translate(-W / 2f, -FEET, 0);
        character.stride = walk > 0 && walk < 1 ? 1 : 0;
        // backlit: the front of the model is darker, the rift glow outlines it
        float lit = 0.62f + 0.08f * (1 - power);
        g.setColor(lit, lit * 0.97f, lit * 1.12f, 1 - walk);
        character.render(g, Math.round(W / 2f), FEET, 64, Math.round(lookX), Math.round(lookY), spin);
        g.setColor(1f, 1f, 1f, 1f);
        g.pose().popPose();
    }

    // ------------------------------------------------------------------ tunnel

    private void resetTunnel() {
        tunnelSpeed = 0.6f; tunnelExit = 0; tunnelGrey = 0; ringTimer = 0.5f;
        for (float[] s : tStars) newStar(s, 0.06f + rnd.nextFloat() * 4);
        rings.clear();
        for (float z = 0.7f; z < 4; z += 0.6f) rings.add(newRing(z));
    }

    private void newStar(float[] s, float z) {
        double a = rnd.nextDouble() * Math.PI * 2;
        float r = 0.12f + (float) Math.pow(rnd.nextFloat(), 0.6) * 1.5f;
        s[0] = (float) Math.cos(a) * r; s[1] = (float) Math.sin(a) * r; s[2] = z;
        s[3] = rnd.nextFloat() < 0.6f ? 0 : rnd.nextFloat() < 0.8f ? 1 : 2;
    }

    private float[] newRing(float z) {
        float[] r = new float[34];
        r[0] = z; r[1] = rnd.nextFloat() * 6.28f; r[2] = (rnd.nextFloat() - 0.5f) * 0.5f; r[3] = rnd.nextFloat() < 0.28f ? 1 : 0;
        float k = 1;
        for (int i = 0; i < 30; i++) {
            k = clamp(k + (rnd.nextFloat() - 0.5f) * 0.16f, 0.86f, 1.16f);
            r[4 + i] = i == 29 ? (k + r[4]) / 2 : k + (rnd.nextFloat() < 0.2f ? 0.08f : 0);
        }
        return r;
    }

    /** Full-screen flight through the rift, in GUI coordinates. */
    public void renderTunnel(GuiGraphics g, int w, int h, float alpha) {
        if (alpha <= 0.002f) return;
        boolean calm = reduceMotion();
        float target = phase == Phase.ARRIVED ? 7 : phase == Phase.BACK ? -0.8f : calm ? 0.35f : 1.6f;
        tunnelSpeed += (target - tunnelSpeed) * Math.min(1, dt * 2.4f);
        tunnelGrey += ((phase == Phase.BACK ? 1 : 0) - tunnelGrey) * Math.min(1, dt * 3);
        int cv = mix(OPEN_V, SEALED_V, tunnelGrey), ca = mix(OPEN_A, SEALED_A, tunnelGrey), cc = mix(OPEN_C, SEALED_C, tunnelGrey);
        float u = Math.min(w, h) / 360f, F = Math.min(w, h) * 0.5f;
        float vx = w / 2f + (calm ? 0 : (float) Math.sin(time * 0.6) * w * 0.03f);
        float vy = h / 2f + (calm ? 0 : (float) Math.cos(time * 0.45) * h * 0.025f);

        g.flush();
        Matrix4f m = g.pose().last().pose();
        BufferBuilder b = begin(false);
        rect(b, m, 0, 0, w, h, argb(0x05030B, alpha));
        end(b);
        glow(g, vx, vy, Math.max(w, h) * 0.75f, Math.max(w, h) * 0.75f, mix(0x2A1260, 0x18171E, tunnelGrey), alpha);
        glow(g, vx, vy, Math.max(w, h) * 0.3f, Math.max(w, h) * 0.3f, mix(0x4A20A0, 0x2C2A36, tunnelGrey), 0.8f * alpha);

        // torn rings of the rift edge and rune circles rushing past
        ringTimer -= dt * tunnelSpeed;
        if (ringTimer <= 0 && tunnelSpeed > 0) { rings.add(newRing(4.2f)); ringTimer = 0.6f; }
        for (float[] r : rings) { r[0] -= tunnelSpeed * dt * 0.9f; r[1] += r[2] * dt; }
        rings.removeIf(r -> r[0] <= 0.1f || r[0] >= 4.8f);
        rings.sort((a1, a2) -> Float.compare(a2[0], a1[0]));
        b = begin(true);
        float[] xs = new float[31], ys = new float[31];
        for (float[] r : rings) {
            float z = r[0], R = F / z, fade = clamp((4.2f - z) / 1.2f, 0, 1) * clamp((z - 0.1f) / 0.4f, 0, 1) * alpha;
            if (r[3] > 0) {
                float sz = clamp(2.2f * u / z, 0.8f, 9 * u);
                for (int i = 0; i < 56; i++) {
                    if (i % 7 == 0) continue;
                    double a = r[1] + i / 56.0 * Math.PI * 2;
                    rect(b, m, vx + (float) Math.cos(a) * R - sz / 2, vy + (float) Math.sin(a) * R - sz / 2, sz, sz, argb(0xC9A35B, 0.55f * fade));
                }
            } else {
                for (int i = 0; i <= 30; i++) {
                    int k = i % 30;
                    double a = r[1] + k / 30.0 * Math.PI * 2;
                    xs[i] = vx + (float) Math.cos(a) * R * r[4 + k];
                    ys[i] = vy + (float) Math.sin(a) * R * r[4 + k];
                }
                polyline(b, m, xs, ys, 31, clamp(9 * u / z, 2 * u, 40 * u), argb(cv, 0.16f * fade));
                polyline(b, m, xs, ys, 31, clamp(2.5f * u / z, u, 12 * u), argb(ca, 0.45f * fade));
                polyline(b, m, xs, ys, 31, clamp(0.8f * u / z, 0.6f * u, 4 * u), argb(cc, 0.8f * fade));
            }
        }
        // star streaks
        for (float[] s : tStars) {
            s[2] -= tunnelSpeed * dt;
            if (s[2] < 0.05f) newStar(s, 4);
            if (s[2] > 4.2f) newStar(s, 0.06f);
            float tail = s[2] + Math.abs(tunnelSpeed) * (calm ? 0.004f : 0.06f) + 0.002f;
            float x1 = vx + s[0] / s[2] * F, y1 = vy + s[1] / s[2] * F, x0 = vx + s[0] / tail * F, y0 = vy + s[1] / tail * F;
            float a = clamp((4 - s[2]) / 1.5f, 0, 1) * 0.85f * alpha;
            int c = s[3] == 0 ? cc : s[3] == 1 ? ca : GOLD;
            line(b, m, x0, y0, x1, y1, clamp(1.2f * u / s[2], 0.6f * u, 3.2f * u), argb(c, a));
        }
        end(b);
        // the light at the end
        float core = (16 + 10 * (float) Math.pow(Math.sin(time * 2.2), 2)) * u + tunnelExit * Math.max(w, h) * 1.3f;
        glow(g, vx, vy, core, core, cc, 0.95f * alpha);
        glow(g, vx, vy, core * 2.2f, core * 2.2f, ca, 0.45f * alpha);
    }
}
