"""Studio pass on the voiceover: speech restoration models on fal, scored with DNSMOS, then a
broadcast mastering chain on the winner.

  input   public/clips/vo-tight.wav   (cleaned and tightened by `npm run inspect`)
  output  public/clips/vo-studio.wav  (same timing, which edit/voice.py then paces and captions)

Run: uv run --with fal-client --with speechmos --with soundfile --with numpy python -I edit/studio.py [--pick <name>]
fal results are cached in work/audio/studio-*.wav, so re-running only re-scores and re-masters.
"""
import argparse
import json
import os
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'work/audio'
SOURCE = ROOT / 'public/clips/vo-tight.wav'
OUT = ROOT / 'public/clips/vo-studio.wav'
KEY_FILE = Path(r'H:\firejam-tools\secrets\fal.env')

# Each candidate takes the tightened voiceover and must keep its timing.
CANDIDATES = {
    'lava-sr': ('fal-ai/lava-sr', lambda url: {'audio_url': url, 'audio_format': 'wav', 'denoise': False}),
    'nova-sr': ('fal-ai/nova-sr', lambda url: {'audio_url': url, 'audio_format': 'wav'}),
    # Re-voices the take in the speaker's own voice (a clean 12 s excerpt of it), at 48 kHz.
    'chatterbox-hd': ('resemble-ai/chatterboxhd/speech-to-speech',
                      lambda url, ref=None: {'source_audio_url': url, 'target_voice_audio_url': ref, 'high_quality_audio': True}),
}

# Broadcast voice chain: rumble and mud out, presence and air up, sibilance tamed, gentle
# 3:1 compression, then a true-peak-safe limiter. Loudness is set afterwards by two-pass loudnorm.
CHAIN = ','.join([
    'highpass=f=75:p=2',
    'equalizer=f=250:t=q:w=1.1:g=-2.5',
    'equalizer=f=3200:t=q:w=0.9:g=2',
    'highshelf=f=9000:g=2.5',
    'deesser=i=0.35:m=0.5:f=0.5:s=o',
    'acompressor=threshold=-21dB:ratio=3:attack=6:release=140:makeup=3:knee=4',
    'alimiter=limit=0.84:attack=3:release=60:level=disabled',
])


def run(*args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True)


def load_key():
    for line in KEY_FILE.read_text().splitlines():
        if line.startswith('FAL_KEY='):
            os.environ['FAL_KEY'] = line.split('=', 1)[1].strip()


def fal(name, source_url, ref_url):
    import fal_client
    target = AUDIO / f'studio-{name}.wav'
    if target.exists():
        return target
    endpoint, args = CANDIDATES[name]
    arguments = args(source_url, ref_url) if name == 'chatterbox-hd' else args(source_url)
    result = fal_client.subscribe(endpoint, arguments=arguments)
    url = (result.get('audio') or result.get('audio_file') or {}).get('url')
    raw = AUDIO / f'studio-{name}.download'
    urllib.request.urlretrieve(url, raw)
    run('ffmpeg', '-v', 'error', '-y', '-i', raw, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s24le', target)
    raw.unlink()
    return target


def dnsmos(path):
    """DNSMOS P.835 (signal, background, overall) and P.808, averaged over 9 s windows."""
    from speechmos import dnsmos as model
    audio = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                                         check=True, capture_output=True).stdout, dtype=np.float32)
    audio = audio / max(1e-6, np.abs(audio).max()) * 0.9
    scores = [model.run(audio[i:i + 16000 * 9], sr=16000) for i in range(0, len(audio) - 16000 * 4, 16000 * 9)]
    keys = ['sig_mos', 'bak_mos', 'ovrl_mos', 'p808_mos']
    return {k: round(float(np.mean([s[k] for s in scores])), 3) for k in keys}


def duration(path):
    return float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path).stdout)


def spectrum(path, name):
    run('ffmpeg', '-v', 'error', '-y', '-i', path, '-lavfi', 'showspectrumpic=s=1400x360:legend=0:scale=log:start=0:stop=24000',
        AUDIO / f'studio-{name}-spectrum.png')


def master(source):
    first = run('ffmpeg', '-hide_banner', '-nostats', '-i', source, '-af',
                f'{CHAIN},loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-').stderr
    m = json.loads(first[first.rindex('{'):first.rindex('}') + 1])
    run('ffmpeg', '-v', 'error', '-y', '-i', source, '-af',
        f'{CHAIN},loudnorm=I=-16:TP=-1.5:LRA=9:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}:'
        f'measured_LRA={m["input_lra"]}:measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}:linear=true,aresample=48000',
        '-ac', '1', '-c:a', 'pcm_s24le', OUT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pick', help='candidate to master instead of the best DNSMOS overall score')
    parser.add_argument('--only', nargs='*', help='candidates to run (default: all)')
    args = parser.parse_args()
    AUDIO.mkdir(parents=True, exist_ok=True)
    names = args.only or list(CANDIDATES)
    files = {'current': SOURCE}
    if any(not (AUDIO / f'studio-{n}.wav').exists() for n in names):
        import fal_client
        load_key()
        source_url = fal_client.upload_file(str(SOURCE))
        ref = AUDIO / 'studio-voice-ref.wav'
        run('ffmpeg', '-v', 'error', '-y', '-ss', '8', '-t', '12', '-i', SOURCE, '-c:a', 'pcm_s16le', ref)
        ref_url = fal_client.upload_file(str(ref))
    else:
        source_url = ref_url = None
    for name in names:
        try:
            files[name] = fal(name, source_url, ref_url)
        except Exception as error:  # one failing provider should not stop the comparison
            print(f'{name}: failed ({error})')
    base = duration(SOURCE)
    table = {}
    for name, path in files.items():
        table[name] = {**dnsmos(path), 'duration': round(duration(path), 3), 'drift': round(duration(path) - base, 3)}
        spectrum(path, name)
        print(f'{name:14} {table[name]}')
    usable = {n: s for n, s in table.items() if abs(s['drift']) < 0.15}
    pick = args.pick or max(usable, key=lambda n: usable[n]['ovrl_mos'])
    master(files[pick])
    table['mastered'] = {**dnsmos(OUT), 'from': pick}
    spectrum(OUT, 'mastered')
    print(f'mastered from {pick}: {table["mastered"]}')
    (AUDIO / 'studio-comparison.json').write_text(json.dumps(table, indent=2) + '\n')


main()
