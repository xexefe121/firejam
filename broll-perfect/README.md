# broll-perfect

The FireJam demo film, built from code: real app captures, the creator's voiceover, a scored music bed and Remotion motion design, rendered to `out/firejam-demo-1min.mp4` (1920x1080, 30 fps, about 65 s).

Raw media, captures, renders and generated audio are never committed. Everything here can be regenerated from the steps below.

## Pipeline

| Step | Command | What it does |
|---|---|---|
| Capture | `npm run capture [-- <id>...]` | Drives the real FireJam web app (Edge via Playwright, CDP screencast to CFR 30 fps H.264) and the USB Fire TV Stick (adb D-pad keys + `screenrecord`) through every demo beat. Writes `public/broll/<id>.mp4` and `manifest/broll.json` with event times (e.g. when the "Ma paused" banner appears). See [capture/README.md](capture/README.md). |
| Inspect | `npm run inspect` | Analyses `raw/footage/*`, cleans the voiceover with fal.ai models (DeepFilterNet3, ElevenLabs voice isolation, VEED clean-audio), compares them on pause noise and Whisper large-v3 confidence, normalises the winner and trims long pauses. Writes `public/clips/vo-tight.wav` and `manifest/voiceover.json`. See [inspect/README.md](inspect/README.md). |
| Edit | `npm run edit` | `edit/voice.py` removes a stray word, brings the narration to 1.1x with Rubber Band (pitch and formants kept) and aligns captions to the script's spelling. `edit/build.mjs` then times every shot to the narration's words and writes `manifest/edit.json`. |
| Preview | `npm run studio` | Remotion Studio on port 3111. |
| Render | `npm run render` | Rebuilds the edit, renders `out/render.mp4` and masters it to -14 LUFS / -1 dBTP as `out/firejam-demo-1min.mp4`. |

## Sources

- **Captures:** FireJam itself, recorded on a throwaway local server with the demo bots, so no real users appear. The four Fire TV shots are from a Fire TV Stick 4K Max over USB; the capture restores the stick's server URL afterwards.
- **Films on screen:** *Sintel* (Blender Foundation, CC BY 3.0), credited on the end card.
- **Voiceover:** the creator's own recording, cleaned with `fal-ai/elevenlabs/audio-isolation`.
- **Music:** generated for this film with ElevenLabs Music v2.5 on fal (`work/music/gen2.py` holds the composition plan, scored to the edit's sections).

## Secrets and disk

- The fal key is read at runtime from `H:\firejam-tools\secrets\fal.env`, outside the repository, and never logged.
- C: is nearly full on the capture PC, so caches and temp files live on H: and Y: (see each README).
