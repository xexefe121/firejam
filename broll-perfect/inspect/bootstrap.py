"""Read-only setup check. Never prints credentials or provider response bodies."""
import importlib.metadata
import json
import os
from pathlib import Path
import urllib.request

def load_key():
    secret = Path(r'H:\firejam-tools\secrets\fal.env')
    if not secret.is_file():
        raise RuntimeError(f'Missing {secret}')
    for line in secret.read_text(encoding='utf-8-sig').splitlines():
        if line.strip().startswith('FAL_KEY='):
            key = line.split('=', 1)[1].strip().strip('"\'')
            if key:
                os.environ['FAL_KEY'] = key
                return
    raise RuntimeError('FAL_KEY missing or empty in external secrets file')

if __name__ == '__main__':
    load_key()
    for query in ['deepfilternet3', 'audio-isolation']:
        req = urllib.request.Request('https://api.fal.ai/v1/models?q=' + query,
            headers={'Authorization': 'Key ' + os.environ['FAL_KEY']})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.load(response)
            entries = data.get('models', data.get('data', []))
            print(json.dumps({'query': query, 'models': [x.get('endpoint_id', x.get('id')) for x in entries][:6]}))
        except Exception as exc:
            print(f'Model discovery: {type(exc).__name__}; known documented endpoints available')
    import ctranslate2
    print('CUDA devices:', ctranslate2.get_cuda_device_count())
    for package in ['faster-whisper', 'fal-client', 'nvidia-cublas-cu12', 'nvidia-cudnn-cu12']:
        print(package, importlib.metadata.version(package))
