# FireJam b-roll capture

From `H:\firejam\broll-perfect`:

```powershell
npm run capture
npm run capture -- tv-player-sync laptop-player-sync
npm run capture -- web-phone-companion tv-reactions
```

Requires installed Edge, ffmpeg/ffprobe, adb, the USB Fire TV
`G072JM1352950DJM`, free host ports 3000/3001, and `Y:\Temp`.
Runner refuses to kill an existing listener. No Playwright browser download.
`TEMP` and `TMP` point to `Y:\Temp` before Edge/build/server startup.

Each run builds web once, starts a server with a new data directory under
`Y:\Temp\firejam-capture`, and creates Dhanu in Sydney with Prime. Capture
bootstrap seeds Math.random in that process to stabilize bot world/timers.
Ma's demo profile stays connected to suppress unsolicited bot messages.
App source and normal server data are never edited.

First run mirrors the app's original Sintel MP4 into `work/media` using
resumable bounded range downloads. Later runs reuse it. A capture-only HTTP
server on 3001 provides Range and CORS support; bootstrap changes the media
URL in memory. Fire TV uses a temporary reverse mapping for that mirror.
Set `FIREJAM_CAPTURE_MIRROR=0` to stream from archive.org instead; remote
seeks may buffer. Do not use `npm run media:fetch -w server` for this workflow,
because it writes outside this directory.

Web frames use `Page.startScreencast`, JPEG quality 96, and source timestamps.
They are piped into ffmpeg with sample-and-hold resampling at exactly 30 fps.
Paired pages share one wall-clock start. `work/<id>.timing.json` retains source
timestamps and the UTC start for audit. Audio comes from the decoded video
through Web Audio/MediaRecorder; pause silence stays on the same timeline.
Home/map/companion and the join transition do not have audio tracks.

Fire TV uses actual adb D-pad keys and native 20 Mbps screenrecord, then the
same H.264 CRF 16 / limited-range yuv420p / CFR 30 output. Android screenrecord
does not capture film audio. In a `finally` block, runner restores and verifies
`https://d12le9d1o14nhz.cloudfront.net`, removes its adb forward, and restores
the previous reverse mappings. Evidence: `work/firetv-restore.json`.

Outputs: `public/broll/<id>.mp4`, `manifest/broll.json`, and
`work/sheets/<id>.jpg`. Each output passes ffprobe before its manifest entry
is updated. Existing entries/files for unrequested IDs remain untouched.
When re-capturing a pair, request both IDs to keep their shared take aligned.
Manifest events contain actual action/visible-state times relative to start.

Player member/sync chips follow the app's normal five-second auto-hide and
return while paused. No CSS overrides or synthetic UI are used. Film credit:
© copyright Blender Foundation | durian.blender.org (CC-BY 3.0).

For isolated web diagnostics only, `FIREJAM_CAPTURE_PORT` can override 3000;
Fire TV capture intentionally requires the requested host port 3000.
`FIREJAM_CAPTURE_SKIP_BUILD=1` reuses an already-built web bundle.
