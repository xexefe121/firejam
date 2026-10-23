# Open Source mini challenge

The rules ask for a new, additional open-source project (or a contribution to an existing public repo) alongside the main submission. Ours is **tv-spatial-nav**, FireJam's D-pad navigation pulled out into a standalone library that any TV web app can use.

- **Contribution URL:** https://github.com/xexefe121/tv-spatial-nav *(publish it first: see below)*
- **Project repository URL:** https://github.com/xexefe121/firejam
- **GitHub username:** xexefe121

## What I did

Extracted FireJam's focus engine into a dependency-free ES module with type definitions, tests (Node's built-in runner, 10 tests) and an example page. It moves focus with a remote's D-pad by on-screen geometry, so TV layouts need no hand-wired "next/previous" maps:

- groups (a side rail and a stage) that Up/Down stay inside, with an entry point when Left/Right crosses between them;
- traps for dialogs and player controls;
- `data-nav-rect` for elements whose label is much wider than their target (map pins);
- a scoring rule that keeps rows and columns together, and doesn't let a wide bar above a row (a video scrubber) steal the next button along it;
- `keyOf()` for the remote buttons Fire TV / Android TV WebViews and Samsung browsers report only as key codes.

## How it works

Each move scores every focusable element whose centre lies beyond the current element's edge in that direction: `max(distance along, 0) + 4 × gap across + 0.15 × misalignment`. The scoring is a pure function (`score`, `pick`), so layouts can be tested without a browser; `createNavigator()` wires it to the DOM.

## Why it matters

Every web-based TV app (Fire TV WebView shells, Android TV, Samsung/LG browsers) has to solve D-pad focus, and most hand-wire it per screen. The rules here came from testing on a real Fire TV Stick, including bugs a hand-wired map never shows (the scrubber stealing focus, Down from a text field landing in the wrong column), and they're written down and tested so others don't have to rediscover them.

## Publishing it

The library is ready in `H:\firejam-oss\tv-spatial-nav` (committed locally). To publish it as a public repo:

```bash
cd /h/firejam-oss/tv-spatial-nav && gh repo create xexefe121/tv-spatial-nav --public --source . --remote origin --description "D-pad focus navigation for TV web apps (Fire TV, Android TV, smart-TV browsers)" --push
```
