"""
Main-menu theme for Spell and Iron Rift: a calm piano piece, synthesised from scratch (no samples, no
third-party music). Original composition.

A minor, 63 bpm. Soft felt piano: broken chords in the left hand, a simple melody in the right; a very quiet
string pad underneath; in the second half the melody rises an octave with a music-box doubling. Piano tone is
additive (slightly inharmonic partials, brighter and faster-decaying high partials, a soft hammer), the room is
a circular convolution reverb, so the end flows straight into the start and the track loops without a seam.

    python3 tools/music/menu_theme.py out.wav      # then: ffmpeg -i out.wav -c:a libvorbis -q:a 4 menu.ogg
"""
import sys
import wave
import numpy as np

SR = 44100
BPM = 63
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(3)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# 16 bars, played twice (second time with the melody an octave up and a music box)
CHORDS = [  # root (low) and the chord tones above it
    (45, [57, 60, 64]),  # Am
    (41, [57, 60, 65]),  # F
    (48, [55, 60, 64]),  # C
    (43, [55, 59, 62]),  # G
    (45, [57, 60, 64]),  # Am
    (41, [57, 60, 65]),  # F
    (43, [55, 59, 62]),  # G
    (40, [56, 59, 64]),  # E
    (41, [57, 60, 65]),  # F
    (43, [55, 59, 62]),  # G
    (40, [55, 59, 64]),  # Em
    (45, [57, 60, 64]),  # Am
    (41, [57, 60, 65]),  # F
    (43, [55, 59, 62]),  # G
    (48, [55, 60, 64]),  # C
    (40, [56, 59, 64]),  # E
]
# melody per bar: (midi, beats); None = rest
MELODY = [
    [(76, 1.5), (74, .5), (72, 2)],
    [(69, 3), (72, 1)],
    [(67, 2), (72, 1), (71, 1)],
    [(74, 4)],
    [(76, 1.5), (77, .5), (76, 1), (74, 1)],
    [(72, 2), (69, 2)],
    [(71, 2), (74, 1), (71, 1)],
    [(68, 2), (71, 2)],
    [(69, 1), (72, 1), (77, 2)],
    [(76, 1.5), (74, .5), (71, 2)],
    [(71, 1), (74, 1), (79, 2)],
    [(76, 4)],
    [(77, 1.5), (76, .5), (72, 2)],
    [(74, 1.5), (72, .5), (71, 2)],
    [(72, 1), (67, 1), (64, 2)],
    [(68, 2), (71, 1), (None, 1)],
]
SECTIONS = 2
N = int(round(BAR * len(CHORDS) * SECTIONS * SR))
L = np.zeros(N)
R = np.zeros(N)


def add(start_s, sig, pan):
    """Adds a mono signal at start_s seconds, panned (0 left .. 1 right), wrapping around (the track loops)."""
    i0 = int(round(start_s * SR))
    idx = (i0 + np.arange(len(sig))) % N
    np.add.at(L, idx, sig * np.cos(pan * np.pi / 2))
    np.add.at(R, idx, sig * np.sin(pan * np.pi / 2))


def piano(midi, held, vel):
    """Soft piano note: held = seconds the key is down (the sustain pedal lets it ring a little longer)."""
    f = hz(midi)
    tail = 2.8
    n = int((held + tail) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    inharm = 0.00035
    pitch_decay = (f / 261.6) ** 0.35
    for k in range(1, 14):
        fk = k * f * np.sqrt(1 + inharm * k * k)
        if fk > 9000:
            break
        amp = (1 / k ** 1.35) * np.exp(-(k - 1) * (0.55 - 0.35 * vel))
        fast = (1.8 + 0.9 * k) * pitch_decay
        slow = (0.25 + 0.12 * k) * pitch_decay
        env = 0.55 * np.exp(-fast * t) + 0.45 * np.exp(-slow * t)
        out += amp * env * np.sin(2 * np.pi * fk * t + rng.uniform(0, 2 * np.pi))
    out *= 1 - np.exp(-t * 500)                                    # felt hammer: no click
    rel = np.clip((t - held - 0.6) / 1.6, 0, 1)                    # pedal up: a gentle release
    out *= 1 - rel ** 0.7
    thump = rng.standard_normal(int(0.012 * SR)) * np.exp(-np.arange(int(0.012 * SR)) / SR * 300) * 0.01 * vel
    out[:len(thump)] += np.convolve(thump, np.ones(20) / 20, mode="same")
    return out * vel


def music_box(midi, vel):
    f = hz(midi)
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 4.02 * t) * np.exp(-t * 6)
    return s * np.exp(-t * 2.2) * (1 - np.exp(-t * 800)) * vel


def pad(notes, dur):
    n = int((dur + 2.0) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        for det in (-0.06, 0.06):
            ph = 2 * np.pi * hz(m + det) * t
            s += np.sin(ph) + 0.2 * np.sin(2 * ph)
    env = np.clip(t / 1.8, 0, 1) * np.clip((dur + 2.0 - t) / 2.0, 0, 1)
    return s * env


for sec in range(SECTIONS):
    for b, (root, tones) in enumerate(CHORDS):
        t0 = (sec * len(CHORDS) + b) * BAR
        # left hand: root, fifth-ish, chord tones rolling up and back down, in eighths (softer the second time)
        pattern = [root, root + 7, tones[0], tones[1], tones[2], tones[1], tones[0], root + 7]
        for i, m in enumerate(pattern):
            if sec == 1 and i % 2 == 1 and b < 4:
                continue  # the second time starts sparser
            vel = (0.42 if i == 0 else 0.26) * (0.85 if sec == 1 else 1) * (0.92 + 0.16 * rng.random())
            add(t0 + i * BEAT / 2 + rng.normal(0, 0.006), piano(m, BEAT * 1.5, vel), 0.38 + 0.0 * i)
        # right hand melody
        pos = 0.0
        for m, beats in MELODY[b]:
            if m is not None:
                mm = m + (12 if sec == 1 and b >= 4 else 0)
                vel = 0.5 if sec == 0 else 0.42
                add(t0 + pos * BEAT + rng.normal(0, 0.008), piano(mm, beats * BEAT, vel), 0.62)
                if sec == 1 and b >= 4 and pos == 0:
                    add(t0 + pos * BEAT, music_box(mm + 12, 0.10), 0.75)
            pos += beats
        # strings, barely there
        add(t0 - 0.6, pad([root + 12] + tones, BAR) * 0.010, 0.5)

# room: 3.2 s of decaying, darkened stereo noise, applied by circular (seamless) convolution
ir_n = int(3.2 * SR)
t_ir = np.arange(ir_n) / SR
wet = []
for ch in (L, R):
    noise = rng.standard_normal(ir_n) * np.exp(-t_ir * 1.9)
    noise = np.convolve(noise, np.ones(16) / 16, mode="same")
    ir = np.zeros(N)
    ir[int(0.018 * SR):int(0.018 * SR) + ir_n] = noise[:N - int(0.018 * SR)]
    wet.append(np.fft.irfft(np.fft.rfft(ch) * np.fft.rfft(ir), N))
g = np.sqrt((np.mean(L ** 2) + np.mean(R ** 2)) / max(np.mean(wet[0] ** 2) + np.mean(wet[1] ** 2), 1e-12))
outL = L * 0.75 + wet[0] * g * 0.5
outR = R * 0.75 + wet[1] * g * 0.5

out = np.stack([outL, outR], axis=1)
out *= 0.55 / np.max(np.abs(out))
pcm = (out * 32767).astype("<i2")
path = sys.argv[1] if len(sys.argv) > 1 else "menu_theme.wav"
with wave.open(path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{path}: {N / SR:.0f} s")
