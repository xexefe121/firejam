"""FireJam voiceover inspection, enhancement, word-safe tightening and manifests.

Run via npm run inspect. No secret, model cache or temporary dependency file is
written to the project. Provider outputs and ASR are content-hash cached.
"""
import argparse
from difflib import SequenceMatcher
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import numpy as np
from media import (ROOT, AUDIO, RATE, db, dump, ffmpeg, fingerprint, inspect_inputs,
    loudness, metrics, probe, read, samples, say, silences, write_samples, inspection_lock, embedded_transcript)
from enhance import enhance

RAW = ROOT / 'raw/footage/vo-recording-5.m4a'
CLIPS = ROOT / 'public/clips'
MANIFEST = ROOT / 'manifest'
SCHEMA_VERSION = 1

def asr_path(path):
    return path.with_name(path.stem + '.asr.json')

def transcribe(paths):
    from transcribe import MODEL, ASR_VERSION
    missing = [p for p in paths if not asr_path(p).is_file() or
        read(asr_path(p)).get('sha256') != fingerprint(p) or read(asr_path(p)).get('model') != MODEL or
        read(asr_path(p)).get('config_version') != ASR_VERSION]
    if not missing:
        say('All word transcripts cached')
        return
    from model_cache import ensure_model
    ensure_model()
    args = [sys.executable, str(ROOT / 'inspect/transcribe.py')]
    device = os.environ.get('INSPECT_DEVICE', 'cuda')
    say(f'Word transcription: {len(missing)} files; trying {device}')
    # Model download is cached on H:. CUDA errors get one CPU int8 fallback.
    try:
        result = subprocess.run([*args, '--device', device, *map(str, missing)], timeout=600)
        success = result.returncode == 0
    except subprocess.TimeoutExpired:
        success = False
    if not success and device != 'cpu':
        say('CUDA transcription unavailable; switching to CPU int8')
        result = subprocess.run([*args, '--device', 'cpu', *map(str, missing)], timeout=1800)
        success = result.returncode == 0
    if not success:
        raise RuntimeError('Whisper transcription failed on available devices')

def normalized_tokens(words):
    text = ' '.join(w['text'] for w in words).lower()
    text = re.sub(r'fire\s*jam', 'firejam', text)
    text = re.sub(r'jam\s*map', 'jammap', text)
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text)

def candidate_quality(raw_words, candidate_words):
    a, b = normalized_tokens(raw_words), normalized_tokens(candidate_words)
    matcher = SequenceMatcher(a=a, b=b, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return {'raw_token_recall': matched / max(1, len(a)),
        'token_similarity': matcher.ratio(),
        'raw_only_tokens': [a[i:j] for tag, i, j, k, l in matcher.get_opcodes() if tag in ['delete', 'replace']],
        'candidate_only_tokens': [b[k:l] for tag, i, j, k, l in matcher.get_opcodes() if tag in ['insert', 'replace']]}

def envelope_delay(reference, candidate):
    from scipy.signal import correlate, correlation_lags
    # 10 ms RMS envelopes permit phase-changing enhancement without a spurious
    # waveform delay estimate. No candidate is silently time-stretched.
    def envelope(x):
        size = 480
        x = x[:len(x) // size * size].reshape(-1, size).astype(np.float64)
        y = np.sqrt(np.mean(x * x, axis=1))
        return (y - np.mean(y)) / max(np.std(y), 1e-12)
    a, b = envelope(reference), envelope(candidate)
    c = correlate(b, a, method='fft')
    lags = correlation_lags(len(b), len(a))
    valid = np.abs(lags) <= 100
    lag = int(lags[valid][np.argmax(c[valid])])
    n = min(len(a), len(b)) - abs(lag)
    if lag >= 0:
        correlation = np.corrcoef(a[:n], b[lag:lag+n])[0, 1]
    else:
        correlation = np.corrcoef(a[-lag:-lag+n], b[:n])[0, 1]
    return lag * 0.01, float(correlation)

def correct_words(words):
    result, i = [], 0
    # Merge recognizer's split product names without changing spoken content.
    merges = {('fire', 'jam'): 'FireJam', ('a', 'w', 's'): 'AWS'}
    phrases = {('fire', 'tv'): ('Fire', 'TV'), ('jam', 'map'): ('Jam', 'Map'),
        ('prime', 'video'): ('Prime', 'Video')}
    singles = {'firejam': 'FireJam', 'alexa': 'Alexa', 'aws': 'AWS', 'jammap': 'Jam Map'}
    while i < len(words):
        merged = False
        for pattern, names in phrases.items():
            window = words[i:i+len(pattern)]
            keys = tuple(re.sub(r'[^a-z]', '', w['text'].lower()) for w in window)
            if keys == pattern:
                for word, name in zip(window, names):
                    suffix = re.search(r'[^\w]*$', word['text']).group()
                    result.append({**word, 'text': name + suffix})
                i += len(pattern)
                merged = True
                break
        if merged:
            continue
        for pattern, name in merges.items():
            window = words[i:i+len(pattern)]
            keys = tuple(re.sub(r'[^a-z]', '', w['text'].lower()) for w in window)
            if keys == pattern:
                suffix = re.search(r'[^\w]*$', window[-1]['text']).group()
                result.append({'text': name + suffix, 'start': window[0]['start'], 'end': window[-1]['end'],
                    'p': sum(w['p'] for w in window) / len(window)})
                i += len(pattern)
                merged = True
                break
        if merged:
            continue
        word = dict(words[i])
        key = re.sub(r'[^a-z]', '', word['text'].lower())
        if key in singles:
            suffix = re.search(r'[^\w]*$', word['text']).group()
            word['text'] = singles[key] + suffix
        result.append(word)
        i += 1
    # Whisper can attach a zero-duration article to the next word. Prefer an
    # independent embedded timestamp when it fits between neighboring words;
    # otherwise allocate up to 40 ms of the preceding inter-word gap.
    embedded_path = AUDIO / 'raw-embedded-transcript.json'
    embedded = read(embedded_path)['words'] if embedded_path.is_file() else []
    repairs = []
    key = lambda text: re.sub(r'[^a-z0-9]', '', text.lower())
    for index, word in enumerate(result):
        if word['end'] > word['start']:
            continue
        previous_end = result[index-1]['end'] if index else 0
        next_start = result[index+1]['start'] if index+1 < len(result) else word['start'] + .04
        matches = [w for w in embedded if key(w['text']) == key(word['text']) and
            abs((w['start'] + w['end']) / 2 - word['start']) < .5 and
            previous_end <= w['start'] < w['end'] <= next_start]
        old = dict(word)
        if matches:
            match = min(matches, key=lambda w: abs(w['end'] - word['start']))
            word['start'], word['end'] = match['start'], match['end']
            method = 'Independent embedded Voice Memos timestamp fitting inter-word gap'
        elif word['start'] > previous_end:
            word['start'] = max(previous_end, word['start'] - .04)
            method = 'Up to 40 ms of preceding inter-word gap'
        else:
            word['end'] = min(next_start, word['start'] + .02)
            method = 'Up to 20 ms of following inter-word gap'
        if word['end'] <= word['start']:
            raise RuntimeError(f'Cannot assign a positive timestamp to word {index}: {word["text"]}')
        repairs.append({'original': old, 'repaired': dict(word), 'method': method})
    dump(AUDIO / 'word-timing-repairs.json', repairs)
    return result

def normalize(source, destination, highpass=True):
    prefix = 'highpass=f=80,' if highpass else ''
    measured = loudness(source, prefix)
    filter_string = prefix + ('loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:'
        f'measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}:'
        f'measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}:'
        f'offset={measured["target_offset"]}:print_format=json')
    ffmpeg('-v', 'error', '-i', source, '-af', filter_string, '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s24le', destination)
    return {'highpass_hz': 80 if highpass else None, 'deesser': None,
        'deesser_reason': 'No de-esser applied; avoid unnecessary attenuation of consonants.',
        'loudnorm_pass1': measured, 'target_integrated_lufs': -16, 'target_true_peak_dbtp': -1.5}

def subtract_words(intervals, words, guard=0.060):
    protected = sorted((max(0, w['start'] - guard), w['end'] + guard) for w in words)
    output = []
    for start, end in intervals:
        pieces = [(start, end)]
        for a, b in protected:
            if a >= end:
                break
            if b <= start:
                continue
            next_pieces = []
            for x, y in pieces:
                if b <= x or a >= y:
                    next_pieces.append((x, y))
                else:
                    if a > x:
                        next_pieces.append((x, a))
                    if b < y:
                        next_pieces.append((b, y))
            pieces = next_pieces
        output.extend(pieces)
    return output

def tighten(clean, words, noise_dbfs):
    data = samples(clean)
    # Classify the proposed removal using 20 ms RMS, rather than rejecting a
    # quiet pause because of one isolated sample peak. Never infer a speech cut
    # from energy alone: every interval must also lie between protected words.
    threshold = -32.0
    fade = round(0.015 * RATE)
    keep = round(0.300 * RATE)
    guard = .060
    duration = len(data) / RATE
    gaps = [(a['end'], b['start']) for a, b in zip(words, words[1:])]
    edits, rejected = [], []
    def quiet_metrics(a, b):
        x = data[max(0,a):min(len(data),b)].astype(np.float64)
        frame = 960
        rms = [np.sqrt(np.mean(x[i:i+frame]**2)) for i in range(0, len(x), frame)]
        return {'rms_dbfs': db(np.sqrt(np.mean(x*x))), 'max_20ms_rms_dbfs': db(max(rms))}
    for start, end in gaps:
        a, b = round(start * RATE), min(len(data), round(end * RATE))
        if (b - a) / RATE <= 0.35:
            continue
        # Keep 315 ms total, then overlap 15 ms: exactly 300 ms remains.
        left = (keep + fade) // 2
        right = keep + fade - left
        cut_a, cut_b = a + left, b - right
        if cut_b <= cut_a:
            continue
        assert all(cut_a / RATE - .015 >= w['end'] + guard or cut_b / RATE + .015 <= w['start'] - guard for w in words), 'Cut intersects a protected word'
        acoustic = quiet_metrics(cut_a-fade, cut_b+fade)
        if acoustic['max_20ms_rms_dbfs'] > threshold:
            rejected.append({'start': start, 'end': end, **acoustic, 'reason': 'Proposed cut contains non-silent audio'})
            continue
        edits.append({'kind': 'pause', 'silence_start': a / RATE, 'silence_end': b / RATE,
            'cut_start': cut_a / RATE, 'cut_end': cut_b / RATE,
            'removed_seconds': (cut_b - cut_a + fade) / RATE, 'crossfade_seconds': fade / RATE,
            **acoustic})
    # Dead space outside the spoken passage is trimmed separately from internal
    # pauses. Retain 100 ms of room tone and a 15 ms fade at either file edge.
    keep_start = max(0, round((words[0]['start'] - .100) * RATE))
    keep_end = min(len(data), round((words[-1]['end'] + .100) * RATE))
    border_edits = []
    if keep_start:
        acoustic = quiet_metrics(max(0, keep_start-fade), keep_start+fade)
        if acoustic['max_20ms_rms_dbfs'] <= threshold:
            border_edits.append({'kind': 'leading', 'silence_start': 0, 'silence_end': words[0]['start'],
                'cut_start': 0, 'cut_end': keep_start / RATE, 'removed_seconds': keep_start / RATE,
                'crossfade_seconds': 0, 'edge_fade_seconds': .015, 'silence_check': '30 ms around edit boundary',
                'retained_seconds': words[0]['start'] - keep_start/RATE,
                'discarded_metrics': quiet_metrics(0, keep_start), **acoustic})
        else:
            keep_start = 0
    if keep_end < len(data):
        # Recognizer word ends may precede a quiet final consonant. Search forward
        # from the 100 ms margin for the first genuinely quiet edit boundary.
        for boundary in range(keep_end, min(len(data)-fade, round((words[-1]['end']+.350)*RATE))+1, round(.005*RATE)):
            if quiet_metrics(boundary-fade, boundary+fade)['max_20ms_rms_dbfs'] <= threshold:
                keep_end = boundary
                break
        acoustic = quiet_metrics(keep_end-fade, min(len(data), keep_end+fade))
        if acoustic['max_20ms_rms_dbfs'] <= threshold:
            border_edits.append({'kind': 'trailing', 'silence_start': words[-1]['end'], 'silence_end': duration,
                'cut_start': keep_end / RATE, 'cut_end': duration, 'removed_seconds': (len(data)-keep_end) / RATE,
                'crossfade_seconds': 0, 'edge_fade_seconds': .015, 'silence_check': '30 ms around edit boundary',
                'retained_seconds': keep_end/RATE - words[-1]['end'],
                'discarded_metrics': quiet_metrics(keep_end, len(data)), **acoustic})
        else:
            keep_end = len(data)
    chunks, cursor = [], keep_start
    ramp = np.linspace(0, 1, fade, dtype=np.float32)
    for edit in edits:
        a, b = round(edit['cut_start'] * RATE), round(edit['cut_end'] * RATE)
        chunks.append(data[cursor:a-fade])
        chunks.append(data[a-fade:a] * (1-ramp) + data[b:b+fade] * ramp)
        cursor = b + fade
    chunks.append(data[cursor:keep_end])
    tight = np.concatenate(chunks)
    if keep_start:
        tight[:fade] *= ramp
    if keep_end < len(data):
        tight[-fade:] *= 1-ramp
    edits = sorted(edits + border_edits, key=lambda e: e['cut_start'])
    mapped = []
    for word in words:
        shifted = dict(word)
        for key in ['start', 'end']:
            value = word[key]
            shifted[key] = round(value - sum(e['removed_seconds'] for e in edits if e['cut_end'] <= value), 6)
        mapped.append(shifted)
    assert len(mapped) == len(words)
    assert all(w['start'] >= 0 and w['end'] > w['start'] and w['end'] <= len(tight) / RATE + .005 for w in mapped), 'Invalid word times'
    temporary = AUDIO / 'vo-tight-before-normalization.wav'
    write_samples(temporary, tight)
    # Shorter pauses alter integrated loudness slightly; perform another measured
    # two-pass normalization on the final timeline to preserve the -16 LUFS spec.
    normalize(temporary, CLIPS / 'vo-tight.wav', highpass=False)
    dump(AUDIO / 'tight-edits.json', {'source': 'clips/vo-clean.wav', 'silence_threshold_dbfs': threshold,
        'silence_detection': 'Maximum 20 ms frame RMS within proposed removal, plus word-timestamp exclusion',
        'pause_trigger_seconds': .35, 'pause_target_seconds': .3, 'word_guard_seconds': guard,
        'edge_room_tone_seconds': .1, 'edge_fade_seconds': .015,
        'crossfade_seconds': .015, 'edits': edits, 'rejected_gaps': rejected, 'words_preserved': len(words),
        'source_duration': len(data) / RATE, 'duration': len(tight) / RATE})
    return mapped, edits

def make_manifests(model, candidates, raw_metrics, full_metrics, words, edits, finish, selection):
    tight = CLIPS / 'vo-tight.wav'
    duration = float(probe(tight)['format']['duration'])
    tight_metrics = metrics(tight)
    if duration > 60:
        say(f'Note: silence-only tight voiceover is {duration:.3f}s, longer than 60 s; speech is never sped up here')
    if abs(tight_metrics['integrated_lufs'] + 16) > .5:
        raise RuntimeError(f'Tight loudness out of range: {tight_metrics["integrated_lufs"]} LUFS')
    if tight_metrics['true_peak_dbtp'] > -1.35:
        raise RuntimeError('Tight true peak exceeds target tolerance')
    groups, group = [], []
    for word in words:
        group.append(word)
        if re.search(r'[.!?]["\']?$', word['text']):
            groups.append(group)
            group = []
    if group:
        groups.append(group)
    boundaries = [0.0]
    boundaries.extend(round((a[-1]['end'] + b[0]['start']) / 2 * RATE) / RATE for a, b in zip(groups, groups[1:]))
    boundaries.append(duration)
    segments = []
    (CLIPS / 'vo').mkdir(parents=True, exist_ok=True)
    for index, group in enumerate(groups):
        start, end = boundaries[index:index+2]
        name = f'{index+1:02}.wav'
        ffmpeg('-v', 'error', '-i', tight, '-af', f'atrim=start_sample={round(start*RATE)}:end_sample={round(end*RATE)},asetpts=PTS-STARTPTS',
            '-ar', str(RATE), '-c:a', 'pcm_s24le', CLIPS / 'vo' / name)
        segments.append({'id': f'{index+1:02}', 'file': f'clips/vo/{name}', 'start': round(start, 6),
            'end': round(end, 6), 'text': ' '.join(w['text'] for w in group), 'words': group})
    captions = []
    for index, word in enumerate(words):
        start = 0 if index == 0 else round(word['start'] * 1000, 3)
        end = round(words[index+1]['start'] * 1000, 3) if index + 1 < len(words) else round(duration * 1000, 3)
        captions.append({'text': ('' if index == 0 else ' ') + word['text'], 'startMs': start, 'endMs': end,
            'timestampMs': round(word['start'] * 1000, 3), 'confidence': round(word['p'], 6)})
    assert captions[0]['startMs'] == 0 and abs(captions[-1]['endMs'] - duration * 1000) < .01
    assert all(c['endMs'] > c['startMs'] for c in captions)
    manifest = {'model': model, 'candidates': candidates, 'raw': raw_metrics,
        'full': 'clips/vo-clean.wav', 'full_metrics': full_metrics,
        'tight': {'file': 'clips/vo-tight.wav', 'duration': duration, 'metrics': tight_metrics},
        'segments': segments, 'word_timing_basis': 'Absolute seconds in clips/vo-tight.wav',
        'caption_timing': 'Display intervals cover full file; timestampMs retains actual word onset.',
        'selection': selection, 'finish': finish, 'edit_count': len(edits),
        'schema_version': SCHEMA_VERSION}
    dump(MANIFEST / 'voiceover.json', manifest)
    dump(MANIFEST / 'captions.json', captions)
    def stamp(s):
        return f'{int(s)//60:02}:{s%60:06.3f}'
    lines = ['# FireJam voiceover', '', f'Duration: {duration:.3f} s. Model: {model}.', '',
        'Segment and word timestamps refer to `clips/vo-tight.wav`.', '']
    lines += [f'[{stamp(s["start"])}–{stamp(s["end"])}] {s["text"]}\n' for s in segments]
    MANIFEST.mkdir(exist_ok=True)
    (MANIFEST / 'transcript.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    say(f'PASS: tight {duration:.3f}s, {tight_metrics["integrated_lufs"]:.2f} LUFS, {tight_metrics["true_peak_dbtp"]:.2f} dBTP; '
        f'{len(words)} caption words, {len(segments)} sentence pieces, {len(edits)} silence cuts')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--candidates-only', action='store_true')
    arguments = parser.parse_args()
    if not RAW.is_file():
        raise RuntimeError(f'Missing input: {RAW}')
    for folder in [AUDIO, CLIPS, MANIFEST]:
        folder.mkdir(parents=True, exist_ok=True)
    inspect_inputs()
    embedded_transcript(RAW)
    raw_audio = AUDIO / 'raw.wav'
    signature = fingerprint(RAW)
    raw_meta = AUDIO / 'raw-source.json'
    if not raw_audio.is_file() or not raw_meta.is_file() or read(raw_meta).get('sha256') != signature:
        ffmpeg('-v', 'error', '-i', RAW, '-vn', '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_f32le', raw_audio)
        dump(raw_meta, {'file': str(RAW.relative_to(ROOT)).replace('\\', '/'), 'sha256': signature})
    pauses = silences(raw_audio, -45, .25)
    raw_metrics = metrics(raw_audio, pauses, AUDIO / 'raw-spectrum.png')
    raw_metrics['file'] = str(RAW.relative_to(ROOT)).replace('\\', '/')
    raw_metrics['source_sha256'] = signature
    dump(AUDIO / 'raw-metrics.json', raw_metrics)
    say(f'Raw: {raw_metrics["duration"]:.3f}s, {raw_metrics["integrated_lufs"]} LUFS, '
        f'pause RMS {raw_metrics["pause_noise_dbfs"]} dBFS, {raw_metrics["clipped_samples"]} clipped samples')
    if arguments.prepare_only:
        return
    # Raw ASR precedes provider processing, and is preserved for comparison.
    transcribe([raw_audio])
    outputs = enhance(RAW)
    transcribe([path for model, path in outputs])
    raw_asr = read(asr_path(raw_audio))
    raw_metrics.update({k: raw_asr[k] for k in ['average_word_probability', 'word_count', 'model', 'device']})
    dump(AUDIO / 'raw-metrics.json', raw_metrics)
    reference = samples(raw_audio)
    candidates = []
    for model, path in outputs:
        data = samples(path)
        delay, correlation = envelope_delay(reference, data)
        shifted_pauses = [[max(0, a + delay), b + delay] for a, b in pauses]
        measured = metrics(path, shifted_pauses, AUDIO / (path.stem + '-spectrum.png'))
        asr = read(asr_path(path))
        measured.update({k: asr[k] for k in ['average_word_probability', 'word_count', 'device']})
        measured.update(candidate_quality(raw_asr['words'], asr['words']))
        measured['asr_model'] = asr['model']
        measured['alignment_delay_seconds'] = delay
        measured['speech_envelope_correlation'] = correlation
        measured['average_word_probability_delta'] = measured['average_word_probability'] - raw_asr['average_word_probability']
        # Whisper's mean word probability wobbles by about 0.01 between near-identical takes, so only a
        # larger drop counts as damage.
        measured['eligible'] = (measured['average_word_probability_delta'] >= -0.01 and
            measured['raw_token_recall'] >= .97 and abs(measured['duration'] - raw_metrics['duration']) < .2 and correlation > .9)
        candidates.append({'model': model, 'file': str(path.relative_to(ROOT)).replace('\\', '/'), 'metrics': measured})
        say(f'{model}: pause {measured["pause_noise_dbfs"]:.2f} dBFS; at -16 LUFS '
            f'{measured["pause_noise_at_minus16_lufs_dbfs"]:.2f} dBFS; mean p={measured["average_word_probability"]:.4f}; '
            f'recall={measured["raw_token_recall"]:.3f}; eligible={measured["eligible"]}')
    dump(AUDIO / 'candidate-comparison.json', candidates)
    if arguments.candidates_only:
        return
    eligible = [c for c in candidates if c['metrics']['eligible']]
    if not eligible:
        raise RuntimeError('No candidate preserves transcription confidence and speech continuity; review work/audio/candidate-comparison.json')
    winner = min(eligible, key=lambda c: c['metrics']['pause_noise_at_minus16_lufs_dbfs'])
    forced = os.environ.get('INSPECT_MODEL')
    if forced:
        winner = next(c for c in candidates if c['model'] == forced)
    source = ROOT / winner['file']
    words = correct_words(read(asr_path(source))['words'])
    finish = normalize(source, CLIPS / 'vo-clean.wav')
    # Use raw-aligned pause windows for gain-matched final comparisons.
    selected_pauses = [[max(0, a + winner['metrics']['alignment_delay_seconds']), b + winner['metrics']['alignment_delay_seconds']] for a, b in pauses]
    full_metrics = metrics(CLIPS / 'vo-clean.wav', selected_pauses, AUDIO / 'vo-clean-spectrum.png')
    mapped, edits = tighten(CLIPS / 'vo-clean.wav', words, full_metrics['pause_noise_dbfs'])
    selection = {
        'rule': 'Reject mean word probability drops over 0.01, token recall <97%, duration drift >=0.2s or speech envelope correlation <=0.9; then lowest gain-matched pause RMS wins.',
        'reason': 'Lowest pause noise at equal -16 LUFS speech loudness among candidates preserving words and transcription confidence.',
        'spectrogram_review': 'Compare raw and both candidate spectrograms for intact speech bands, missing words and isolated tonal remnants; objective measures cannot exclude all perceptual artifacts.',
        'raw_pause_threshold_dbfs': -45, 'raw_pause_minimum_seconds': .25,
        'pause_edge_exclusion_seconds': .08, 'endpoint_silences_excluded': True,
        'same_pause_windows_for_all_candidates': True,
    }
    make_manifests(winner['model'], candidates, raw_metrics, full_metrics, mapped, edits, finish, selection)

if __name__ == '__main__':
    try:
        with inspection_lock():
            main()
    except Exception as exc:
        # Do not dump provider bodies or traceback locals containing credentials.
        message = str(exc)
        key = os.environ.get('FAL_KEY')
        if key:
            message = message.replace(key, '[REDACTED]')
        message = re.sub(r'https://[^\s]+', '[provider URL omitted]', message)
        say(f'inspect failed: {type(exc).__name__}: {message[:1800]}')
        sys.exit(1)
