import React, { useMemo } from 'react';
import { Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionItem } from './types';
import { FONT_DISPLAY } from './theme';
import { clamp } from './ui';

const PAGE_MS = 1500; // a page holds about this much speech
const SOFT_MS = 1000; // after this much, a comma or colon is a good place to turn the page
const MAX_WORDS = 9;
const MAX_CHARS = 84; // two lines at 40px in 1320px
const TAIL_MS = 350; // keep the last words up a moment after they are spoken

const SENTENCE_END = /[.!?…]["'”’)]*$/;
const SOFT_END = /[,;:–—]["'”’)]*$/;

type Token = { text: string; fromMs: number; toMs: number };
type Page = { startMs: number; endMs: number; tokens: Token[] };

/**
 * Groups word-level captions into pages of about 1.5 s. Pages always end at a sentence end, prefer a comma when
 * they have to end early, and run a little long rather than leave a one- or two-word page behind.
 */
export const paginate = (captions: CaptionItem[], offsetMs: number): Page[] => {
  const words = captions
    .map((c) => ({ text: c.text, fromMs: c.startMs + offsetMs, toMs: c.endMs + offsetMs }))
    .filter((w) => w.toMs > 0 && w.text.trim().length > 0)
    .sort((a, b) => a.fromMs - b.fromMs);

  const endsSentence = (w: Token) => SENTENCE_END.test(w.text.trim());
  const pages: Page[] = [];
  let cur: Token[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    pages.push({ startMs: Math.max(0, cur[0].fromMs), endMs: cur[cur.length - 1].toMs, tokens: cur });
    cur = [];
  };

  words.forEach((w, i) => {
    if (cur.length > 0) {
      const last = cur[cur.length - 1];
      const dur = w.fromMs - cur[0].fromMs;
      const chars = cur.reduce((n, t) => n + t.text.length, 0) + w.text.trim().length;
      const full = dur >= PAGE_MS || cur.length >= MAX_WORDS || chars > MAX_CHARS;
      // a sentence that ends within the next two words is worth waiting for
      const endsSoon = words.slice(i, i + 2).some(endsSentence);
      const canStretch = dur < PAGE_MS + 800 && cur.length < MAX_WORDS + 2 && chars < MAX_CHARS + 18;
      const softBreak = dur >= SOFT_MS && SOFT_END.test(last.text.trim());
      const longGap = w.fromMs - last.toMs > 900;
      if (longGap || softBreak || (full && !(endsSoon && canStretch))) flush();
    }
    cur.push(w);
    if (endsSentence(w)) flush();
  });
  flush();
  return pages;
};

// All words sit at 86% white; the word being spoken is full white. That is the only highlight.
const PageView: React.FC<{ page: Page }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = page.startMs + (frame / fps) * 1000;
  const o = interpolate(frame, [0, 5], [0, 1], clamp);
  return (
    <div
      style={{
        opacity: o,
        transform: `translateY(${(1 - o) * 6}px)`,
        fontFamily: FONT_DISPLAY,
        fontWeight: 500,
        fontSize: 44,
        lineHeight: 1.28,
        letterSpacing: '-0.015em',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        maxWidth: 1320,
        textShadow: '0 2px 22px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.6)',
        // two balanced lines; a long word moves down whole instead of splitting
        textWrap: 'balance',
        overflowWrap: 'break-word',
        hyphens: 'manual',
      }}
    >
      {page.tokens.map((t, i) => {
        const active = t.fromMs <= nowMs && t.toMs > nowMs;
        const text = i === 0 ? t.text.trimStart() : t.text;
        // keep words separated even when the transcript has no leading spaces
        const spaced = i > 0 && !/^\s/.test(text) ? ` ${text}` : text;
        return (
          <span key={i} style={{ color: active ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.86)' }}>
            {spaced}
          </span>
        );
      })}
    </div>
  );
};

/** Bottom-centre subtitles from the voiceover transcript: quiet white type, two lines at most. */
export const Captions: React.FC<{
  captions: CaptionItem[];
  offsetMs: number;
  /** Frame ranges [from, to) where subtitles stay hidden. */
  quiet?: [number, number][];
}> = ({ captions, offsetMs, quiet = [] }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const hidden = quiet.some(([a, b]) => frame >= a && frame < b);
  const pages = useMemo(() => paginate(captions, offsetMs), [captions, offsetMs]);
  if (pages.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        right: 96,
        bottom: 80,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity: hidden ? 0 : 1,
      }}
    >
      {pages.map((page, i) => {
        const next = pages[i + 1];
        const startFrame = Math.round((page.startMs / 1000) * fps);
        const endMs = Math.min(next ? next.startMs : Infinity, page.endMs + TAIL_MS);
        const endFrame = Math.round((endMs / 1000) * fps);
        const dur = endFrame - startFrame;
        if (dur <= 0) return null;
        return (
          <Sequence key={i} from={startFrame} durationInFrames={dur} layout="none">
            <PageView page={page} />
          </Sequence>
        );
      })}
    </div>
  );
};
