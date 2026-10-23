"""Validate delivered timing, audio format, sentence partition and paid cache."""
from pathlib import Path
import re
import numpy as np
from media import ROOT, AUDIO, RATE, fingerprint, probe, read, samples, say

def main():
    manifest = read(ROOT / 'manifest/voiceover.json')
    captions = read(ROOT / 'manifest/captions.json')
    edits = read(AUDIO / 'tight-edits.json')
    full, tight = (ROOT / 'public' / manifest['full'], ROOT / 'public' / manifest['tight']['file'])
    duration = manifest['tight']['duration']
    assert duration <= 60
    for path in [full, tight]:
        stream = probe(path)['streams'][0]
        assert stream['sample_rate'] == '48000' and stream['channels'] == 1 and stream['codec_name'] == 'pcm_s24le'
    words = [w for s in manifest['segments'] for w in s['words']]
    assert len(words) == len(captions) == edits['words_preserved']
    assert manifest['segments'][0]['start'] == 0
    assert abs(manifest['segments'][-1]['end'] - duration) < 1 / RATE
    for a, b in zip(manifest['segments'], manifest['segments'][1:]):
        assert abs(a['end'] - b['start']) < 1 / RATE
    joined = []
    for segment in manifest['segments']:
        assert all(segment['start'] - .001 <= w['start'] < w['end'] <= segment['end'] + .001 for w in segment['words'])
        clip = samples(ROOT / 'public' / segment['file'])
        assert abs(len(clip) / RATE - (segment['end'] - segment['start'])) < 2 / RATE
        joined.append(clip)
    concatenated = np.concatenate(joined)
    target = samples(tight)
    assert len(concatenated) == len(target) and np.max(np.abs(concatenated - target)) < 1e-7, 'Sentence split changed audio'
    for i, (word, caption) in enumerate(zip(words, captions)):
        assert caption['text'] == ('' if i == 0 else ' ') + word['text']
        assert caption['startMs'] < caption['endMs']
        assert abs(caption['timestampMs'] - word['start'] * 1000) < .01
        if i:
            assert caption['startMs'] == captions[i-1]['endMs']
    assert captions[0]['startMs'] == 0 and abs(captions[-1]['endMs'] - duration * 1000) < .01
    winner = next(c for c in manifest['candidates'] if c['model'] == manifest['model'])
    asr = read((ROOT / winner['file']).with_suffix('.asr.json'))
    source = samples(full)
    assert abs(len(source) / RATE - duration - sum(e['removed_seconds'] for e in edits['edits'])) < 2 / RATE
    for edit in edits['edits']:
        assert all(edit['cut_start'] - .015 >= w['end'] or edit['cut_end'] + .015 <= w['start'] for w in asr['words'])
        residual = edit['silence_end'] - edit['silence_start'] - edit['removed_seconds']
        assert abs(residual - (.300 if edit['kind'] == 'pause' else edit['retained_seconds'])) < 1 / RATE
        if edit['kind'] != 'pause':
            assert .100 - 1/RATE <= edit['retained_seconds'] <= .350 + 1/RATE
        assert edit['max_20ms_rms_dbfs'] <= edits['silence_threshold_dbfs']
    for candidate in manifest['candidates']:
        path = ROOT / candidate['file']
        cache = read(path.with_suffix('.meta.json'))
        assert cache['complete'] and cache['output_sha256'] == fingerprint(path)
    # Check literal credential absence without ever displaying the credential.
    from bootstrap import load_key
    import os
    load_key()
    secret = os.environ['FAL_KEY'].encode()
    locations = [ROOT / 'inspect', ROOT / 'work/audio', ROOT / 'manifest', ROOT / 'public/clips']
    checked = 0
    for folder in locations:
        for path in folder.rglob('*'):
            if path.is_file() and path.suffix.lower() in {'.json', '.md', '.py', '.mjs', '.log', '.txt'}:
                assert secret not in path.read_bytes(), f'Credential found in {path.name}'
                checked += 1
    say(f'PASS: {len(words)} words, {len(manifest["segments"])} gapless/lossless sentence pieces; '
        f'{len(edits["edits"])} word-safe 15 ms crossfades; cache hashes valid; {checked} text files contain no credential')

if __name__ == '__main__':
    main()
