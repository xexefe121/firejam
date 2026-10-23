import { useEffect, useRef } from 'react';

// D-pad navigation for a 10-foot UI.
//
// Anything with `data-focus` can take focus. Arrow keys move to the nearest
// focusable element in that direction by on-screen geometry, so layouts need
// no hand-wired neighbours. A `data-trap` container (dialogs, the player
// overlay) confines movement to itself; the most recently mounted trap wins.
// A `data-group` container (the side rail, the main stage) is preferred: focus
// only leaves it when nothing inside lies in that direction, so Down from a
// row of cards finds the next row instead of the rail beside it.

export type Key = 'up' | 'down' | 'left' | 'right' | 'enter' | 'back' | 'playpause' | 'rewind' | 'ffwd' | 'menu';
type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = '[data-focus]:not([disabled])';

export function keyOf(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': return 'enter';
    case 'Escape': case 'GoBack': case 'BrowserBack': return 'back';
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': return 'playpause';
    case 'MediaRewind': case 'MediaTrackPrevious': return 'rewind';
    case 'MediaFastForward': case 'MediaTrackNext': return 'ffwd';
    case 'ContextMenu': return 'menu';
  }
  // Fire TV web views report some remote buttons only by keyCode.
  switch (e.keyCode) {
    case 4: case 8: return 'back';
    case 179: case 85: case 415: case 19: return 'playpause';
    case 227: case 412: case 89: return 'rewind';
    case 228: case 417: case 90: return 'ffwd';
    case 82: return 'menu';
  }
  return null;
}

export function scopeRoot(): HTMLElement {
  const traps = document.querySelectorAll<HTMLElement>('[data-trap]');
  return traps.length ? traps[traps.length - 1] : document.body;
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusables(root: HTMLElement = scopeRoot()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

export function focusEl(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

export function focusFirst(root: HTMLElement = scopeRoot()) {
  const auto = root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
  focusEl(auto && visible(auto) ? auto : focusables(root)[0]);
}

/** Geometry used for navigation: a child marked `data-nav-rect` (e.g. a map pin's avatar) or the element itself. */
function rectOf(el: HTMLElement): DOMRect {
  return (el.querySelector<HTMLElement>('[data-nav-rect]') ?? el).getBoundingClientRect();
}

/** Distance between two 1-D ranges; 0 when they overlap. */
function gap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
}

/** Pick the closest element in a direction, strongly preferring ones in the same row/column. */
export function move(dir: Dir): boolean {
  const root = scopeRoot();
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || !cur.matches(FOCUSABLE)) {
    focusFirst(root);
    return true;
  }
  const group = cur.closest('[data-group]');
  const all = focusables(root);
  const inGroup = group ? all.filter((el) => group.contains(el)) : all;
  let best = nearest(cur, dir, inGroup);
  // Only sideways moves may cross into another group (content <-> rail).
  if (!best && (dir === 'left' || dir === 'right')) {
    best = nearest(cur, dir, all);
    const into = best?.closest<HTMLElement>('[data-group]');
    if (best && into && into !== group) best = entryOf(into, all) ?? best;
  }
  if (best) focusEl(best);
  return !!best;
}

// Entering a group lands where a TV viewer expects: the rail on the current screen's item,
// the content back on whatever was focused there before.
const lastInGroup = new WeakMap<Element, HTMLElement>();
document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  const group = el.closest?.('[data-group]');
  if (group) lastInGroup.set(group, el);
});

function entryOf(group: HTMLElement, all: HTMLElement[]): HTMLElement | null {
  const marked = group.querySelector<HTMLElement>('[data-group-entry]');
  if (marked && all.includes(marked)) return marked;
  const last = lastInGroup.get(group);
  return last && last.isConnected && all.includes(last) ? last : null;
}

function nearest(cur: HTMLElement, dir: Dir, els: HTMLElement[]): HTMLElement | null {
  const r = rectOf(cur);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of els) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const e = rectOf(el);
    const ex = e.left + e.width / 2;
    const ey = e.top + e.height / 2;
    let primary: number;
    let secondary: number;
    if (dir === 'left' || dir === 'right') {
      // The candidate's centre must lie past our edge, not just past our centre.
      if (dir === 'right' ? ex <= r.right - 1 : ex >= r.left + 1) continue;
      primary = dir === 'right' ? e.left - r.right : r.left - e.right;
      secondary = gap(r.top, r.bottom, e.top, e.bottom);
    } else {
      if (dir === 'down' ? ey <= r.bottom - 1 : ey >= r.top + 1) continue;
      primary = dir === 'down' ? e.top - r.bottom : r.top - e.bottom;
      secondary = gap(r.left, r.right, e.left, e.right);
    }
    // Leaving something much wider than its targets (a text field over a grid), line up
    // left edges so Down lands on the first column, as on every TV keyboard.
    const align =
      dir === 'left' || dir === 'right'
        ? Math.abs(ey - cy)
        : r.width > e.width * 1.8
          ? Math.abs(e.left - r.left)
          : Math.abs(ex - cx);
    // Overlapping candidates count as distance 0, not less: otherwise a wide bar just above a row
    // (the player's scrubber) beat the next button along it.
    const score = Math.max(primary, 0) + secondary * 4 + align * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// ---------- key handlers ----------
// Screens and overlays register handlers; the newest one sees each key first.
// Returning true consumes the key.

type Handler = (key: Key, e: KeyboardEvent) => boolean | void;
const handlers: Handler[] = [];

export function useKeys(handler: Handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const h: Handler = (k, e) => ref.current(k, e);
    handlers.push(h);
    return () => {
      handlers.splice(handlers.indexOf(h), 1);
    };
  }, [active]);
}

/** Called for Back. Returns whether something in the app handled it (else the TV wrapper exits). */
function dispatch(key: Key, e: KeyboardEvent): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i](key, e)) return true;
  if (key === 'up' || key === 'down' || key === 'left' || key === 'right') return move(key);
  return false;
}

const fake = (key: string) => new KeyboardEvent('keydown', { key });

export function installKeys() {
  window.addEventListener(
    'keydown',
    (e) => {
      const key = keyOf(e);
      if (!key) return;
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
      // Let text fields keep their caret keys and Backspace.
      if (typing && (key === 'left' || key === 'right' || e.key === 'Backspace')) return;
      // Enter falls through to the focused button's native click unless a handler claims it.
      if (dispatch(key, e)) e.preventDefault();
    },
    true,
  );

  // Hooks for the Fire TV wrapper (android/): Back and media keys come in from native code.
  const w = window as unknown as Record<string, unknown>;
  w.firejamBack = () => dispatch('back', fake('Escape'));
  w.firejamKey = (name: Key) => dispatch(name, fake(name));

  // Keep something focused so the very first D-pad press does something visible.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) focusFirst();
    }, 50);
  });
}

/**
 * Focus the screen's `data-autofocus` element (or first focusable) when it mounts.
 * Retries for a few frames because screens often render before their data arrives.
 */
export function useAutoFocus(ref: React.RefObject<HTMLElement>, deps: unknown[] = []) {
  useEffect(() => {
    let tries = 0;
    let id = 0;
    const attempt = () => {
      const root = ref.current;
      if (root && focusables(root).length && scopeRoot() === document.body) return focusFirst(root);
      if (++tries < 40) id = window.setTimeout(attempt, 50);
    };
    id = window.setTimeout(attempt, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
