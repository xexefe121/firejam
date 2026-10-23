# FireJam demo (under 3 minutes)

Judges may stop at 3:00, so the story and the sync moment come first. The rules require the video to show FireJam running on a real Fire TV (or the Fire TV / Vega simulator).

## Setup before recording

- Laptop runs `npm run build && npm start`. Optional: `npm run media:fetch -w server` first so seeking is instant on the LAN.
- **Fire TV** has the APK installed, pointed at the laptop. Create a fresh profile on it (e.g. your own name, city Sydney).
- **Laptop browser** opens `http://<laptop-ip>:3000/?as=ammu`, full screen. This is "Mum in Hyderabad". (Ma is a demo profile; on the laptop she's driven by a real person, so her bot goes quiet.)
- **Phone** is on the same Wi-Fi with the camera ready.
- Film the TV with a phone or capture card, and screen-record the laptop. Cut between them, side by side for the sync moment.
- Use no music you don't have rights to. The films are CC-BY; keep the credit card from the Watch screen in shot once, or put it in the end card.

## Script

**0:00–0:20 · The hook** (over a slow shot of an empty couch, or the onboarding screen)
> "When I was a kid, TV was the thing my family did together. Now my mum's in India and I'm in Sydney, and TV became single-player. FireJam makes it multiplayer again."

**0:20–0:45 · Home and the Jam Map** (Fire TV)
- Home hero: *"Ma is watching Sintel. It's 8:42 pm in Hyderabad."* Pause on it.
- Press Left, then down to **Jam Map**. D-pad across pins: Leo in London, the public Bunny Marathon in São Paulo with arcs to Berlin, Mumbai and Mexico City.
> "Like Snap Map, but for what people are watching. Friends, plus anyone in a public jam."

**0:45–1:30 · Join Mum, same frame** (the money shot)
- Focus Ma's pin, press OK, **Join Ma**.
- Split screen: Fire TV and the laptop land on the same frame. Point at the corner chips: *Ma · Hyderabad · 8:42 pm*, *You · Sydney · 1:42 am*, **In sync · 18 ms**.
- On the laptop (Ma) press pause. The TV pauses, with the banner **"Ma paused ⏸"**. Press ⏯ on the Fire TV remote to resume both.
- Press Right on the remote to skip 10 s. Both jump together.
> "Everyone can drive, like Spotify Jam, and everyone sees who did it."

**1:30–2:05 · Phone as the remote**
- In the player press Down, then **Invite**. Show the QR code and the friends list.
- Scan with the phone. Tap ❤️ and 😂; they float up on both screens. Type "Miss you Ma ❤️" on the phone; it pops up on the TV.
> "Nobody wants to type with a TV remote. Your phone's the keyboard, no app install."

**2:05–2:30 · Bring someone else in**
- Back in the Invite sheet, invite **Leo**. A toast: *"Leo joined from London"*. Three cities, one film.
- Optional: on the laptop, Friends tab shows the friend request and accept flow.

**Optional, if you have time · Prime Video jam (≈20 s)**
- On the Fire TV, open Leo's **Reacher Night**. Show the "You both have Prime Video" line, then FireJam opening Prime Video and the 🔥 bubble telling you to press play.
- Press pause on the Fire TV remote inside Prime Video: the laptop (in the same jam) shows "paused" for everyone.
- Keep Prime Video footage on screen as briefly as you can, or blur it; the rules ask for no copyrighted footage without permission. The FireJam bubbles and the browser view tell the story without the show itself.

**2:30–2:55 · How it's built, and what's next** (over the architecture diagram from the README)
> "It's a React TV app with its own D-pad navigation, in a Fire OS WebView shell that forwards the remote's Back and media keys. A Node and Socket.IO server keeps one playhead per jam; each screen syncs its clock to the server and corrects drift by nudging playback speed, so nobody sees a jump. Next: syncing the apps people already watch in, and 'Alexa, start a jam with Mum.'"

**2:55–3:00 · End card**
> "FireJam. The living room is back."

## If something goes wrong live

- **"Can't reach FireJam" on the TV:** hold **Menu** and type the laptop's address, or check both are on the same Wi-Fi.
- **The laptop shows "Press OK to start watching":** the browser blocked autoplay; press any key.
- **A seek leaves one screen buffering:** the sync pill says *Catching up* and closes the gap within a few seconds. Mirroring the films locally (`media:fetch`) removes most of this.
