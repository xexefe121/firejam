"""Isolated ASR worker: a failed CUDA load cannot abort paid audio processing."""
import argparse
import os
from pathlib import Path
import sys
import time
import numpy as np
from media import dump, ffmpeg, fingerprint, read, say

from model_cache import MODEL, REVISION, ensure_model
ASR_VERSION = 2
DLL_HANDLES = []

def configure_cuda():
    # Windows wheels ship DLLs outside PATH. Keep add_dll_directory handles alive.
    for root in map(Path, sys.path):
        for name in ['cublas', 'cudnn', 'cuda_nvrtc']:
            folder = root / 'nvidia' / name / 'bin'
            if folder.is_dir():
                os.environ['PATH'] = str(folder) + os.pathsep + os.environ.get('PATH', '')
                if hasattr(os, 'add_dll_directory'):
                    DLL_HANDLES.append(os.add_dll_directory(str(folder)))

def transcribe(paths, device):
    configure_cuda()
    from faster_whisper import WhisperModel
    started = time.monotonic()
    model = WhisperModel(str(ensure_model()), device=device, compute_type='int8_float16' if device == 'cuda' else 'int8',
        cpu_threads=min(8, os.cpu_count() or 4), num_workers=1)
    say(f'Whisper {MODEL} loaded on {device} ({time.monotonic() - started:.1f}s)')
    for filename in paths:
        path = Path(filename)
        output = path.with_name(path.stem + '.asr.json')
        signature = fingerprint(path)
        if (output.is_file() and read(output).get('sha256') == signature and read(output).get('model') == MODEL
                and read(output).get('config_version') == ASR_VERSION):
            say(f'ASR cached: {path.name}')
            continue
        if output.is_file() and read(output).get('model') != MODEL:
            previous = read(output)
            dump(path.with_name(path.stem + '.' + previous['model'] + '.asr.json'), previous)
        elif output.is_file() and read(output).get('config_version') != ASR_VERSION:
            previous = read(output)
            dump(path.with_name(path.stem + '.' + previous['model'] + '.vad.asr.json'), previous)
        start = time.monotonic()
        # Decode through ffmpeg: recent PyAV removed metadata_errors, which this
        # faster-whisper release still passes to av.open. ndarray input bypasses
        # that version-sensitive path and always supplies 16 kHz mono audio.
        audio = np.frombuffer(ffmpeg('-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000',
            '-f', 'f32le', 'pipe:1').stdout, dtype='<f4').copy()
        segments, info = model.transcribe(audio, language='en', word_timestamps=True, beam_size=5,
            temperature=0, condition_on_previous_text=False, vad_filter=False,
            initial_prompt='FireJam, Fire TV, Jam Map, Alexa, Prime Video, AWS.')
        result, words = [], []
        for segment in segments:
            local = [{'text': w.word.strip(), 'start': round(w.start, 6), 'end': round(w.end, 6), 'p': round(w.probability, 6)} for w in segment.words or []]
            words.extend(local)
            result.append({'start': segment.start, 'end': segment.end, 'text': segment.text.strip(), 'words': local})
        if not words:
            raise RuntimeError(f'Whisper returned no words for {path.name}')
        dump(output, {'sha256': signature, 'model': MODEL, 'model_revision': REVISION, 'device': device,
            'config_version': ASR_VERSION, 'vad_filter': False, 'word_timestamps': True,
            'compute_type': 'int8_float16' if device == 'cuda' else 'int8', 'language': info.language,
            'average_word_probability': sum(w['p'] for w in words) / len(words),
            'word_count': len(words), 'segments': result, 'words': words})
        say(f'ASR {path.name}: {len(words)} words, mean p={sum(w["p"] for w in words) / len(words):.4f}, {time.monotonic() - start:.1f}s')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', choices=['cuda', 'cpu'], default='cuda')
    parser.add_argument('files', nargs='+')
    arguments = parser.parse_args()
    transcribe(arguments.files, arguments.device)
