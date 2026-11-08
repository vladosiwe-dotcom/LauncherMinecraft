"""
Main-menu theme for Spell and Iron Rift, synthesised from scratch (no samples, no third-party music).

Dark-fantasy ambience in D minor: a low drone, a slow pad of detuned saw-like voices, an FM bell arpeggio
and, in the second half, a soft "wordless voice" melody. Reverb is applied by circular convolution, so the
end flows straight into the start and the track loops without a seam.

    python3 tools/music/menu_theme.py out.wav      # then: ffmpeg -i out.wav -c:a libvorbis -q:a 3 menu.ogg
"""
import sys
import numpy as np

SR = 44100
CHORD_S = 8.0
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


D2, A2, D3 = 38, 45, 50
# i - VI - III - VII, i - iv - VI - V (MIDI notes of each chord, low to high)
CHORDS = [
    [50, 57, 62, 65, 69],  # Dm(add9 colour from the bell)
    [46, 53, 58, 62, 65],  # Bb
    [53, 57, 60, 65, 69],  # F
    [48, 55, 60, 64, 67],  # C
    [50, 57, 62, 65, 69],  # Dm
    [43, 55, 58, 62, 67],  # Gm
    [46, 53, 58, 62, 65],  # Bb
    [45, 52, 57, 61, 64],  # A (major: the pull back home)
]
SECTIONS = 2
N = int(SR * CHORD_S * len(CHORDS) * SECTIONS)
t_all = np.arange(N) / SR


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na) ** 2
    e[n - nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def add(buf, start, sig):
    """Adds sig at sample `start`, wrapping around the end (the track is a loop)."""
    idx = (start + np.arange(len(sig))) % len(buf)
    np.add.at(buf, idx, sig)


def saw_voice(f, n, harmonics=10):
    t = np.arange(n) / SR
    out = np.zeros(n)
    ph = rng.uniform(0, 2 * np.pi)
    for k in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * f * k * t + ph * k) / (k ** 1.6)
    return out


def bell(f, dur=3.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    idx = 2.2 * np.exp(-t * 3.0)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * idx
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 1.6) * (1 - np.exp(-t * 400))


def voice(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.8, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(1 + vib) / SR
    s = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(4 * ph)
    return s * env_adsr(n, 0.9, 1.4)


L = np.zeros(N)
R = np.zeros(N)

# drone: D1/D2 and a quiet fifth, breathing slowly
lfo = 0.75 + 0.25 * np.sin(2 * np.pi * t_all / (CHORD_S * 4))
drone = (np.sin(2 * np.pi * hz(D2 - 12) * t_all) * 0.5 + np.sin(2 * np.pi * hz(D2) * t_all) * 0.35
         + np.sin(2 * np.pi * hz(A2) * t_all) * 0.12) * lfo * 0.16
L += drone
R += drone

# pad
step = int(CHORD_S * SR)
pad_len = int((CHORD_S + 2.0) * SR)
for s in range(SECTIONS):
    for c, chord in enumerate(CHORDS):
        start = (s * len(CHORDS) + c) * step - int(1.0 * SR)
        e = env_adsr(pad_len, 2.2, 2.6)
        for note in chord[:4]:
            for det, pan in ((-0.07, 0.8), (0.0, 0.5), (0.07, 0.2)):
                v = saw_voice(hz(note + det), pad_len) * e * 0.035
                add(L, start, v * pan)
                add(R, start, v * (1 - pan))

# bell arpeggio: eighth notes at 60 bpm, sparse, rising then falling inside each chord
eighth = 0.5
patterns = [[0, 2, 3, 4, 3, 2, 1, 2], [4, 3, 2, 3, 4, None, 2, None]]
for s in range(SECTIONS):
    for c, chord in enumerate(CHORDS):
        pat = patterns[(s + c) % 2]
        for i in range(int(CHORD_S / eighth)):
            k = pat[i % len(pat)]
            if k is None or rng.random() < 0.18:
                continue
            note = chord[k] + 12
            start = int(((s * len(CHORDS) + c) * CHORD_S + i * eighth) * SR)
            b = bell(hz(note)) * (0.10 if i % 4 == 0 else 0.07)
            pan = 0.25 + 0.5 * rng.random()
            add(L, start, b * pan)
            add(R, start, b * (1 - pan))

# wordless voice in the second section: a slow melody over the chords
melody = [(74, 4), (72, 4), (69, 6), (72, 2), (77, 4), (76, 4), (74, 6), (72, 2),
          (74, 4), (77, 4), (81, 6), (79, 2), (77, 4), (74, 4), (73, 8)]
pos = len(CHORDS) * CHORD_S
for note, beats in melody:
    v = voice(hz(note), beats * 1.0 + 1.0) * 0.06
    add(L, int(pos * SR), v * 0.55)
    add(R, int(pos * SR), v * 0.45)
    pos += beats * 1.0

# reverb: 4.5 s of decaying, darkened stereo noise, applied by circular (seamless) convolution
ir_n = int(4.5 * SR)
t_ir = np.arange(ir_n) / SR
irs = []
for _ in range(2):
    noise = rng.standard_normal(ir_n) * np.exp(-t_ir * 1.4)
    noise = np.convolve(noise, np.ones(12) / 12, mode="same")  # darken
    noise[0] += 0
    ir = np.zeros(N)
    ir[:ir_n] = noise
    irs.append(np.fft.rfft(ir))
wetL = np.fft.irfft(np.fft.rfft(L) * irs[0], N)
wetR = np.fft.irfft(np.fft.rfft(R) * irs[1], N)
wet_gain = np.sqrt(np.mean(L ** 2) / max(np.mean(wetL ** 2), 1e-12))
outL = L * 0.7 + wetL * wet_gain * 0.55
outR = R * 0.7 + wetR * wet_gain * 0.55

out = np.stack([outL, outR], axis=1)
out *= 0.5 / np.max(np.abs(out))  # peak at about -6 dBFS: menu music sits under the interface sounds

pcm = (out * 32767).astype("<i2")
path = sys.argv[1] if len(sys.argv) > 1 else "menu_theme.wav"
import wave
with wave.open(path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{path}: {N / SR:.0f} s")
