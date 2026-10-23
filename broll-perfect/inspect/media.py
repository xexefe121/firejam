"""Local media inspection and reproducible measurements; all units explicit."""
import hashlib
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'work/audio'
RATE = 48000

@contextmanager
def inspection_lock():
    """Serialize inspect runs so concurrent callers cannot pay for duplicate jobs."""
    AUDIO.mkdir(parents=True, exist_ok=True)
    with (AUDIO / '.inspect.lock').open('a+b') as handle:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError('Another inspect run is active; wait for it to finish') from None
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

def say(message):
    print(message, flush=True)

def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def fingerprint(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def embedded_transcript(source):
    data = Path(source).read_bytes()
    offset = data.find(b'tsrp{')
    if offset < 0:
        return None
    try:
        value, _ = json.JSONDecoder().raw_decode(data[offset+4:].decode('utf-8', errors='ignore'))
        attributed = value.get('attributedString', {})
        runs, attributes = attributed.get('runs', []), attributed.get('attributeTable', [])
        words = []
        for i in range(0, len(runs), 2):
            start, end = attributes[runs[i+1]]['timeRange']
            words.append({'text': runs[i].strip(), 'start': start, 'end': end})
        result = {'source': 'Apple Voice Memos embedded ASR; independent cross-check, not primary transcription',
            'source_sha256': fingerprint(source), 'words': words, 'text': ' '.join(w['text'] for w in words)}
        dump(AUDIO / 'raw-embedded-transcript.json', result)
        return result
    except (ValueError, KeyError, IndexError, TypeError):
        return None

def run(args, timeout=300):
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{Path(str(args[0])).name} failed: ' + result.stderr.decode('utf-8', errors='replace')[-1800:])
    return result

def ffmpeg(*args):
    return run(['ffmpeg', '-hide_banner', '-nostdin', '-y', *args])

def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]).stdout)

def samples(path):
    return np.frombuffer(ffmpeg('-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(RATE),
        '-f', 'f32le', 'pipe:1').stdout, dtype='<f4').copy()

def write_samples(path, data):
    from scipy.io import wavfile
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    # Float WAV preserves sub-LSB denoised pauses until the final 24-bit conversion.
    wavfile.write(path, RATE, data.astype(np.float32))

def db(value):
    return max(-160.0, float(20 * np.log10(max(float(value), 1e-8))))

def loudness(path, prefix=''):
    result = ffmpeg('-i', path, '-af', prefix + 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-')
    text = result.stderr.decode('utf-8', errors='replace')
    match = re.search(r'\{\s*"input_i".*?\}', text, re.S)
    if not match:
        raise RuntimeError(f'No loudnorm measurements for {Path(path).name}')
    return {k: float(v) for k, v in json.loads(match.group()).items() if k != 'normalization_type'}

def silences(path, threshold=-45, duration=0.12):
    result = ffmpeg('-i', path, '-af', f'silencedetect=noise={threshold}dB:d={duration}', '-f', 'null', '-')
    text = result.stderr.decode('utf-8', errors='replace')
    intervals, start = [], None
    for kind, value in re.findall(r'silence_(start|end): ([\d.]+)', text):
        if kind == 'start':
            start = float(value)
        elif start is not None:
            intervals.append([start, float(value)])
            start = None
    if start is not None:
        intervals.append([start, float(probe(path)['format']['duration'])])
    return intervals

def spectrum(path, destination, gain_db=0):
    ffmpeg('-v', 'error', '-i', path, '-lavfi',
        f'volume={gain_db}dB,showspectrumpic=s=1600x700:legend=1:scale=log:fscale=log:win_func=hann:gain=1:drange=100',
        '-frames:v', '1', destination)

def metrics(path, intervals=None, spectrum_path=None):
    data = samples(path)
    pauses = silences(path, -45, 0.25) if intervals is None else intervals
    # Ignore pause edges and the initial/final dead digital silence. Identical
    # interior windows are used for all candidates, independent of their gain.
    windows = [[a + 0.08, b - 0.08] for a, b in pauses if b - a >= 0.30 and a > 0.3 and b < len(data) / RATE - 0.3]
    pieces = [data[round(a * RATE):round(b * RATE)] for a, b in windows]
    quiet = np.concatenate(pieces) if pieces else np.array([], dtype=np.float32)
    ln = loudness(path)
    stats = ffmpeg('-i', path, '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-').stderr.decode('utf-8', errors='replace')
    parsed = {}
    for label in ['RMS level dB', 'Peak level dB', 'Noise floor dB']:
        matches = re.findall(re.escape(label) + r': ([\w.+-]+)', stats)
        if matches:
            number = float(matches[-1])
            parsed[label] = number if math.isfinite(number) else None
    result = {
        'duration': round(len(data) / RATE, 6), 'sample_rate': RATE,
        'integrated_lufs': ln['input_i'], 'true_peak_dbtp': ln['input_tp'],
        'loudness_range_lu': ln['input_lra'],
        'rms_dbfs': round(db(np.sqrt(np.mean(data.astype(np.float64) ** 2))), 3),
        'sample_peak_dbfs': round(db(np.max(np.abs(data))), 3),
        'clipped_samples': int(np.sum(np.abs(data) >= 0.999969)),
        'pause_noise_dbfs': round(db(np.sqrt(np.mean(quiet.astype(np.float64) ** 2))), 3) if len(quiet) else None,
        'pause_noise_at_minus16_lufs_dbfs': round(db(np.sqrt(np.mean(quiet.astype(np.float64) ** 2))) - 16 - ln['input_i'], 3) if len(quiet) else None,
        'pause_measurement_seconds': round(len(quiet) / RATE, 6),
        'pause_windows': windows, 'astats': parsed,
    }
    if spectrum_path:
        spectrum(path, spectrum_path)
        result['spectrum'] = str(Path(spectrum_path).relative_to(ROOT)).replace('\\', '/')
        matched = Path(spectrum_path).with_name(Path(spectrum_path).stem + '-level-matched.png')
        spectrum(path, matched, -16 - ln['input_i'])
        result['level_matched_spectrum'] = str(matched.relative_to(ROOT)).replace('\\', '/')
        result['level_matched_spectrum_gain_db'] = -16 - ln['input_i']
    return result

def inspect_inputs(input_folder=None):
    AUDIO.mkdir(parents=True, exist_ok=True)
    for source in sorted((Path(input_folder) if input_folder else ROOT / 'raw/footage').iterdir()):
        if not source.is_file() or source.suffix.lower() not in {'.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.m4a', '.wav', '.mp3', '.aac', '.ogg', '.flac'}:
            continue
        name = re.sub(r'[^A-Za-z0-9_.-]', '-', source.stem)
        folder = AUDIO / 'inputs'
        folder.mkdir(exist_ok=True)
        metadata = probe(source)
        dump(folder / (name + '.probe.json'), metadata)
        videos = [s for s in metadata['streams'] if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic')]
        if not videos:
            continue
        signature = fingerprint(source)
        state = folder / (name + '.inspection.json')
        sheet = ROOT / 'work/sheets' / (name + '.jpg')
        extracted = folder / (name + '.wav')
        audio_present = any(s['codec_type'] == 'audio' for s in metadata['streams'])
        if state.is_file() and read(state).get('sha256') == signature and sheet.is_file() and (not audio_present or extracted.is_file()):
            say(f'Video cached: {source.name}')
            continue
        sheet.parent.mkdir(parents=True, exist_ok=True)
        duration = float(metadata['format']['duration'])
        rows = max(1, math.ceil(math.ceil(duration) / 8))
        ffmpeg('-v', 'error', '-i', source, '-vf', f'fps=1,scale=240:-2,tile=8x{rows}:padding=4:margin=4', '-frames:v', '1', '-q:v', '3', sheet)
        changes = ffmpeg('-i', source, '-vf', "select='gt(scene,0.30)',showinfo", '-an', '-f', 'null', '-').stderr.decode('utf-8', errors='replace')
        scenes = [float(t) for t in re.findall(r'pts_time:([\d.]+)', changes)]
        if audio_present:
            ffmpeg('-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s24le', extracted)
        dump(state, {'sha256': signature, 'duration': duration, 'scene_threshold': 0.3,
            'scene_changes': scenes, 'contact_sheet': str(sheet.relative_to(ROOT)).replace('\\', '/'),
            'contact_sheet_fps': 1, 'contact_sheet_columns': 8,
            'audio': str(extracted.relative_to(ROOT)).replace('\\', '/') if audio_present else None})
        say(f'Video inspected: {source.name}; {len(scenes)} scene changes')
