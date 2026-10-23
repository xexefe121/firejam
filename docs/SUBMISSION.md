# Devpost submission notes

Drafts for the Devpost form, ready to paste. "What we learned" is a first draft in my voice; edit it to taste.

**Track:** Fire TV. Fits the priority categories *family entertainment* and *multi-modal UX* (TV + phone + D-pad).
**Mini challenges:** **AWS Builder** (hosted on AWS, plus Amazon Bedrock "Pick for us"; details below). **Open Source** needs a separate open-source project or contribution besides this repo: see `docs/OPEN_SOURCE.md`.

## Tagline

The living room is back. FireJam makes watching TV multiplayer.

## Inspiration

My mum is in India and I'm in Sydney. When I was a kid, TV was what we did together on one couch. Smart TVs got smarter, but watching became single-player. Spotify Jam showed how good "what are my friends listening to, let me join" can feel for music. Nothing does that for the biggest screen in the house.

## What it does

FireJam is Spotify Jam for Fire TV.

- **See what friends are watching.** Home shows friends' live jams with their city and local time: "Ma is watching Sintel. It's 8:42 pm in Hyderabad."
- **Jam Map.** A Snap-Map-style world map of friends and public jams. Arcs connect everyone watching together. Move between people with the D-pad, then join, add a friend, or invite. Ghost mode hides you.
- **Join in one click, same frame.** Every screen in a jam plays from one shared playhead, typically within a few tens of milliseconds. Anyone can play, pause, skip or switch film, and everyone sees who did it.
- **Friends, requests and invites.** Friends-only, public and invite-only jams. Hosts get a prompt when someone knocks. Four-letter join codes.
- **Friend pop-ups.** When a friend starts watching, your Fire TV pops up "🔥 Ma is watching Sintel" over whatever is on, even with FireJam closed; the notification opens FireJam straight into their jam.
- **Follows Fire TV profiles.** Each Fire TV profile is one person: pick your FireJam profile once, and from then on switching Fire TV profiles switches FireJam at the same moment, pop-ups and activity sharing included. Fire TV keeps profile names private, so you set your name once in FireJam's profile (Name).
- **"Alexa, pause."** Alexa's transport commands (pause, play, rewind 30 seconds, restart) drive the whole jam for everyone.
- **Laptops join Prime jams too.** A Windows bridge keeps the Prime Video app on a PC in the same jam as the TVs, through Windows' media controls.
- **Friend activity for everyone.** Like Spotify's friend activity: see what friends are watching right now, even outside FireJam (Prime Video, YouTube, any app with a media session), and what they watched recently and with whom. If a friend is on a Prime title and you both have Prime, one button starts a jam at their exact spot.
- **Share first.** Starting a jam opens its invite: a QR code anyone can scan (it opens a join page with the code and how to join from a TV or a browser) and a four-letter code. The jam waits until the host presses Start; for Prime titles every TV then opens Prime Video together.
- **Prime-first Watch screen.** With Prime Video, the Watch screen leads with 19 Prime shows and films (Fallout, Reacher, The Family Man, Mirzapur, Panchayat…); FireJam's free films sit below.
- **Private sign-in.** Everyone's id is visible on the map, so an id alone signs nobody in: a screen needs the profile's secret token (carried by the phone-pairing QR) or has to be a TV the profile is bound to.
- **Your phone is the remote.** Pair your phone from the Invite screen to send reactions and chat with no app install (works on iPhone in Safari). Reactions and messages pop up on every TV, over Prime Video too.
- **Voice, remote and phone in one flow.** The same jam answers to "Alexa, pause", the D-pad and a phone.
- **Any TV can join.** Fire TV first, and the same app runs on Android TV / Google TV (tested on a Google TV emulator, including a two-switch permission setup done with the remote). Samsung/LG join in the TV browser.
- **Prime Video jams, bring your own subscription.** If everyone in a jam has Prime Video, each TV opens the title in its own Prime Video app and FireJam keeps them in step through Android's media session controls, with reactions drawn on top. No Prime, no entry: the server enforces it for starting, joining, invites and switching titles.

## How we built it

- **TV app:** React + TypeScript (Vite) built for the 10-foot UI. A custom spatial-navigation layer moves focus by on-screen geometry, so every screen works with a D-pad without hand-wired focus maps. Layout scales from the Fire TV WebView's 960×540 CSS pixels up to 4K.
- **Fire OS shell:** a small Kotlin app (`android/`) with a full-screen WebView, leanback launcher banner, and forwarding for the remote's Back and media keys, which WebViews don't pass to JavaScript. Hold Menu to point the TV at a different server.
- **Realtime server:** Node + Socket.IO. Presence, friend graph, jams, join requests and invites, rate-limited reactions and chat, JSON persistence for profiles.
- **Sync engine:** the server stores each jam as `(playing, position, updatedAt)` on its clock. Each screen estimates its clock offset NTP-style, computes the expected playhead, and corrects drift by nudging `playbackRate` (±10%, inaudible) or, for big jumps, seeking ahead by the device's measured seek latency.
- **Map:** `d3-geo` Natural Earth projection over `world-atlas` data, rendered as SVG with HTML pins layered on top so they're focusable.
- **Content:** Blender Foundation open movies (CC-BY), MP4 and HLS (`hls.js`), streamed by FireJam itself. Prime Video titles play in each viewer's own Prime Video app; the Fire TV shell follows Prime Video's media session (notification-listener access) and draws jam bubbles over it.

## Challenges we ran into

- **Remote input in a WebView.** Back and media keys never reach JavaScript, so the native shell forwards them and asks the web app whether it handled Back before exiting.
- **Spatial navigation that feels right.** Early versions jumped from a card row into the side rail, or skipped rows. The fix was preferring the current group, requiring a candidate's centre to lie past the current element's edge, and scoring same-row neighbours far above diagonal ones.
- **Performance on a streaming stick.** Profiling the real device showed the TV burning 58% of a CPU core on an idle Home screen: progress bars animated `width` (a page layout every frame) and decorative loops kept it redrawing at 60 fps. Fixing those took idle CPU to 8% (Home) and 19% (Jam Map, from 128%), and giving the map its own layer removed the ~130 ms frame drops when moving between pins.
- **Fire TV profiles without an API.** The profile-switch broadcast is restricted to Amazon's apps, so FireJam follows the active profile id in secure settings instead, hashed before it leaves the TV.
- **Sync on slow hardware.** Naive "seek when off by more than X" loops forever on a Fire TV Stick, because each seek lands late. Measuring seek latency and aiming ahead, plus rate nudging for small drift, fixed it.

## Accomplishments that we're proud of

- Pausing on a laptop in "Hyderabad" pauses a Fire TV in "Sydney" with a banner saying who did it, and the corner reads *In sync · 18 ms*.
- The whole app is usable with nothing but a Fire TV remote.

## What we learned

- A TV is not a big phone. Measuring on the real Fire TV Stick changed the design: endless CSS animations that look free on a laptop cost half a CPU core on a stick, and text that looked fine on a monitor was below Amazon's 28 px minimum from the sofa.
- Sync is mostly about time, not video. The hard parts were a TV clock 162 s off, seeks that land late, Prime Video reporting position 0 during ads, and timers that freeze when an app is in the background.
- Fire TV gives apps a lot (media sessions, Alexa transport controls, overlays), but the things a social app needs most, Prime Video deep links and Fire TV profiles, are reserved for Amazon's own apps. Finding the edges of what's allowed was half the work.

## What's next for FireJam

- Sync the apps people already watch in, through Fire TV deep links and playback hooks, instead of an in-app catalogue.
- "Alexa, start a jam with Mum." Voice start, join and invite through Alexa+.
- Push-to-talk from the phone companion, ducking the film's audio while someone speaks.
- Login with Amazon, contact-based friend discovery, and moderation before public jams go beyond a demo.

## Built with

react, typescript, vite, node.js, socket.io, express, kotlin, android-webview, fire-os, alexa (media session), amazon-bedrock, amazon-ec2, amazon-cloudfront, amazon-s3, aws-systems-manager, aws-iam, d3-geo, hls.js, qrcode

## If the project existed before the hackathon

It didn't: everything in this repo was built during the submission window.

---

## Product feedback (required)

**Tools / SDKs used:** Fire OS 8 on a Fire TV Stick 4K Max (Android WebView, leanback launcher, MediaSession, notification-listener access, overlay windows, ADB), Alexa voice transport controls through MediaSession (`com.amazon.permission.media.session.voicecommandcontrol`), the Fire TV design guidelines, Amazon Bedrock (Nova Lite, Converse API), Amazon EC2, CloudFront, S3, Systems Manager, IAM and the AWS CLI (`aws login`). Also an Android TV / Google TV emulator to check the non-Fire TV path.

| Question | Answer |
|---|---|
| What I used them for | A Kotlin WebView shell for Fire TV that hosts the React TV app, follows Prime Video's playback through its media session to keep jams in sync, draws chat and reactions over Prime Video, pops up friend activity, follows Fire TV profiles and answers Alexa's transport commands. AWS hosts the realtime server, and Bedrock picks what a group watches next. |
| What worked well | ADB over USB plus WebView devtools on the TV made iterating on a real device fast. MediaSession gives play/pause/seek/state for other apps, which is what makes Prime Video jams possible at all. Alexa voice commands only needed a media session and one manifest permission. The Fire TV design guidelines (safe zone, 14sp text) were concrete enough to test against. Bedrock's Converse API answered in about a second with no setup beyond enabling the model. |
| What needs work | Prime Video can't be deep-linked or identified from another app (no title in its media session, position 0 during ads, seeks ignored during ads). Fire TV profiles have no public API. Following another app's playback needs notification-listener access, which Fire TV has no settings screen for. Back and media keys don't reach JavaScript in a WebView. Details in the friction log below. |
| Onboarding | About an hour from nothing to the app on the TV: enabling ADB debugging and approving the PC was easy. Discovering that the stick's clock was 162 s off, and that a hidden WebView's timers freeze, took much longer. |
| Would I build with it again | Yes. The device is capable and the debugging loop is good. A first-party way to co-watch or deep-link Prime Video would turn FireJam from a clever workaround into a product. |

**AWS:** `deploy/aws/deploy.sh` builds and ships everything; re-running it updates the server through Systems Manager with no SSH. Friction: a new account inside an AWS Organization whose policy only allows Sydney failed other-region deploys with a plain `AccessDenied` (no hint that the organization's policy was the cause); `aws login` sessions expire overnight, and `aws login` won't run from Git Bash on Windows ("expecting a Windows console"); Bedrock said the account was "being verified" for about five minutes after enabling models.

## Friction log (optional, up to +10%)

**1. Back and media keys never reach a WebView's JavaScript**
- **Task:** make a web-based TV app work with the Fire TV remote.
- **Steps:** handled `keydown` in the page; tested Back, Play/Pause, Rewind and Fast-forward on the remote.
- **Expected vs actual:** expected key events in JavaScript; Back closes the activity and the media keys never arrive.
- **Severity:** major. **Workaround:** override `dispatchKeyEvent` in the activity, forward each key with `evaluateJavascript`, and ask the page whether it handled Back before exiting.
- **Suggestion:** document the key codes a Fire OS WebView delivers, or offer an opt-in to pass Back and media keys to the page.

**2. Following another app's playback needs a permission Fire TV has no screen for**
- **Task:** keep Prime Video on several TVs in step (read and control its media session).
- **Steps:** `MediaSessionManager.getActiveSessions` needs notification-listener access; looked for it in Fire TV Settings.
- **Expected vs actual:** expected a Settings toggle like Android TV's "Notification access"; Fire TV has none, so it can only be granted with `adb shell cmd notification allow_listener`.
- **Severity:** major (a customer can't enable it). **Workaround:** adb during setup; on Android TV an in-app button opens the Settings screen.
- **Suggestion:** add Notification access (and Display over other apps) to Fire TV Settings, or a scoped "control media in other apps" permission.

**3. No way to open a specific Prime Video title from another app**
- **Task:** when a jam starts, open the same episode on every TV.
- **Steps:** tried `ACTION_VIEW` with `https://app.primevideo.com/detail?gti=…`, the Ignition activity, and the launch intent.
- **Expected vs actual:** expected the title's page; only Prime Video's home screen opens, so each person picks the episode by hand.
- **Severity:** major for co-watching. **Workaround:** open Prime Video's home and show "Play Invincible S1 · E1" on the share screen; FireJam lines everyone up once it plays.
- **Suggestion:** a documented, permissioned deep link (or a Fire TV "play title" intent) for partners.

**4. Prime Video's media session hides what's playing and fights sync during ads**
- **Task:** sync the playback position across TVs.
- **Steps:** read `PlaybackState` and `MediaMetadata` from Prime Video's session; sent `seekTo` and `pause`.
- **Expected vs actual:** expected the title and position; there's no title, the position is 0 during ads, paused shows as `STATE_STOPPED`, and seek/pause are ignored during ads.
- **Severity:** major. **Workaround:** an "ad hold" that waits out ads, a "loose" mode that links only play/pause until a real position appears, and treating STOPPED-with-a-position as paused.
- **Suggestion:** publish the title and an ad flag in the media session, and keep the content position during ads.

**5. Fire TV profiles have no public API**
- **Task:** make FireJam switch person when someone switches Fire TV profiles, with the right name.
- **Steps:** listened for `com.amazon.device.ACTION_ACTIVE_PROFILE_UPDATED`; looked for the profile list and names.
- **Expected vs actual:** the broadcast requires `com.amazon.permission.GET_PROFILE` (signature|amazon), and the list and names are unreadable.
- **Severity:** major. **Workaround:** watch the undocumented `cev_pid` secure setting (hashed before use) and ask for a name once per profile.
- **Suggestion:** a public "active profile changed" broadcast with an app-scoped profile id and display name, like the profile linking Amazon already does with some partners.

**6. Pressing Home sends "pause" to the foreground app's media session**
- **Task:** let Alexa's "pause" control a shared jam.
- **Steps:** added a MediaSession; pressed Home during a jam.
- **Expected vs actual:** expected nothing; Fire OS dispatched `onPause` (controller `android`), which paused the jam for everyone in it.
- **Severity:** major for group apps. **Workaround:** ignore transport commands whose controller is `android`, and any that arrive while the app isn't visible.
- **Suggestion:** document this, or mark system-initiated pauses so apps can tell them from a user's voice command.

**7. A hidden WebView's timers stop**
- **Task:** keep a jam's connection alive while Prime Video is in front.
- **Steps:** kept the WebView running behind a foreground service.
- **Expected vs actual:** a 1 s timer didn't fire for 60 s while hidden.
- **Severity:** major. **Workaround:** moved the background sync loop and server polling into native code.
- **Suggestion:** document background WebView throttling on Fire OS.

**8. Sideloaded apps show as a small icon on a grey tile**
- **Task:** make FireJam easy to find on the home screen.
- **Steps:** set a 320×180 `android:banner`; updated the app with a new icon and a new `versionCode`.
- **Expected vs actual:** expected the banner; the launcher draws the small launcher icon on a grey tile, and keeps showing the old icon after an update until the device restarts.
- **Severity:** minor. **Workaround:** a bright, high-contrast launcher icon, and "Move to front" in the app row.
- **Suggestion:** use `android:banner` for sideloaded apps, and refresh icons on `PACKAGE_REPLACED`.

**9. The full-screen keyboard's buttons surprise web forms**
- **Task:** type a 4-letter jam code with the remote.
- **Steps:** focused an `<input>` and pressed OK.
- **Expected vs actual:** expected a "Go/Done" action; the keyboard shows "Next", and OK types the focused letter rather than submitting.
- **Severity:** minor. **Workaround:** `enterkeyhint`, and join automatically on the fourth character.
- **Suggestion:** document how the Fire TV keyboard maps to web input events.

**10. The TV's clock can be minutes off**
- **Task:** compare timestamps (chat age, sync).
- **Expected vs actual:** the stick ran 162 s ahead of real time, which hid recent chat and broke "ago" labels.
- **Severity:** minor. **Workaround:** every screen measures its offset to the server clock, NTP-style, and uses server time throughout.

## Feature requests (optional)

- **A supported Prime Video co-watching hook** (a deep link to a title, plus reliable position and metadata in its media session). *Critical*: it's the difference between "everyone finds the episode" and a one-press watch party.
- **A public Fire TV profiles API** (active-profile broadcast, app-scoped id, display name). *Important*: social and personalised apps need to know who is watching.
- **Notification access and overlay permission screens in Fire TV Settings.** *Important*: without them, customers can't set up media-aware apps.
- **A web-app guide for Fire OS** (key codes in WebView, background throttling, keyboard behaviour). *Nice-to-have*: it would have saved days.

---

## Submission checklist

- [ ] Repo is public with `LICENSE`, **or** private and shared with testing@devpost.com and the Amazon reviewers (knmeiss, giolaq, anishamalde, mosesroth, emersonsklar). Add them when you submit; invitations expire after 7 days.
- [ ] Demo video under 3 minutes on YouTube or Vimeo, public, in English, showing FireJam **running on a Fire TV device or the Fire TV / Vega simulator**.
- [ ] Description (above), track and mini challenges selected.
- [ ] Product feedback for every tool you used.

## AWS Builder mini challenge (paste into the AWS field)

FireJam runs on AWS end to end (live at https://d12le9d1o14nhz.cloudfront.net), scripted in `deploy/aws/deploy.sh` and documented in the README ("Runs on AWS"):

- **Amazon Bedrock (Amazon Nova Lite via the Converse API)** powers **✨ Pick for us**: when a jam asks what to watch next, the server sends Bedrock everyone's city and local time, what they watched recently and the titles every member can actually watch (a Prime title only if everyone has Prime). Bedrock answers with one title and a one-line reason ("It's 11:40 pm in Hyderabad, so something short"), shown on every TV. Code: `server/src/pick.ts`.
- **Amazon EC2 (Graviton)** runs the realtime server; **Amazon CloudFront** gives every TV, phone and browser HTTPS + WebSockets worldwide (the instance only accepts CloudFront traffic); **Amazon S3** holds releases; **AWS Systems Manager** deploys them without SSH; **AWS IAM** scopes the instance to S3 reads and Bedrock calls.
- Feedback on AWS: CloudFront carried WebSockets with no extra setup using the managed CachingDisabled / AllViewer policies, which made one HTTPS address work for TVs, phones and browsers worldwide. New-account friction is in the product feedback above.
