import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CameraKey } from './types';
import { SupersampleContext } from './media';
import { C, FONT_DISPLAY, GRAD } from './theme';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.sin);

/** Soft 0..1 spring that starts after `delay` frames. No bounce. */
export const useEnter = (delay = 0, durationInFrames = 26) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame, fps, delay, durationInFrames, config: { damping: 200 } });
};

/** 1 until `endFrame - len`, then falls to 0 at `endFrame`. */
export const fadeOut = (frame: number, endFrame: number, len = 10) =>
  interpolate(frame, [endFrame - len, endFrame], [1, 0], clamp);

// ---------------------------------------------------------------------------------------------
// Time: scenes see local frames, but the background glow keeps drifting across cuts.
// ---------------------------------------------------------------------------------------------

export const TimeOffsetContext = createContext(0);
export const useGlobalFrame = () => useCurrentFrame() + useContext(TimeOffsetContext);

// 256px tile of fine noise. It dithers the dark gradients so they do not band after H.264 encoding.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='256' height='256' filter='url(%23n)'/></svg>\")";

/**
 * Deep dark backdrop with a very slow, very faint glow in the brand colours.
 * `drift` (-1..1) nudges the glow against the foreground so the layers separate (parallax).
 */
export const Backdrop: React.FC<{ intensity?: number; drift?: number }> = ({ intensity = 1, drift = 0 }) => {
  const g = useGlobalFrame();
  const t = g / 30;
  const ax = 16 + Math.sin(t * 0.33) * 8 - drift * 5;
  const ay = 20 + Math.cos(t * 0.27) * 7;
  const bx = 84 + Math.cos(t * 0.29) * 7 + drift * 5;
  const by = 88 + Math.sin(t * 0.31) * 6;
  const cx = 52 + Math.sin(t * 0.21 + 1.3) * 10;
  const cy = 108 + Math.cos(t * 0.23) * 4;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(52% 52% at ${ax}% ${ay}%, rgba(255,106,31,${0.12 * intensity}) 0%, rgba(255,106,31,0) 72%)`,
          `radial-gradient(48% 54% at ${bx}% ${by}%, rgba(177,75,255,${0.115 * intensity}) 0%, rgba(177,75,255,0) 72%)`,
          `radial-gradient(40% 34% at ${cx}% ${cy}%, rgba(255,61,110,${0.08 * intensity}) 0%, rgba(255,61,110,0) 74%)`,
          'radial-gradient(ellipse 90% 80% at 50% 46%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)',
          `linear-gradient(180deg, ${C.bg2} 0%, ${C.bg} 100%)`,
        ].join(','),
      }}
    >
      <AbsoluteFill style={{ backgroundImage: GRAIN, backgroundSize: '256px 256px', opacity: 0.035 }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

/**
 * Words rise in one after another: short rise, opacity and a touch of blur.
 * `out` (0..1) fades the whole line for its exit. `gradient` paints the brand gradient across the line.
 */
export const WordReveal: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  rise?: number;
  gradient?: boolean;
  out?: number;
  style?: React.CSSProperties;
}> = ({ text, delay = 0, stagger = 3, rise = 22, gradient = false, out = 1, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  const n = words.length;
  return (
    <div style={{ textWrap: 'balance', ...style }}>
      {words.map((w, i) => {
        const p = spring({ frame, fps, delay: delay + i * stagger, durationInFrames: 22, config: { damping: 200 } });
        const blur = (1 - p) * 9 + (1 - out) * 5;
        const inner = gradient ? (
          <span
            style={{
              display: 'inline-block',
              backgroundImage: GRAD,
              backgroundSize: `${n * 100}% 100%`,
              backgroundPosition: `${n > 1 ? (i / (n - 1)) * 100 : 0}% 0`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              paddingBottom: '0.14em',
              marginBottom: '-0.14em',
            }}
          >
            {w}
          </span>
        ) : (
          w
        );
        return (
          <React.Fragment key={i}>
            <span
              style={{
                display: 'inline-block',
                opacity: p * out,
                transform: `translateY(${(1 - p) * rise - (1 - out) * 8}px)`,
                filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
              }}
            >
              {inner}
            </span>
            {i < n - 1 ? ' ' : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** The single line of copy centred above a shot, with an optional small eyebrow. */
export const Headline: React.FC<{
  text?: string;
  eyebrow?: string;
  /** Length of the host segment in frames, so the line leaves before the cut. */
  frames: number;
  delay?: number;
  centerY?: number;
  fontSize?: number;
}> = ({ text, eyebrow, frames, delay = 8, centerY = 146, fontSize = 52 }) => {
  const frame = useCurrentFrame();
  const out = fadeOut(frame, frames - 4, 12);
  const eyeP = useEnter(delay - 2, 26);
  if (!text && !eyebrow) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        right: 96,
        top: centerY - 78,
        height: 156,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        textAlign: 'center',
      }}
    >
      {eyebrow ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: FONT_DISPLAY,
            fontWeight: 500,
            fontSize: 21,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: C.muted,
            opacity: eyeP * out,
            transform: `translateY(${(1 - eyeP) * 10}px)`,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.ok, boxShadow: `0 0 14px ${C.ok}` }} />
          {eyebrow}
        </div>
      ) : null}
      {text ? (
        <WordReveal
          text={text}
          delay={delay}
          stagger={2}
          out={out}
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize,
            lineHeight: 1.08,
            letterSpacing: '-0.035em',
            color: C.text,
            maxWidth: 1500,
          }}
        />
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Camera: zoom and pan inside a capture
// ---------------------------------------------------------------------------------------------

export type CameraState = { scale: number; x: number; y: number };

const fillKeys = (keys: CameraKey[], frames: number, fps: number): Array<Required<Omit<CameraKey, 'on'>>> => {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const out: Array<Required<Omit<CameraKey, 'on'>>> = [];
  let prev = { scale: 1, x: 0.5, y: 0.5 };
  if (sorted.length === 0 || sorted[0].at > 0) out.push({ at: 0, ...prev });
  for (const k of sorted) {
    const cur = { at: Math.max(0, k.at), scale: k.scale ?? prev.scale, x: k.x ?? prev.x, y: k.y ?? prev.y };
    prev = cur;
    out.push(cur);
  }
  // interpolate() needs strictly rising inputs, and at least two of them
  for (let i = 1; i < out.length; i++) if (out[i].at <= out[i - 1].at) out[i].at = out[i - 1].at + 0.001;
  const last = out[out.length - 1];
  if (out.length < 2 || last.at < frames / fps) out.push({ ...last, at: Math.max(last.at + 0.001, frames / fps) });
  return out;
};

/** Camera at `frame`. No keyframes means a slow push-in from 1.0 to `push` over the segment. */
export const cameraAt = (
  keys: CameraKey[] | undefined,
  frame: number,
  fps: number,
  frames: number,
  push = 1.06,
): CameraState => {
  const k = fillKeys(
    keys && keys.length > 0
      ? keys
      : [
          { at: 0, scale: 1, x: 0.5, y: 0.5 },
          { at: frames / fps, scale: push, x: 0.5, y: 0.5 },
        ],
    frames,
    fps,
  );
  const at = k.map((p) => p.at * fps);
  const opts = { ...clamp, easing: easeInOut };
  const scale = interpolate(frame, at, k.map((p) => p.scale), opts);
  const x = interpolate(frame, at, k.map((p) => p.x), opts);
  const y = interpolate(frame, at, k.map((p) => p.y), opts);
  // never show beyond the edge of the capture
  const half = 0.5 / Math.max(1, scale);
  return {
    scale,
    x: Math.min(1 - half, Math.max(half, x)),
    y: Math.min(1 - half, Math.max(half, y)),
  };
};

/**
 * Fills its parent (position: relative/absolute) and moves the camera across `children`.
 * The content is laid out at `supersample` times its size and scaled back down, so a zoom stays sharp.
 */
export const CameraView: React.FC<{
  keys?: CameraKey[];
  frames: number;
  width: number;
  height: number;
  push?: number;
  supersample?: number;
  children: React.ReactNode;
}> = ({ keys, frames, width, height, push, supersample = 2, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = cameraAt(keys, frame, fps, frames, push);
  const tx = width / 2 - cam.x * width * cam.scale;
  const ty = height / 2 - cam.y * height * cam.scale;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: width * supersample,
          height: height * supersample,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${cam.scale / supersample})`,
        }}
      >
        <SupersampleContext.Provider value={supersample}>{children}</SupersampleContext.Provider>
      </div>
    </div>
  );
};

/** Straight quotes and apostrophes to typographic ones, for text that comes from JSON. */
export const smartQuotes = (s: string) =>
  s
    .replace(/(^|[\s(\[{])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/'/g, '’');

// ---------------------------------------------------------------------------------------------
// A capture floating on the backdrop
// ---------------------------------------------------------------------------------------------

/**
 * A rounded screen with a faint inner border and a long soft shadow. It rises in, then pushes in very
 * slowly for the whole shot and drifts up a little (the backdrop moves the other way).
 */
export const FloatingScreen: React.FC<{
  cx: number;
  cy: number;
  width: number;
  height: number;
  radius?: number;
  frames: number;
  /** Total slow scale-up of the whole screen over the shot. */
  float?: number;
  children: React.ReactNode;
}> = ({ cx, cy, width, height, radius = 26, frames, float = 0.03, children }) => {
  const frame = useCurrentFrame();
  const enter = useEnter(0, 34);
  const prog = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: easeInOut });
  const scale = (0.965 + enter * 0.035) * (1 + float * prog);
  const y = (1 - enter) * 26 - prog * 12;
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - width / 2,
        top: cy - height / 2,
        width,
        height,
        opacity: Math.min(1, enter * 2.2),
        transform: `translateY(${y}px) scale(${scale})`,
      }}
    >
      {/* soft brand glow behind the glass */}
      <div
        style={{
          position: 'absolute',
          inset: -120,
          background:
            'radial-gradient(45% 45% at 22% 40%, rgba(255,106,31,0.10) 0%, rgba(255,106,31,0) 100%), radial-gradient(45% 45% at 80% 62%, rgba(177,75,255,0.10) 0%, rgba(177,75,255,0) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          overflow: 'hidden',
          background: '#000',
          boxShadow:
            '0 2px 6px rgba(0,0,0,0.5), 0 36px 70px -14px rgba(0,0,0,0.75), 0 110px 170px -40px rgba(0,0,0,0.8)',
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.11)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0) 16%)',
        }}
      />
    </div>
  );
};

export const BrandIcon: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile('brand/icon-512.png')} style={{ width: size, height: size, display: 'block', ...style }} />
);
