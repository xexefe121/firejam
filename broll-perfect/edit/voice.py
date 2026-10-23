"""Final voiceover for the edit, built to keep the recording's quality.

Source: the speaker's own take with the background removed by ElevenLabs voice isolation
(work/audio/fal-elevenlabs-audio-isolation.wav and its Whisper words, both made by `npm run inspect`).
Every step here is chosen because it scores no worse on DNSMOS than the isolated take itself:

  1. shorten pauses: only true silence (below -55 dBFS on the isolated take) is removed, each pause
     keeps 0.30 s, cuts are 15 ms crossfades, so no word is touched
  2. gentle 2:1 compression and a 1.5 dB presence lift, so the take's spiky peaks (20 dB above its
     loudness) no longer need hard limiting, which was what cost quality
  3. the natural pace (any time-stretch costs quality; Rubber Band and dynamic loudnorm cost ~0.2 DNSMOS)
  4. one linear gain to -16 LUFS, with a limiter that only touches rare peaks

Writes public/clips/vo-final.wav, manifest/captions-final.json (words on vo-final's clock, spelled as
in SCRIPT) and manifest/vo-final.json (the same words, for edit/build.mjs to cut on).

Run: python -I edit/voice.py   (standard library only; needs ffmpeg)
"""
import array
import difflib
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'work/audio/fal-elevenlabs-audio-isolation.wav'
WORDS = ROOT / 'work/audio/fal-elevenlabs-audio-isolation.asr.json'
FINAL = ROOT / 'public/clips/vo-final.wav'

TEMPO = 1.0  # natural pace: the pause trims alone bring the take to about a minute
SILENCE_DB = -55.0
MIN_PAUSE = 0.42   # pauses longer than this are shortened
KEEP_TAIL = 0.17   # silence kept after the last sound before a pause
KEEP_HEAD = 0.13   # silence kept before the next sound
FADE = 0.015
LEAD_IN = 0.10     # silence kept before the first word
# Extra silence after a word, for a section break the picture needs to breathe in ("How it's built").
HOLDS = {'built': 0.7}

# What was said, spelled the way the product spells it. Captions take their words from here.
SCRIPT = (
    "FireJam is a native Fire TV app. It signs you in from the TV itself. No forms. "
    "Home shows who's watching, where, and what time it is for them. The Jam Map. "
    "Everyone you love, lit up by what they're watching. Add friends, see what they watched, "
    "and get a pop-up when they press play. Start a jam and every TV plays from one shared clock, "
    "within milliseconds. Anyone can pause or skip, even with Alexa. Your phone is the remote, "
    "for chat and reactions. Prime titles play in each TV's own Prime Video, in step. How it's built. "
    "A Kotlin Fire TV app hosts a React interface designed for the D-pad. It follows Prime Video "
    "through Android's media session and handles Alexa voice commands. A Node and Socket.IO server "
    "on AWS Graviton syncs every jam, served worldwide through CloudFront. Amazon Bedrock picks "
    "what to watch next, and it knows everyone's bedtime."
)


def run(*args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True)


def norm(t):
    return re.sub(r'[^a-z0-9]', '', t.lower())


def silences(path):
    """[start, end] seconds of every stretch where 10 ms RMS stays below SILENCE_DB."""
    rate, hop = 16000, 160
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'],
                         check=True, capture_output=True).stdout
    samples = array.array('h', pcm)
    quiet, out, start = [], [], None
    for i in range(0, len(samples) - hop, hop):
        frame = samples[i:i + hop]
        rms = math.sqrt(sum(x * x for x in frame) / hop) / 32768
        quiet.append(20 * math.log10(rms + 1e-9) < SILENCE_DB)
    for i, q in enumerate(quiet + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            out.append((start * hop / rate, i * hop / rate))
            start = None
    return out, len(samples) / rate


def keep_intervals(words):
    gaps, total = silences(SOURCE)
    first, last = words[0]['start'], words[-1]['end']
    keep, t = [], max(0.0, first - LEAD_IN)
    for a, b in gaps:
        if b <= first or a >= last + 0.3 or b - a < MIN_PAUSE:
            continue
        cut_from, cut_to = a + KEEP_TAIL, b - KEEP_HEAD
        if cut_to - cut_from > 2 * FADE:
            keep.append((t, cut_from + FADE))
            t = cut_to - FADE
    # The tail: keep the last word's decay, then end on silence.
    end = next((b for a, b in gaps if a >= last - 0.05), total)
    keep.append((t, min(total, max(last + 0.35, min(end, last + 0.6)))))
    # Holds: split the kept stretch halfway between the word and the next one, and put silence there.
    # A silence entry is (None, seconds).
    for i, w in enumerate(words[:-1]):
        hold = HOLDS.get(norm(w['text']))
        if not hold:
            continue
        # Whisper often lets the next word start early, inside the pause; use the real silence.
        nxt = words[i + 2]['start'] if i + 2 < len(words) else w['end'] + 1
        gap = max(((a, b) for a, b in gaps if a >= w['end'] - 0.1 and a < nxt), key=lambda g: g[1] - g[0],
                  default=(w['end'], w['end']))
        at = (gap[0] + gap[1]) / 2
        k = next(j for j, (a, b) in enumerate(keep) if a is not None and a <= at <= b)
        a, b = keep[k]
        keep[k:k + 1] = [(a, at), (None, hold), (at, b)]
    return keep, gaps


def remap(t, keep):
    """Isolated-take seconds to vo-final seconds."""
    out = 0.0
    for i, (a, b) in enumerate(keep):
        length = b if a is None else b - a
        if a is not None and t < a:
            return out / TEMPO
        if a is not None and t <= b:
            return (out + t - a) / TEMPO
        out += length - (FADE if i < len(keep) - 1 else 0)
    return out / TEMPO


def build_audio(keep):
    parts = ''.join(f'aevalsrc=0:s=48000:c=mono:d={b:.3f}[k{i}];' if a is None else
                    f'[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[k{i}];' for i, (a, b) in enumerate(keep))
    chain, last = '', 'k0'
    for i in range(1, len(keep)):
        chain += f'[{last}][k{i}]acrossfade=d={FADE}:c1=tri:c2=tri[j{i}];'
        last = f'j{i}'
    tone = 'acompressor=threshold=-26dB:ratio=2:attack=15:release=200:knee=6,equalizer=f=3000:t=q:w=1:g=1.5'
    pace = f',atempo={TEMPO}' if TEMPO != 1 else ''
    body = f'{parts}{chain}[{last}]{tone}{pace}'
    stats = run('ffmpeg', '-hide_banner', '-nostats', '-i', SOURCE, '-filter_complex', f'{body},ebur128=peak=true', '-f', 'null', '-').stderr
    summary = stats[stats.rindex('Summary:'):]
    loudness = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    gain = -16.0 - loudness
    run('ffmpeg', '-hide_banner', '-y', '-i', SOURCE, '-filter_complex',
        f'{body},volume={gain:.2f}dB,alimiter=limit=0.84:attack=2:release=50:level=disabled,aresample=48000',
        '-ac', '1', '-c:a', 'pcm_s24le', FINAL)
    return gain


def onset(t, end, gaps):
    """Whisper often starts a word early, in the silence before it (sometimes a whole pause early);
    move the start to where the sound begins."""
    for a, b in gaps:
        inside = a < t < b - 0.02 and b - a > 0.1
        swallowed = t - 0.02 <= a < end and b <= end + 0.15 and b - a > 0.2 and b - a > 0.5 * (end - t)
        if inside or swallowed:
            t = b
    return t


def captions(words, keep, gaps):
    script = SCRIPT.split()
    a = [norm(w['text']) for w in words]
    b = [norm(w) for w in script]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == 'equal':
            for k in range(i2 - i1):
                w = words[i1 + k]
                out.append((onset(w['start'], w['end'], gaps), w['end'], script[j1 + k], w.get('p', 1)))
        elif op in ('replace', 'insert'):
            # Spread the script words over the heard span (or a short span after the previous word).
            if i2 > i1:
                s, e = words[i1]['start'], words[i2 - 1]['end']
            else:
                s = out[-1][1] if out else 0
                e = s + 0.2 * (j2 - j1)
            n = j2 - j1
            for k in range(n):
                out.append((s + (e - s) * k / n, s + (e - s) * (k + 1) / n, script[j1 + k], 0.9))
        # 'delete': heard words not in the script are dropped
    # Starts must never run backwards (a spread or moved word can overtake its neighbour).
    for i in range(len(out) - 2, -1, -1):
        if out[i][0] > out[i + 1][0]:
            out[i] = (out[i + 1][0] - 0.03, *out[i][1:])
    caps = []
    for i, (s, e, text, conf) in enumerate(out):
        s2, e2 = round(remap(s, keep) * 1000), round(remap(e, keep) * 1000)
        caps.append({'text': (' ' if i else '') + text, 'startMs': s2, 'endMs': max(e2, s2 + 40),
                     'timestampMs': s2, 'confidence': conf})
    return caps


def main():
    words = json.loads(WORDS.read_text(encoding='utf-8'))['words']
    keep, gaps = keep_intervals(words)
    gain = build_audio(keep)
    caps = captions(words, keep, gaps)
    (ROOT / 'manifest/captions-final.json').write_text(json.dumps(caps, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    final = float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', FINAL).stdout)
    (ROOT / 'manifest/vo-final.json').write_text(json.dumps({
        'file': 'clips/vo-final.wav', 'duration': final, 'tempo': TEMPO, 'gain_db': round(gain, 2),
        'keep': [[None if a is None else round(a, 3), round(b, 3)] for a, b in keep],
        'words': [{'text': c['text'].strip(), 'start': c['startMs'] / 1000, 'end': c['endMs'] / 1000} for c in caps],
    }, indent=1) + '\n', encoding='utf-8')
    print(f'vo-final.wav {final:.2f} s, {sum(a is not None for a, _ in keep) - 1 - len(HOLDS)} pauses shortened, gain {gain:+.2f} dB, {len(caps)} caption words')
    print(''.join(c['text'] for c in caps))


main()
