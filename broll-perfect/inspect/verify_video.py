"""Exercise future video inputs with a disposable two-scene, audio-bearing clip."""
from media import ROOT, AUDIO, ffmpeg, inspect_inputs, probe, read, say

folder = ROOT / 'inspect/video-test'
folder.mkdir(exist_ok=True)
name = 'inspect-video-fixture'
video = folder / (name + '.mp4')
artifacts = [video, ROOT / 'work/sheets' / (name + '.jpg')]
artifacts.extend(AUDIO / 'inputs' / (name + suffix) for suffix in ['.wav', '.probe.json', '.inspection.json'])
try:
    ffmpeg('-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=1.2',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1.2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.4',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', video)
    inspect_inputs(folder)
    record = read(AUDIO / 'inputs' / (name + '.inspection.json'))
    assert any(abs(t - 1.2) < .1 for t in record['scene_changes'])
    assert (ROOT / record['contact_sheet']).is_file()
    assert record['contact_sheet_fps'] == 1
    stream = probe(ROOT / record['audio'])['streams'][0]
    assert stream['codec_type'] == 'audio' and stream['sample_rate'] == '48000'
    inspect_inputs(folder)  # Must exercise the cached path too.
    say('PASS: ffprobe, scene at 1.2s, 1 fps contact sheet, 48 kHz extracted audio, cached rerun')
finally:
    for artifact in artifacts:
        artifact.unlink(missing_ok=True)
    folder.rmdir()
