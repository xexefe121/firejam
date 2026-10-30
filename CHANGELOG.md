# Release notes

## 0.2.0 · 30 October 2026 · First release on the Amazon Appstore

**Get it:** https://www.amazon.com/dp/B0HP7K3JT8 (on a Fire TV, search for *FireJam*). Free, in every country Amazon sells apps, on 96 Fire TV models. Package `app.firejam.tv`, version code 2.

FireJam is the living room, back: watch TV with the people you love, wherever they are, on the same frame at the same second.

### Highlights

- **See your people.** Home opens on who's watching right now, where they are, and what time it is there.
- **The Jam Map.** Everyone you love on a world map, lit up by what they're watching. Arcs join people watching together.
- **One click, same frame.** Every TV in a jam plays from one shared clock, typically within a few tens of milliseconds. Anyone can play, pause, skip or change film, and everyone sees who did it.
- **"Alexa, pause."** Pause, play, rewind 30 seconds and restart the jam for everyone with your voice.
- **Your phone is the keyboard.** Scan a QR code to chat and react from any phone, iPhone included, with no app to install.
- **Share first.** Every new jam opens on its invite: a QR code anyone can scan and a four-letter code.
- **Prime Video, together.** When everyone in the jam has Prime Video, every TV opens the title in its own Prime Video app and FireJam keeps them in step.
- **Pick for us.** Amazon Bedrock suggests what the group watches next, and picks something short when it's late for someone.
- **No forms.** FireJam signs you in from your TV and follows your Fire TV profile.

### New in this release

**Safety**
- Offensive words are hidden in chat and refused in names, including spaced-out and number-substituted spellings. Only whole words count, so real names like Akshita or Dikshit still work.
- **Report** and **Block** on every person: in a jam's new **People** sheet, on the Friends screen and on the Jam Map. You can report a specific chat message, and blocking hides that person's messages, reactions, requests and invites.
- Hosts can **Remove from jam**; the person can't rejoin that jam.
- A profile reported by three different people is suspended until it has been reviewed.
- An operator page (`/admin.html`, enabled by `FIREJAM_ADMIN_TOKEN`) lists reports and suspends, bans or restores profiles.
- The profile screen lists the people you've blocked, with **Unblock**, and FireJam's community rules.

**Platform**
- Targets Android 14 (API 34) and still runs on Fire OS 5 (API 22).
- Builds with Android Gradle Plugin 8.2.2, Gradle 8.2.1, Kotlin 1.9.22 and JDK 17.
- Release builds are signed with FireJam's own key (`-PfirejamSigning=<keystore.properties>`); without it they stay debug-signed for sideloading.
- Asks for notification permission on Android 13 and later before posting friend alerts.

**Store and brand**
- Prime Video appears as plain text in FireJam's own style, only to say what works with what; the blue badge and play-triangle are gone, including on the QR join page.
- The app and the store listing say that Prime Video, Fire TV and Alexa are trademarks of Amazon.com, Inc. or its affiliates, and that FireJam was not created or endorsed by Amazon.
- The [privacy policy](PRIVACY.md) covers reports, blocks and the community rules.

### Known limitations

- Following Prime Video's playback and drawing pop-ups over other apps need access that Fire TV only grants over adb. On a store install, a Prime Video jam opens Prime Video but can't keep it in step, and friend pop-ups show while FireJam is open.
- Amazon doesn't offer FireJam on three newer Fire TV Stick models (Fire TV Stick 4K Select, Fire TV Stick HD 2nd generation and one Fire TV Stick 4K variant); the developer console lists them as unsupported for Android apps like this one.

## Hackathon build · 23 October 2026

Submitted to the [Amazon Developer Hackathon 2026](https://amazonappdev2026.devpost.com/), Fire TV track, as a sideloadable APK and a live server on AWS. It introduced everything in the highlights above. It also included:
- the Windows bridge that brings a laptop's Prime Video into a jam;
- the Android TV / Google TV build;
- following Fire TV profile switches;
- private sign-in with a per-profile secret token.
