"""Final voiceover for the edit: takes the cleaned, tightened take from `npm run inspect`
(public/clips/vo-tight.wav + manifest/captions.json), removes stray sounds, speeds it up
slightly with Rubber Band (pitch and formants preserved) and writes:

  public/clips/vo-final.wav        the voiceover the film plays
  manifest/captions-final.json     word captions on vo-final's clock, with the script's spelling
  manifest/vo-final.json           the same words, for edit/build.mjs to cut on

Run: python -I edit/voice.py   (standard library only; needs ffmpeg with rubberband)
"""
import difflib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIGHT = ROOT / 'public/clips/vo-tight.wav'
FINAL = ROOT / 'public/clips/vo-final.wav'

# A natural narration pace for a launch film; 1.1x keeps the voice relaxed but brings it near a minute.
TEMPO = 1.1
# Seconds on vo-tight to remove: a quiet stray "seconds" after "milliseconds".
CUTS = [(26.30, 26.74)]
FADE = 0.015

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
    return subprocess.run(args, check=True, capture_output=True, text=True)


def duration(path):
    return float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)).stdout)


def norm(t):
    return re.sub(r"[^a-z0-9]", '', t.lower())


def build_audio(total):
    # Keep everything outside CUTS, joined with short crossfades, then stretch and re-normalise.
    keep, t = [], 0.0
    for a, b in CUTS:
        keep.append((t, a + FADE))
        t = b - FADE
    keep.append((t, total))
    parts = ''.join(f'[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[k{i}];' for i, (a, b) in enumerate(keep))
    chain, last = '', 'k0'
    for i in range(1, len(keep)):
        chain += f'[{last}][k{i}]acrossfade=d={FADE}:c1=tri:c2=tri[j{i}];'
        last = f'j{i}'
    stretch = f'[{last}]rubberband=tempo={TEMPO}:pitch=1:formant=preserved:pitchq=quality:window=standard'
    first = f'{parts}{chain}{stretch},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'
    stats = run('ffmpeg', '-hide_banner', '-nostats', '-i', str(TIGHT), '-filter_complex', first, '-f', 'null', '-').stderr
    m = json.loads(stats[stats.rindex('{'):stats.rindex('}') + 1])
    second = (f'{parts}{chain}{stretch},loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}'
              f':measured_LRA={m["input_lra"]}:measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}:linear=true,'
              'aresample=48000')
    run('ffmpeg', '-hide_banner', '-y', '-i', str(TIGHT), '-filter_complex', second, '-ac', '1', '-c:a', 'pcm_s24le', str(FINAL))


def remap(t):
    """vo-tight seconds to vo-final seconds."""
    removed = 0.0
    for a, b in CUTS:
        if t >= b:
            removed += (b - a) - 2 * FADE + FADE
        elif t > a:
            t = a
    return max(0.0, (t - removed) / TEMPO)


def captions():
    heard = [w for w in json.loads((ROOT / 'manifest/captions.json').read_text(encoding='utf-8'))
             if not any(a <= w['startMs'] / 1000 < b for a, b in CUTS)]
    script = SCRIPT.split()
    # Spoken "Fire Jam" is one script word; compare on letters only.
    a = [norm(w['text']) for w in heard]
    b = [norm(w) for w in script]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == 'equal':
            pairs = [(heard[i1 + k], script[j1 + k], heard[i1 + k]) for k in range(i2 - i1)]
            for h, text, _ in pairs:
                out.append((h['startMs'], h['endMs'], text, h.get('confidence', 1)))
        elif op in ('replace', 'insert'):
            # Spread the script words over the heard span (or a short span after the previous word).
            if i2 > i1:
                s, e = heard[i1]['startMs'], heard[i2 - 1]['endMs']
            else:
                s = out[-1][1] if out else 0
                e = s + 200 * (j2 - j1)
            n = j2 - j1
            for k in range(n):
                out.append((s + (e - s) * k / n, s + (e - s) * (k + 1) / n, script[j1 + k], 0.9))
        # 'delete': heard words not in the script are dropped
    caps = []
    for i, (s, e, text, conf) in enumerate(out):
        s2, e2 = round(remap(s / 1000) * 1000), round(remap(e / 1000) * 1000)
        caps.append({'text': (' ' if i else '') + text, 'startMs': s2, 'endMs': max(e2, s2 + 40),
                     'timestampMs': s2, 'confidence': conf})
    return caps


def main():
    total = duration(TIGHT)
    build_audio(total)
    caps = captions()
    (ROOT / 'manifest/captions-final.json').write_text(json.dumps(caps, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    words = [{'text': c['text'].strip(), 'start': c['startMs'] / 1000, 'end': c['endMs'] / 1000} for c in caps]
    final = duration(FINAL)
    (ROOT / 'manifest/vo-final.json').write_text(json.dumps(
        {'file': 'clips/vo-final.wav', 'duration': final, 'tempo': TEMPO, 'cuts': CUTS, 'words': words}, indent=1) + '\n',
        encoding='utf-8')
    print(f'vo-final.wav {final:.2f} s (tight {total:.2f} s, tempo {TEMPO}); {len(caps)} caption words')
    print(''.join(c['text'] for c in caps))


main()
