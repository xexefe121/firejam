import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { sleep, origin, work } from './util.mjs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { io } = require('../../node_modules/socket.io-client');

export async function client(identity) {
  const socket = io(origin, { transports: ['websocket'], reconnection: false });
  const state = { socket, world: null, me: null, toasts: [] };
  socket.on('session', s => { state.world = s.world; state.me = s.me; state.catalog = s.catalog; });
  socket.on('world', world => state.world = world);
  socket.on('me', me => state.me = me);
  socket.on('toast', t => state.toasts.push({ time: Date.now(), ...t }));
  state.ack = (event, ...args) => new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, ...args, (err, result) => err ? reject(err) : result?.ok ? resolve(result.data) : reject(new Error(`${event}: ${result?.error}`)));
  });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  await state.ack('hello', identity ?? {});
  return state;
}
export async function setupWeb() {
  const controller = await client();
  const profile = await controller.ack('profile:create', { name: 'Dhanu', placeId: 'sydney', services: ['prime'] });
  const ma = await client({ userId: 'ammu' });
  const maJam = () => ma.world.jams.find(j => j.hostId === 'ammu');
  ma.socket.emit('jam:control', { kind: 'seek', position: 180 });
  ma.socket.emit('jam:control', { kind: 'play' });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const contexts = [];
  async function pageFor(name, url, phone = false) {
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, timezoneId: phone ? 'Australia/Sydney' : name === 'laptop' ? 'Asia/Kolkata' : 'Australia/Sydney' });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // A playing film keeps range requests open, so networkidle never settles on player pages.
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    page.captureErrors = errors;
    return page;
  }
  const tv = await pageFor('tv', `${origin}/?as=${profile.userId}&t=${profile.token}`);
  await tv.locator('.hero h1').filter({ hasText: 'Ma is watching' }).waitFor();
  // Let Maya's real starter friend-request toast clear before the hero take.
  await sleep(16000);
  return {
    browser, controller, profile, ma, maJam, tv, pageFor,
    async close() { controller.socket.close(); ma.socket.close(); await browser.close(); },
  };
}
export async function key(page, name, wait = 160) { await page.keyboard.press(name); if (wait) await sleep(wait); }
export async function dpadFocus(page, selector, press = key) {
  const target = page.locator(selector);
  await target.waitFor({ state: 'visible' });
  if (await target.evaluate(el => el === document.activeElement)) return;
  // Search the real geometric focus graph using only D-pad events. No direct
  // focus() jumps appear in a take, and routes adapt to the current pin layout.
  const route = await page.evaluate(selector => {
    const target = document.querySelector(selector);
    const traps = document.querySelectorAll('[data-trap]');
    const root = traps.length ? traps[traps.length - 1] : document.body;
    const els = [...root.querySelectorAll('[data-focus]:not([disabled])')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; });
    const rect = el => (el.querySelector('[data-nav-rect]') ?? el).getBoundingClientRect();
    const gap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
    function nearest(cur, direction, candidates) {
      const r = rect(cur); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      let best = null, score = Infinity;
      for (const el of candidates) {
        if (el === cur || el.contains(cur) || cur.contains(el)) continue;
        const e = rect(el), ex = e.left + e.width / 2, ey = e.top + e.height / 2;
        let primary, secondary;
        if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
          if (direction === 'ArrowRight' ? ex <= r.right - 1 : ex >= r.left + 1) continue;
          primary = direction === 'ArrowRight' ? e.left - r.right : r.left - e.right;
          secondary = gap(r.top, r.bottom, e.top, e.bottom);
        } else {
          if (direction === 'ArrowDown' ? ey <= r.bottom - 1 : ey >= r.top + 1) continue;
          primary = direction === 'ArrowDown' ? e.top - r.bottom : r.top - e.bottom;
          secondary = gap(r.left, r.right, e.left, e.right);
        }
        const align = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(ey - cy) : r.width > e.width * 1.8 ? Math.abs(e.left - r.left) : Math.abs(ex - cx);
        const s = Math.max(0, primary) + secondary * 4 + align * 0.15;
        if (s < score) { score = s; best = el; }
      }
      return best;
    }
    const queue = [[document.activeElement, []]], seen = new Set();
    while (queue.length) {
      const [cur, keys] = queue.shift();
      if (cur === target) return keys;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const group = cur.closest('[data-group]');
      for (const direction of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        let next = nearest(cur, direction, group ? els.filter(el => group.contains(el)) : els);
        if (!next && (direction === 'ArrowLeft' || direction === 'ArrowRight')) {
          next = nearest(cur, direction, els);
          const into = next?.closest('[data-group]');
          if (into && into !== group) next = into.querySelector('[data-group-entry]') ?? next;
        }
        if (next && !seen.has(next)) queue.push([next, [...keys, direction]]);
      }
    }
    return null;
  }, selector);
  if (route) for (const k of route) await press(page, k, 100);
  if (!await target.evaluate(el => el === document.activeElement)) throw new Error(`D-pad could not reach ${selector}`);
}
export const pin = name => `.pin:has(.pin-label:text-is("${name}"))`;
// CSS selectors used inside evaluate cannot contain Playwright text extensions.
export async function pinSelector(page, name) {
  return page.locator('.pin').evaluateAll((els, name) => {
    const i = els.findIndex(el => el.querySelector('.pin-label')?.firstChild?.textContent?.trim() === name);
    if (i < 0) throw new Error(`No pin ${name}`);
    return `.pin:nth-of-type(${i + 1})`;
  }, name);
}
export async function toMap(page) {
  if (await page.locator('.map-screen').count()) return;
  if (await page.locator('.player').count()) await key(page, 'Escape');
  await dpadFocus(page, '.rail-item:nth-of-type(2)');
  await key(page, 'Enter');
  await page.locator('.map-screen').waitFor();
  await sleep(350);
}
export async function joinMa(page) {
  if (await page.locator('.player video').count()) return;
  await toMap(page);
  await dpadFocus(page, await pinSelector(page, 'Ma'));
  await key(page, 'Enter');
  await page.getByRole('button', { name: 'Join Ma', exact: true }).waitFor();
  await key(page, 'Enter');
  await page.locator('video').waitFor();
}
export async function waitFilm(page) {
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && !v.paused && !v.seeking; }, null, { timeout: 60000 });
  await page.locator('.sync-pill.synced').waitFor({ state: 'attached', timeout: 25000 });
}
export async function inviteSheet(page) {
  if (await page.locator('.invite-sheet').count()) return;
  if (!await page.locator('.controls').count()) await key(page, 'ArrowDown');
  const selector = await page.getByRole('button', { name: 'Invite', exact: true }).evaluate(el => { el.dataset.captureTarget = 'invite'; return '[data-capture-target="invite"]'; });
  await dpadFocus(page, selector);
  await key(page, 'Enter');
  await page.locator('.invite-sheet img').waitFor();
}
export async function diagnostics(page, name) {
  await page.screenshot({ path: path.join(work, `${name}.png`) });
  return { title: await page.title(), url: (await page.url()).replace(/([?&]t=)[^&]+/, '$1[redacted]'), errors: page.captureErrors, text: (await page.locator('body').innerText()).slice(0, 350) };
}
