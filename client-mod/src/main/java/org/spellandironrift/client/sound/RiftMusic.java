package org.spellandironrift.client.sound;

import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.AbstractTickableSoundInstance;
import net.minecraft.client.resources.sounds.SoundInstance;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.spellandironrift.client.RiftClientMod;
import org.spellandironrift.client.gui.RiftDraw;
import org.spellandironrift.client.gui.RiftScene;

/**
 * Background music of the main menu (an original track, see tools/music). It fades in once the game has loaded,
 * keeps looping while the player is in the menu and its sub-screens, and fades out as the player dives into the
 * rift; if the connection fails it fades back in. While it plays, vanilla's own menu music is held back
 * (MusicManagerMixin), and in the world vanilla music works as usual. Volume follows the "Music" slider.
 */
@EventBusSubscriber(modid = RiftClientMod.MODID, value = Dist.CLIENT)
public final class RiftMusic {
    public static final SoundEvent MENU = SoundEvent.createVariableRangeEvent(RiftDraw.id("music.menu"));
    private static Track track;
    private static long lastTry;
    private static boolean logged;

    private RiftMusic() {}

    /** True while the menu theme is playing or fading out: vanilla music waits. */
    public static boolean playing() {
        return track != null && !track.isStopped() && Minecraft.getInstance().getSoundManager().isActive(track);
    }

    private static boolean wanted(Minecraft mc) {
        if (mc.level != null || mc.getOverlay() != null) return false;
        RiftScene.Phase phase = RiftScene.INSTANCE.phase;
        return phase == RiftScene.Phase.MENU || phase == RiftScene.Phase.BACK;
    }

    @SubscribeEvent
    public static void onTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        boolean want = wanted(mc);
        if (track != null && (track.isStopped() || !mc.getSoundManager().isActive(track)) && System.currentTimeMillis() - lastTry > 1000) track = null;
        if (want && track == null && System.currentTimeMillis() - lastTry > 5000) {
            lastTry = System.currentTimeMillis();
            mc.getMusicManager().stopPlaying();
            track = new Track();
            mc.getSoundManager().play(track);
        }
        if (track != null) track.want = want;
        if (!logged && playing()) { logged = true; RiftClientMod.LOG.info("Menu music: playing"); }
    }

    private static final class Track extends AbstractTickableSoundInstance {
        boolean want = true;
        private float level;

        Track() {
            super(MENU, SoundSource.MUSIC, SoundInstance.createUnseededRandom());
            looping = true;
            delay = 0;
            volume = 0.0001f;
            relative = true;
            attenuation = Attenuation.NONE;
        }

        /** Starts even at zero volume: it is faded in, and the Music slider may be raised later. */
        @Override
        public boolean canStartSilent() { return true; }

        @Override
        public void tick() {
            level = want ? Math.min(1, level + 1 / 60f) : Math.max(0, level - 1 / 50f); // 3 s in, 2.5 s out
            volume = Math.max(0.0001f, level * level);
            if (!want && level <= 0) stop();
        }
    }
}
