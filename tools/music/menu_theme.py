"""
Main-menu theme for Spell and Iron Rift: "Rift Lullaby", an original calm neoclassical piece.

F minor, 66 bpm, 28 bars (~102 s), loops without a seam. Piano ostinato (broken chords, soft), a solo violin
melody that swells in and out, a cello holding the bass, a whisper of string ensemble for warmth, and in the
middle section a very soft clock tick. The score is written here as MIDI and played with FluidSynth on the
FluidR3 General MIDI SoundFont (MIT licence), so the instruments are real recorded samples, not synthesis.

    sudo apt-get install fluidsynth fluid-soundfont-gm && pip install mido
    python3 tools/music/menu_theme.py out.wav      # then: ffmpeg -i out.wav -c:a libvorbis -q:a 4 menu.ogg
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import mido
import numpy as np

SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
BPM = 66
TPB = 480                      # ticks per beat
SR = 44100
rng = np.random.default_rng(5)

# chord: bass note (cello/left hand), three right-hand tones low to high
CH = {
    "Fm": (41, [60, 65, 68]), "Db": (37, [61, 65, 68]), "Ab": (44, [60, 63, 68]), "Eb": (39, [58, 63, 67]),
    "Bbm": (46, [61, 65, 70]), "C": (36, [60, 64, 67]), "Cm": (36, [60, 63, 67]), "Csus": (36, [60, 65, 67]),
}
INTRO = ["Fm", "Db", "Fm", "Db"]
A = ["Fm", "Db", "Ab", "Eb", "Fm", "Db", "Bbm", "C"]
B = ["Db", "Eb", "Fm", "Cm", "Db", "Eb", "Csus", "C"]
A2 = ["Fm", "Db", "Bbm", "C"]
OUTRO = ["Fm", "Db", "Fm", "Fm"]
BARS = INTRO + A + B + A2 + OUTRO

# violin melody per section: list of bars, each [(midi, beats)]
MEL_A = [[(72, 2), (68, 1), (70, 1)], [(72, 4)], [(75, 2), (73, 1), (72, 1)], [(70, 4)],
         [(72, 2), (77, 2)], [(75, 2), (73, 1), (72, 1)], [(73, 2), (72, 1), (70, 1)], [(72, 4)]]
MEL_B = [[(77, 4)], [(79, 2), (75, 2)], [(80, 3), (79, 1)], [(79, 2), (75, 2)],
         [(77, 2), (80, 2)], [(79, 2), (77, 1), (75, 1)], [(77, 4)], [(76, 4)]]
MEL_A2 = [[(72, 2), (68, 2)], [(68, 4)], [(73, 2), (72, 1), (70, 1)], [(72, 4)]]


def jitter(ms=8):
    return int(rng.normal(0, ms / 1000 * BPM / 60 * TPB))


class Track:
    def __init__(self, ch, program, volume):
        self.ch, self.ev = ch, []
        self.ev.append((0, mido.Message("program_change", channel=ch, program=program)))
        self.ev.append((0, mido.Message("control_change", channel=ch, control=7, value=volume)))
        self.ev.append((0, mido.Message("control_change", channel=ch, control=11, value=100)))

    def note(self, start, beats, midi, vel):
        t0 = max(0, start + jitter())
        t1 = t0 + int(beats * TPB) - 10
        self.ev.append((t0, mido.Message("note_on", channel=self.ch, note=midi, velocity=int(np.clip(vel, 1, 127)))))
        self.ev.append((t1, mido.Message("note_off", channel=self.ch, note=midi, velocity=0)))

    def cc(self, t, control, value):
        self.ev.append((max(0, t), mido.Message("control_change", channel=self.ch, control=control, value=int(np.clip(value, 0, 127)))))

    def swell(self, start, beats, lo, hi):
        """Expression rises over the first 60 % of a note and eases back."""
        n = int(beats * 8)
        for i in range(n + 1):
            x = i / n
            v = lo + (hi - lo) * (np.sin(np.pi * min(1, x / 0.6) / 2) if x < 0.6 else 1 - 0.35 * (x - 0.6) / 0.4)
            self.cc(start + int(x * beats * TPB), 11, v)

    def midi_track(self):
        tr = mido.MidiTrack()
        last = 0
        for t, msg in sorted(self.ev, key=lambda e: (e[0], e[1].type == "note_on")):
            tr.append(msg.copy(time=t - last))
            last = t
        return tr


piano = Track(0, 0, 92)        # Acoustic Grand Piano
violin = Track(1, 40, 78)      # Violin
cello = Track(2, 42, 84)       # Cello
strings = Track(3, 49, 40)     # Slow strings, barely there
tick = Track(9, 0, 34)         # percussion channel: wood blocks as a soft clock

bar_ticks = 4 * TPB
sec_of = ["intro"] * 4 + ["A"] * 8 + ["B"] * 8 + ["A2"] * 4 + ["outro"] * 4
for b, name in enumerate(BARS):
    bass, tones = CH[name]
    t0 = b * bar_ticks
    sec = sec_of[b]
    soft = 0.8 if sec in ("intro", "outro") else 1.0
    # piano right hand: a gentle wave over the chord in eighths
    wave_ = [tones[0], tones[1], tones[2], tones[0] + 12, tones[2], tones[1], tones[0], tones[1]]
    for i, m in enumerate(wave_):
        accent = 1.12 if i in (0, 4) else 1.0
        piano.note(t0 + i * TPB // 2, 0.9, m, (44 + rng.integers(-4, 5)) * accent * soft)
    # piano left hand: low octave, then the fifth
    piano.note(t0, 2, bass + 12, 50 * soft)
    piano.note(t0, 2, bass + 24, 40 * soft)
    piano.note(t0 + 2 * TPB, 2, bass + 19, 38 * soft)
    # sustain pedal per bar (lift just before the next chord)
    piano.cc(t0 + 10, 64, 100)
    piano.cc(t0 + bar_ticks - 30, 64, 0)
    # cello holds the bass from the third bar on (rests in the last bar so the loop breathes)
    if 2 <= b < len(BARS) - 1:
        cello.note(t0, 4, bass + 12 if bass < 40 else bass, 62)
        cello.swell(t0, 4, 55, 92)
    # warm string bed under A and B
    if sec in ("A", "B", "A2"):
        for m in tones:
            strings.note(t0, 4, m - 12, 40)
    # soft clock in the middle section
    if sec == "B":
        for q in range(4):
            tick.note(t0 + q * TPB, 0.2, 76 if q % 2 == 0 else 77, 30)

# violin melody
def play(bars, first_bar, octave=0, vel=70):
    for k, bar in enumerate(bars):
        pos = 0.0
        t0 = (first_bar + k) * bar_ticks
        for m, beats in bar:
            start = t0 + int(pos * TPB)
            violin.note(start, beats, m + octave, vel)
            violin.swell(start, beats, 52, 104)
            pos += beats

play(MEL_A, 4)
play(MEL_B, 12, vel=74)
play(MEL_A2, 20, vel=66)

mid = mido.MidiFile(ticks_per_beat=TPB)
meta = mido.MidiTrack()
meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0))
mid.tracks.append(meta)
for tr in (piano, violin, cello, strings, tick):
    mid.tracks.append(tr.midi_track())

out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "menu_theme.wav")
loop_s = len(BARS) * 4 * 60 / BPM
with tempfile.TemporaryDirectory() as tmp:
    midp, rawp = Path(tmp) / "theme.mid", Path(tmp) / "render.wav"
    # an empty bar at the end lets the reverb and the last notes ring out; that tail is folded onto the start
    tail = mido.MidiTrack()
    tail.append(mido.MetaMessage("end_of_track", time=len(BARS) * bar_ticks + 3 * bar_ticks))
    mid.tracks.append(tail)
    mid.save(midp)
    subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", str(SR),
                    "-o", "synth.reverb.active=1", "-o", "synth.reverb.room-size=0.82", "-o", "synth.reverb.damp=0.35",
                    "-o", "synth.reverb.width=0.9", "-o", "synth.reverb.level=0.75", "-o", "synth.chorus.active=0",
                    "-F", str(rawp), SF2, str(midp)], check=True)
    with wave.open(str(rawp)) as w:
        ch = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float).reshape(-1, ch)

n = int(round(loop_s * SR))
song = data[:n].copy()
rest = data[n:]
song[:len(rest)] += rest[:n]                        # seamless loop: what rings past the end sounds at the start
song *= 0.5 * 32767 / np.max(np.abs(song))
with wave.open(str(out_path), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(song.astype("<i2").tobytes())
print(f"{out_path}: {n / SR:.0f} s")
