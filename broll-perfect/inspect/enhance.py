"""At most three provider models, with durable cache and request recovery."""
import os
from pathlib import Path
import urllib.request
from bootstrap import load_key
from media import AUDIO, RATE, dump, ffmpeg, fingerprint, probe, read, say

MODELS = [
    ('fal-ai/deepfilternet3', 'deepfilternet3'),
    ('fal-ai/elevenlabs/audio-isolation', 'elevenlabs-audio-isolation'),
    ('veed/clean-audio', 'veed-clean-audio'),
]

def enhance(source):
    import fal_client
    signature = fingerprint(source)
    outputs = []
    uploaded = None
    for model, slug in MODELS:
        output = AUDIO / f'fal-{slug}.wav'
        state_path = AUDIO / f'fal-{slug}.meta.json'
        state = read(state_path) if state_path.is_file() else {}
        if (output.is_file() and state.get('source_sha256') == signature and state.get('complete')
                and state.get('output_sha256') == fingerprint(output)):
            probe(output)
            say(f'fal cached: {model}')
            outputs.append((model, output))
            continue
        # Only load external key when an actual provider request is needed.
        load_key()
        if state.get('source_sha256') != signature:
            state = {'model': model, 'source_sha256': signature}
        if not state.get('audio_url'):
            if state.get('request_id'):
                say(f'fal resume existing request: {model}')
                result = fal_client.get_handle(model, state['request_id']).get()
            else:
                if uploaded is None:
                    uploaded = fal_client.upload_file(str(source))
                say(f'fal submit: {model}')
                def on_enqueue(request_id):
                    state['request_id'] = request_id
                    dump(state_path, state)
                last_status = None
                def on_queue_update(update):
                    nonlocal last_status
                    status = type(update).__name__
                    if status != last_status:
                        say(f'fal {model}: {status}')
                        last_status = status
                arguments = {'audio_url': uploaded}
                if model == 'fal-ai/deepfilternet3':
                    arguments['audio_format'] = 'wav'
                elif model == 'veed/clean-audio':
                    arguments.update({'output_format': 'wav', 'strength': .874, 'target_lufs': -19})
                result = fal_client.subscribe(model, arguments=arguments, with_logs=False,
                    on_enqueue=on_enqueue, on_queue_update=on_queue_update)
            audio = result.get('audio', result.get('audio_file', result.get('output', {})))
            url = audio.get('url') if isinstance(audio, dict) else audio
            if not isinstance(url, str) or not url.startswith('https://'):
                raise RuntimeError(f'{model}: no HTTPS audio result')
            state['audio_url'] = url
            dump(state_path, state)
        downloaded = AUDIO / f'fal-{slug}.download'
        with urllib.request.urlopen(state['audio_url'], timeout=120) as response, downloaded.open('wb') as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        temporary = AUDIO / f'fal-{slug}.partial.wav'
        ffmpeg('-v', 'error', '-i', downloaded, '-vn', '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_f32le', temporary)
        probe(temporary)
        temporary.replace(output)
        downloaded.unlink()
        state['complete'] = True
        state['output_sha256'] = fingerprint(output)
        # URLs need not be persisted once output has been received.
        state.pop('audio_url', None)
        dump(state_path, state)
        outputs.append((model, output))
        say(f'fal saved: {output.name}')
    return outputs
