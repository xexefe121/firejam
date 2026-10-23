# Voiceover inspection

From `broll-perfect`, run `npm run inspect`. Requires Node, uv, ffmpeg and ffprobe
on PATH. No package.json changes or project-local Python environment are needed.

The entry point puts uv packages on `H:\firejam-tools\uv-cache`, official Whisper
weights on `H:\firejam-tools\hf-cache`, and temporary files on `Y:\Temp`.
The external credential file is `H:\firejam-tools\secrets\fal.env`, containing
`FAL_KEY=...`. Its value is loaded only at runtime for provider requests, never
logged or copied. Cached provider outputs can be reused without loading the key.

## Processing

1. Probe each supported media file under `raw/footage`. Videos additionally get
   a scene-change list (threshold 0.30), an eight-column 1 fps JPEG sheet under
   `work/sheets`, and mono 48 kHz extracted audio under `work/audio/inputs`.
2. Decode the designated voiceover, measure loudness, astats, clipping and pause
   RMS, and generate `work/audio/raw-spectrum.png`. Noise measurements use the
   interior of raw pauses detected below -45 dBFS for at least 250 ms, excluding
   80 ms at each pause edge and excluding initial/final dead silence.
3. Transcribe raw audio with faster-whisper, English, word timestamps, beam 5,
   temperature zero, and the official `large-v3` checkpoint. The initial distilled
   transcripts are retained for comparison; all candidates are judged using the
   same full model. The pinned
   revision (`edaa852ec7e145841d8ffdb056a99866b5f0a478`) and SHA-256-verified
   weights stay in HF_HOME. CUDA int8_float16 is
   attempted once, with CPU int8 fallback. To skip GPU dependencies entirely,
   set `INSPECT_DEVICE=cpu` before running npm.
   VAD is disabled for the final comparison so every model sees the untrimmed
   input timeline; per-file VAD can otherwise alter segmentation after cleanup.
4. Run three distinct fal models: `fal-ai/deepfilternet3` (WAV output),
   `fal-ai/elevenlabs/audio-isolation`, and `veed/clean-audio` (MossFormer2).
   The third was added after both initial candidates reduced Whisper confidence.
   Each uses the original recording. Durable
   request IDs allow an interrupted run to resume rather than submit again.
   Completed outputs and word transcripts are content-hash cached. A changed
   recording triggers new requests; unchanged inputs incur no further charges.
   An OS file lock prevents simultaneous runs from submitting duplicate jobs.
5. Re-transcribe each candidate. Reject reductions in mean word probability,
   raw token recall below 97%, duration drift of 200 ms or more, and speech
   envelope correlation at or below 0.9. Choose the lowest pause RMS after
   correcting all candidates to equal -16 LUFS speech loudness. Candidate noise
   windows are aligned to raw audio using 10 ms RMS-envelope correlation.
6. Apply an 80 Hz highpass and measured two-pass loudnorm to -16 LUFS, -1.5 dBTP,
   48 kHz mono PCM24. No de-esser is enabled by default; speech clarity takes
   priority over unnecessary processing. Both candidates and the final full
   voiceover have spectrograms with the same frequency/dB scale as raw audio.
   `*-spectrum-level-matched.png` versions additionally apply the measured gain
   needed for -16 LUFS, permitting visual comparisons at equal speech loudness.
7. Shorten inter-word pauses longer than 350 ms to 300 ms. Proposed removals must
   have every 20 ms RMS frame at or below -32 dBFS on the normalized recording.
   Every splice stays in this acoustic silence, outside word
   timestamps plus a 60 ms guard, with a 15 ms linear crossfade. Guards sit inside
   the retained 300 ms. Separately trim dead leading/trailing silence with at least 100 ms retained,
   with 15 ms edge fades; the 30 ms around each edge cut must pass the same silence
   check. Non-speech handling noise outside the spoken passage can therefore be
   discarded too, without placing a cut in that noise. The tail boundary searches
   up to 350 ms after the last timestamp to protect quiet final consonants. No speech is
   sped up or deleted. Normalize the tight timeline again with measured two-pass
   loudnorm. Fail if a silence-only edit cannot fit within 60 seconds.
8. Partition the entire tight file at sentence boundaries in inter-word gaps.
   Split clips reassemble sample-for-sample into the tight file.

## Deliverables

- `public/clips/vo-clean.wav`: full enhanced and finished recording.
- `public/clips/vo-tight.wav`: word-preserving short version.
- `public/clips/vo/NN.wav`: contiguous sentence pieces.
- `manifest/voiceover.json`: candidates, objective metrics, selection, processing,
  files, sentence ranges and word timestamps.
- `manifest/captions.json`: Remotion Caption[] with one entry per word. All words
  after the first have a leading space. Display intervals cover the whole file;
  `timestampMs` retains the actual word onset.
- `manifest/transcript.md`: sentence transcript and tight timeline ranges.
- `work/audio/tight-edits.json`: exact silence cuts and duration accounting.
- `work/audio/*spectrum.png`: raw, both candidates, and finished full spectra.

Sentence `start`/`end` and nested word `start`/`end` are **absolute seconds in
vo-tight.wav**. When playing a sentence clip alone, subtract its segment start.

Objective checks cannot exclude every subtle perceptual artifact; audition the
chosen voiceover before final render. Whisper probabilities are confidence
proxies, not a ground-truth word-error-rate measurement. Product-name casing is
corrected without rewriting spoken content.

`inspect/verify.py` validates actual delivered audio, timing, captions, splice
guards, cache hashes and absence of the literal credential in text outputs.
`inspect/verify_video.py` exercises video probing, scenes, sheets, audio extraction
and cache reuse with a disposable synthetic input, leaving no fixture artifacts.
