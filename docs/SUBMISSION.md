# Devpost submission notes

Drafts for the Devpost form, ready to paste. "What we learned" is a first draft in my voice; edit it to taste.

**Track:** Fire TV. Fits the priority categories *family entertainment* and *multi-modal UX* (TV + phone + D-pad).
**Mini challenges:** **AWS Builder** (hosted on AWS, plus Amazon Bedrock "Pick for us"; details below). **Open Source** needs a separate open-source project or contribution besides this repo: see `docs/OPEN_SOURCE.md`.

## Tagline

The living room is dead. Ela brought it back. FireJam puts her in Sydney and her Ma in Hyderabad on the same film, at the same second, on Fire TV.

## Inspiration

When Ela was small, Sunday night meant one thing. Ma, Ela, the sofa, one blanket, one TV. Nobody remembers what they watched. Everybody remembers watching it together.

Then they grew up and moved apart. Ma is in Hyderabad. Ela is in Sydney. Same shows, nine thousand kilometres apart, texting "did you see that?" into the dark.

We have more screens than ever: a TV in every room, a phone in every hand. And we don't share moments anymore. We share links. "Have you seen it yet?" "No spoilers." "I'll watch it later."

The living room is dead.

FireJam is Ela's idea for bringing it back.

## What it does

Ela turns on her Fire TV. Before she has picked anything, it tells her: *Ma is watching Sintel. It's 8:42 pm in Hyderabad. Pull up a chair.*

One click and she's on the sofa. Same film, same second. Ma pauses, and Ela's TV pauses too and says who did it. Ma types "Have you eaten yet?" on her phone, and it pops up on Ela's TV, over the film.

That's FireJam: Spotify Jam for the biggest screen in the house.

- **See your people.** Home opens on who's watching right now, where they are, and what time it is there.
- **The Jam Map.** Everyone you love, lit up by what they're watching. A world map of friends and public jams, with arcs between people watching together. Move pin to pin with the D-pad, then join, add a friend or invite. Ghost mode hides you.
- **One click, same frame.** Every screen in a jam plays from one shared clock, typically within a few tens of milliseconds. Anyone can play, pause, skip or switch film, and everyone sees who did it.
- **"Alexa, pause."** Pauses the jam for everyone. Play, rewind 30 seconds and restart work too.
- **Your phone is the keyboard.** Scan a QR code; there's no app to install. Chat and reactions from an iPhone or Android phone pop up on every TV in the jam, even over Prime Video.
- **Prime Video, together.** If everyone in the jam has Prime, every TV opens the title in its own Prime Video app and FireJam keeps them in step. The Watch screen leads with 19 Prime titles: Fallout, Reacher, The Family Man, Mirzapur, Panchayat. No Prime, no entry; the server enforces it.
- **Share first.** A new jam opens on its invite: a QR code anyone can scan and a four-letter code. It waits until the host presses Start.
- **A tap on the shoulder.** When a friend presses play, your Fire TV says so over whatever is on: "🔥 Ma is watching Sintel." One press takes you into their jam, even with FireJam closed.
- **It knows who's on the sofa.** No forms. FireJam follows Fire TV profiles: switch profile and FireJam switches with you. An id alone signs nobody in; a profile needs its secret token or a TV it trusts.
- **"Pick for us."** Amazon Bedrock picks what the group watches next, and it knows everyone's bedtime: when it's late for Ma, it picks something short and says why.
- **Everyone's invited.** Fire TV first. The same app runs on Android TV and Google TV, a Windows bridge brings a laptop's Prime Video into the jam, and any other smart TV joins in its browser.

## How we built it

- **TV app:** React + TypeScript (Vite) built for the 10-foot UI. A custom spatial-navigation layer moves focus by on-screen geometry, so every screen works with a D-pad without hand-wired focus maps. Layout scales from the Fire TV WebView's 960×540 CSS pixels up to 4K.
- **Fire OS app:** a small Kotlin app with a full-screen WebView and a launcher banner. It forwards the remote's Back and media keys (WebViews don't pass them to JavaScript), answers Alexa through a MediaSession, follows Prime Video's media session, follows the active Fire TV profile, and draws chat and pop-ups over other apps.
- **Realtime server:** Node + Socket.IO. Presence, friend graph, jams, join requests and invites, rate-limited reactions and chat.
- **Sync engine:** the server stores each jam as (playing, position, updatedAt) on its own clock. Each screen estimates its clock offset NTP-style, computes the expected playhead, and corrects drift by nudging the playback rate (±10%, inaudible) or, for big jumps, seeking ahead by the device's measured seek latency.
- **On AWS:** the server runs on an EC2 Graviton (t4g.micro) instance in Sydney behind CloudFront, which carries HTTPS and WebSockets worldwide. Releases go through S3 and deploys through Systems Manager, with no SSH. Amazon Bedrock (Nova Lite, Converse API) powers "Pick for us".
- **Map:** d3-geo Natural Earth projection over world-atlas data, rendered as SVG with focusable HTML pins on top.
- **Content:** Blender Foundation open movies (CC-BY) streamed by FireJam itself, plus Prime Video titles that play in each viewer's own Prime Video app.

## Challenges we ran into

- **Remote input in a WebView.** Back and media keys never reach JavaScript, so the native app forwards them and asks the web app whether it handled Back before exiting.
- **Spatial navigation that feels right.** Early versions jumped from a card row into the side rail, or skipped rows. The fix was preferring the current group, requiring a candidate's centre to lie past the current element's edge, and scoring same-row neighbours far above diagonal ones.
- **Performance on a streaming stick.** Profiling the real device showed the TV burning 58% of a CPU core on an idle Home screen: progress bars animated their width (a page layout every frame) and decorative loops kept it redrawing at 60 fps. Fixing those took idle CPU to 8% on Home and 19% on the Jam Map (from 128%).
- **Fire TV profiles without an API.** The profile-switch broadcast is reserved for Amazon's apps, so FireJam follows the active profile id in secure settings instead, hashed before it leaves the TV.
- **Sync on slow hardware.** "Seek when off by more than X" loops forever on a Fire TV Stick, because each seek lands late. Measuring seek latency and aiming ahead, plus rate nudging for small drift, fixed it.

## Accomplishments that we're proud of

- A pause on one screen pauses every TV in the jam, with a banner saying who did it, and the corner reads *In sync · 18 ms*.
- The whole app works with nothing but a Fire TV remote, or your voice.
- It runs on a real Fire TV Stick 4K Max, not just a simulator, and idles at 8% CPU on Home.

## What we learned

- A TV is not a big phone. Endless CSS animations that look free on a laptop cost half a CPU core on a stick, and text that looked fine on a monitor was below Amazon's 28 px minimum from the sofa.
- Sync is about time, not video. The hard parts were a TV clock 162 s off, seeks that land late, Prime Video reporting position 0 during ads, and timers that freeze in the background.
- Fire TV gives apps a lot: media sessions, Alexa transport controls, overlays. But the two things a social app needs most, Prime Video deep links and Fire TV profiles, are reserved for Amazon's own apps. Finding the edges of what's allowed was half the work.

## What's next for FireJam

- "Alexa, start a jam with Ma." Start, join and invite by voice through Alexa+.
- Push-to-talk from the phone, ducking the film while someone speaks.
- Deep links into the apps people already watch in, instead of a catalogue.
- Login with Amazon, contact-based friend discovery, and moderation before public jams go beyond a demo.

---

They told us the living room was dead. We never stopped loving the same things. We just stopped feeling them together.

FireJam is the living room, back. Pull up a chair, Ma.

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
