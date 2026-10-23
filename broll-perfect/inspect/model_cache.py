"""Download official Whisper weights to H: with visible progress and resume.

Uses standard HTTPS rather than Xet, whose transfer can stall on this machine.
Model revision and LFS SHA-256 are pinned on first download in HF_HOME.
"""
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import time
import urllib.request
from media import dump, read, say

MODEL = 'large-v3'
REPO = 'Systran/faster-whisper-large-v3'
REVISION = 'edaa852ec7e145841d8ffdb056a99866b5f0a478'
FILES = {'config.json', 'tokenizer.json', 'vocabulary.json', 'preprocessor_config.json', 'model.bin'}

def download_ranges(folder, info, entry):
    """Bounded public HTTP ranges avoid a single long, opaque model transfer."""
    size = entry['size']
    step = 32 * 1024**2
    count = (size + step - 1) // step
    def fetch(index):
        start, end = index * step, min(size, (index + 1) * step) - 1
        part = folder / f'model.chunk-{index:04}'
        expected = end - start + 1
        if part.is_file() and part.stat().st_size == expected:
            return part
        for attempt in range(3):
            request = urllib.request.Request(f'https://huggingface.co/{REPO}/resolve/{info["revision"]}/model.bin?download=true&inspect={time.time_ns()}',
                headers={'Range': f'bytes={start}-{end}'})
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or response.headers.get('Content-Range', '').split('/')[0] != f'bytes {start}-{end}':
                        raise RuntimeError('Model CDN did not honor requested byte range')
                    with part.open('wb') as target:
                        while chunk := response.read(1024 * 1024):
                            target.write(chunk)
                if part.stat().st_size == expected:
                    return part
            except Exception as exc:
                if attempt == 2:
                    raise RuntimeError(f'Model range {index} failed: {type(exc).__name__}') from None
        raise RuntimeError(f'Model range {index} has incorrect size')
    completed = 0
    say(f'Official {MODEL} weights: {size / 1024**2:.0f} MiB, six resumable HTTPS streams')
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fetch, i) for i in range(count)]
        for future in as_completed(futures):
            future.result()
            completed += 1
            if completed % 8 == 0 or completed == count:
                say(f'Model chunks: {completed}/{count} complete')
    partial = folder / 'model.bin.part'
    with partial.open('wb') as target:
        for index in range(count):
            with (folder / f'model.chunk-{index:04}').open('rb') as source:
                for chunk in iter(lambda: source.read(8 * 1024**2), b''):
                    target.write(chunk)
    return partial

def ensure_model():
    folder = Path(os.environ['HF_HOME']) / 'firejam-models' / MODEL
    folder.mkdir(parents=True, exist_ok=True)
    ready = folder / 'ready.json'
    if ready.is_file():
        info = read(ready)
        if all((folder / f['rfilename']).is_file() and (folder / f['rfilename']).stat().st_size == f['size'] for f in info['files']):
            return folder
    metadata = folder / 'repository.json'
    if not metadata.is_file():
        with urllib.request.urlopen(f'https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true', timeout=30) as response:
            info = json.load(response)
        dump(metadata, {'revision': info['sha'], 'files': [f for f in info['siblings'] if f['rfilename'] in FILES]})
    info = read(metadata)
    for entry in sorted(info['files'], key=lambda x: x['rfilename'] == 'model.bin'):
        destination = folder / entry['rfilename']
        expected = entry['size']
        if destination.is_file() and destination.stat().st_size == expected:
            continue
        partial = destination.with_suffix(destination.suffix + '.part')
        if entry['rfilename'] == 'model.bin':
            partial = download_ranges(folder, info, entry)
        for attempt in range(0 if entry['rfilename'] == 'model.bin' else 3):
            offset = partial.stat().st_size if partial.is_file() else 0
            if offset == expected:
                break
            request = urllib.request.Request(f'https://huggingface.co/{REPO}/resolve/{info["revision"]}/{entry["rfilename"]}?download=true&inspect={time.time_ns()}',
                headers={'Range': f'bytes={offset}-'} if offset else {})
            say(f'Model download {entry["rfilename"]}: {offset / 1024**2:.0f}/{expected / 1024**2:.0f} MiB')
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    if offset and response.status != 206:
                        offset = 0
                    total = offset
                    last_report = offset
                    with partial.open('ab' if offset else 'wb') as target:
                        while chunk := response.read(1024 * 1024):
                            target.write(chunk)
                            total += len(chunk)
                            if total - last_report >= 256 * 1024**2:
                                say(f'Model download: {total / 1024**2:.0f}/{expected / 1024**2:.0f} MiB')
                                last_report = total
                if partial.stat().st_size == expected:
                    break
            except Exception as exc:
                say(f'Model transfer retry {attempt+1}: {type(exc).__name__}')
        if not partial.is_file() or partial.stat().st_size != expected:
            raise RuntimeError(f'Incomplete official model download: {entry["rfilename"]}')
        expected_hash = entry.get('lfs', {}).get('sha256')
        if expected_hash:
            h = hashlib.sha256()
            with partial.open('rb') as source:
                for chunk in iter(lambda: source.read(8 * 1024**2), b''):
                    h.update(chunk)
            if h.hexdigest() != expected_hash:
                partial.unlink()
                raise RuntimeError('Whisper weight SHA-256 mismatch')
        partial.replace(destination)
        if entry['rfilename'] == 'model.bin':
            for chunk_path in folder.glob('model.chunk-*'):
                chunk_path.unlink()
    if not (folder / 'model.bin').is_file():
        raise RuntimeError('Official Whisper model metadata has no model.bin')
    dump(ready, info)
    return folder
