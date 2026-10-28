# Amazon Appstore listing (Fire TV)

Everything the Amazon Developer Console asks for, ready to paste. Images are in `docs/store/`.

## App file

- **APK:** `android/app/build/outputs/apk/release/app-release.apk`. Build from `android/` in PowerShell with JDK 17 and Android SDK platform 34 / build-tools 34.0.0:

  ```powershell
  $env:JAVA_HOME = 'H:/firejam-tools/jdk-17'
  .\gradlew.bat assembleRelease -PfirejamSigning=H:/firejam-tools/signing/keystore.properties
  ```

  Set `sdk.dir=H:\\firejam-tools\\android-sdk` in `android/local.properties`. The wrapper uses Gradle 8.2.1 with AGP 8.2.2 and Kotlin 1.9.22. If lint dependencies cannot resolve, append `-x lintVitalRelease`.
  The release key and its passwords live outside the repo (`H:\firejam-tools\signing`). Back them up: updates must be signed with the same key.
- **Package:** `app.firejam.tv`, version 0.2.0 (code 2), min API 22 (Fire OS 5), compile/target API 34.
- **Devices:** Fire TV only (Fire TV Stick, Stick 4K / 4K Max, Fire TV Cube, Fire TV smart TVs). Not tablets or phones: the interface is built for a TV and a remote.
- **Uses:** internet; draw over other apps (chat and reactions on top of other apps); foreground service (keeps a jam alive while another app is in front); Alexa voice transport controls; notification access (optional, follows other apps' playback).

## Availability and pricing

Free. All countries. No in-app purchases, no ads.

## Listing

**Title:** FireJam

**Category:** Entertainment

**Short description**

The living room is back. Watch TV with the people you love, wherever they are: the same film, at the same second, with their messages and reactions on your screen. See who's watching right now, join in one click, and say "Alexa, pause" for everyone.

**Long description**

When Ela was small, Sunday night meant one thing. Ma, Ela, the sofa, one blanket, one TV. Nobody remembers what they watched. Everybody remembers watching it together.

Then they grew up and moved apart. Ma is in Hyderabad. Ela is in Sydney. Same shows, nine thousand kilometres apart, texting "did you see that?" into the dark.

FireJam brings the living room back.

Turn on your Fire TV and FireJam tells you who's watching right now, where they are, and what time it is there. One click and you're in: the same film, at the same second. Anyone can pause, and everyone sees who did. Your phone becomes the keyboard, so messages and reactions pop up on every TV in the jam.

• See your people: friends and family, what they're watching and their local time.
• The Jam Map: everyone you love on a world map, lit up by what they're watching.
• One click, same frame: every TV in a jam plays from one shared clock.
• "Alexa, pause": pause, play, rewind and restart the jam for everyone with your voice.
• Your phone is the keyboard: scan a QR code to chat and react, with no app to install.
• Share first: every new jam opens on its invite, a QR code and a four-letter code.
• A tap on the shoulder: a pop-up when a friend starts watching.
• Pick for us: when nobody can decide, FireJam suggests a film, and something short if it's late for someone.
• No forms: FireJam signs you in from your TV and follows your Fire TV profile.

FireJam comes with free open movies from the Blender Foundation, so you can start a jam straight away.

Safe by design: FireJam hides offensive words in names and chat, and you can report or block anyone from your remote. Hosts can remove people from their jam, and reported profiles are reviewed and can be suspended.

FireJam is open source: https://github.com/xexefe121/firejam

This app was not created or endorsed by Amazon. Fire TV, Prime Video and Alexa are trademarks of Amazon.com, Inc. or its affiliates.

**Feature bullets**

- Watch together across cities and countries, on the same frame
- See what friends and family are watching, and their local time
- Chat and react from your phone, shown on every TV in the jam
- "Alexa, pause" pauses the jam for everyone
- No sign-up forms: your Fire TV signs you in

**Keywords:** watch party, watch together, co-watching, movie night, family, long distance, friends, chat, reactions, sync

## Images (`docs/store/`)

| Field | File |
| --- | --- |
| Small icon (114×114) | `icon-114.png` |
| Large icon (512×512) | `icon-512.png` |
| Fire TV icon (1280×720) | `firetv-icon-1280x720.png` |
| Fire TV background (1920×1080) | `background-1920x1080.png` |
| Screenshots (1920×1080) | `screenshot-1-…` to `screenshot-6-…` |

## Content rating

The films are the Blender Foundation's open movies. Answers submitted on 24 October 2026:

- **Violence:** moderate realistic violence (fear, tension, distress; Tears of Steel) and moderate cartoon or fantasy violence (Sintel, Big Buck Bunny). Drugs, nudity, sex, intolerance, profanity: none. Educational: no.
- **User-generated content and communication:** yes. People in a jam can send text messages and emoji reactions to each other. Offensive words are filtered, and people can report, block and (hosts) remove others.
- **Account or profile creation:** yes. A name and a city (from the TV's time zone).
- **Location sharing:** yes, coarse. Friends see your city and local time; no GPS or precise location.
- **Personal information collected:** a display name; see the privacy policy.
- **Advertising, in-app purchases, gambling:** no.

## Privacy policy

https://github.com/xexefe121/firejam/blob/main/PRIVACY.md

## Customer support

Email: unityweb9@gmail.com
Website: https://d12le9d1o14nhz.cloudfront.net

## Testing notes for Amazon's reviewers

FireJam works with nothing but the Fire TV remote. On first launch, enter a name to create a profile (no password). Home shows demo friends who are always watching something; press **Join** on any of them to enter their jam, or open **Watch**, pick a film and press **Start**. Scan the invite QR with a phone to chat and react. "Alexa, pause" pauses the jam.

Moderation, as asked for in the 26 October 2026 review: names and chat pass through a server-side word filter (try sending a swear word from the phone; it arrives masked). Each person in a jam, on the Friends screen and on the Jam Map has Report and Block; a host also has Remove from jam. Reports go to an operator page (`/admin.html`) where profiles can be suspended or banned, and a profile reported by three different people is suspended automatically until it is reviewed.

Trademarks, as asked for in the same review: FireJam refers to Prime Video, Fire TV and Alexa in plain text only to describe compatibility, uses none of Amazon's logos or badges, and says in the app and in this description that it was not created or endorsed by Amazon.

Two optional extras need access that Fire TV only grants over adb: following Prime Video's playback (notification access) and drawing pop-ups over other apps (display over other apps). Without them, a Prime Video jam opens Prime Video but cannot keep it in step, and friend pop-ups show only while FireJam is open. Everything else works without them.
