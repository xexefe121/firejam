import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CameraKey, Callout, SplitSegment } from '../types';
import { MediaClip, resolveVolume } from '../media';
import {
  LAPTOP_BEZEL,
  LaptopFrame,
  TV_BEZEL,
  TvFrame,
  laptopOuterHeight,
  laptopOuterWidth,
  tvOuterHeight,
  tvOuterWidth,
} from '../devices';
import { C, FONT_DISPLAY, GRAD } from '../theme';
import { Backdrop, CameraView, Headline, cameraAt, clamp, easeInOut, easeOut, useEnter } from '../ui';

// The pair fills about 92% of the frame width: a 48px gap between them, 81px at each side.
// Same screen size on both devices; both stand on one baseline, above the subtitle lane.
const SCREEN_W = 836;
const SCREEN_H = 470;
const GAP = 48;

const tvW = tvOuterWidth(SCREEN_W);
const lapW = laptopOuterWidth(SCREEN_W);
const SIDE = Math.round((1920 - tvW - GAP - lapW) / 2);
const TV_LEFT = SIDE;
const LAPTOP_LEFT = SIDE + tvW + GAP;
const TV_CX = TV_LEFT + tvW / 2;
const LAPTOP_CX = LAPTOP_LEFT + lapW / 2;
const BASELINE = 776;

const tvTop = BASELINE - tvOuterHeight(SCREEN_H);
const lapTop = BASELINE - laptopOuterHeight(SCREEN_H);
const midY = (tvTop + TV_BEZEL + 1 + (lapTop + LAPTOP_BEZEL + 1) + SCREEN_H) / 2; // middle of the two pictures

const PILL_Y = 884; // vertical centre of a callout pill (it ends near y 915, the subtitles start near 938)
const STEM_FROM = BASELINE + 24;
const BRACKET_Y = 832;

// Where each capture sits in the frame, for camera keyframes that aim "on" a device.
const SCREEN_RECT = {
  left: { x: TV_LEFT + TV_BEZEL + 1, y: tvTop + TV_BEZEL + 1 },
  right: { x: LAPTOP_LEFT + LAPTOP_BEZEL + 1, y: lapTop + LAPTOP_BEZEL + 1 },
};

/** Camera keys for the whole pair: x/y are 0-1 of the frame, or of one capture when `on` is set. */
const toFrameKeys = (keys: CameraKey[] | undefined): CameraKey[] | undefined =>
  keys?.map((k) => {
    if (!k.on) return k;
    const r = SCREEN_RECT[k.on];
    return {
      at: k.at,
      scale: k.scale,
      x: (r.x + (k.x ?? 0.5) * SCREEN_W) / 1920,
      y: (r.y + (k.y ?? 0.5) * SCREEN_H) / 1080,
    };
  });

const DeviceLabel: React.FC<{ text?: string; cx: number; top: number; progress: number }> = ({ text, cx, top, progress }) =>
  text ? (
    <div
      style={{
        position: 'absolute',
        left: cx - 380,
        width: 760,
        top,
        textAlign: 'center',
        fontFamily: FONT_DISPLAY,
        fontWeight: 500,
        fontSize: 21,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: C.muted,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 8}px)`,
      }}
    >
      {text}
    </div>
  ) : null;

/** A hairline between the two pictures with a pulse travelling along it. */
const SyncLink: React.FC<{ x1: number; x2: number; y: number }> = ({ x1, x2, y }) => {
  const frame = useCurrentFrame();
  const p = useEnter(18, 30);
  const w = x2 - x1;
  const phase = (frame % 72) / 72;
  const phase2 = ((frame + 36) % 72) / 72;
  return (
    <div style={{ position: 'absolute', left: x1, top: y - 6, width: w, height: 12, opacity: p }}>
      <div
        style={{
          position: 'absolute',
          top: 5,
          left: 0,
          width: '100%',
          height: 2,
          borderRadius: 2,
          background:
            'linear-gradient(90deg, rgba(255,181,71,0) 0%, rgba(255,106,31,0.7) 30%, rgba(255,61,110,0.7) 70%, rgba(193,60,255,0) 100%)',
        }}
      />
      {[phase, phase2].map((v, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 1,
            left: v * (w - 10),
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#fff',
            opacity: Math.sin(Math.PI * v) * 0.9,
            boxShadow: '0 0 16px 3px rgba(255,140,80,0.75)',
          }}
        />
      ))}
    </div>
  );
};

type Anchor = { x: number; path: string };

const bracketFor = (target: Callout['target']): Anchor => {
  if (target === 'left') return { x: TV_CX, path: `M${TV_CX} ${STEM_FROM}V${PILL_Y - 40}` };
  if (target === 'right') return { x: LAPTOP_CX, path: `M${LAPTOP_CX} ${STEM_FROM}V${PILL_Y - 40}` };
  // both: down from each device, across, then one stem to the pill
  return {
    x: 960,
    path:
      `M${TV_CX} ${STEM_FROM}V${BRACKET_Y - 12}Q${TV_CX} ${BRACKET_Y} ${TV_CX + 12} ${BRACKET_Y}` +
      `H${LAPTOP_CX - 12}Q${LAPTOP_CX} ${BRACKET_Y} ${LAPTOP_CX} ${BRACKET_Y - 12}V${STEM_FROM}` +
      `M960 ${BRACKET_Y}V${PILL_Y - 40}`,
  };
};

/** One callout at a time: a thin connector draws in, then a small pill. The last one stays. */
const Callouts: React.FC<{ callouts: Callout[] }> = ({ callouts }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <>
      {callouts.map((c, i) => {
        const start = Math.round(c.at * fps);
        const next = i + 1 < callouts.length ? Math.round(callouts[i + 1].at * fps) : null;
        if (frame < start || (next !== null && frame > next)) return null;
        const out = next === null ? 1 : interpolate(frame, [next - 12, next - 3], [1, 0], clamp);
        const draw = easeOut(interpolate(frame, [start, start + 20], [0, 1], clamp));
        const pillP = easeOut(interpolate(frame, [start + 8, start + 26], [0, 1], clamp));
        const a = bracketFor(c.target);
        return (
          <React.Fragment key={i}>
            <svg
              width={1920}
              height={1080}
              viewBox="0 0 1920 1080"
              style={{ position: 'absolute', left: 0, top: 0, opacity: out }}
            >
              <defs>
                <linearGradient id={`cl${i}`} gradientUnits="userSpaceOnUse" x1={TV_CX} y1="0" x2={LAPTOP_CX} y2="0">
                  <stop offset="0" stopColor="#ffb547" stopOpacity="0.9" />
                  <stop offset="0.5" stopColor="#ff6a1f" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#ff3d6e" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <path
                d={a.path}
                fill="none"
                stroke={`url(#cl${i})`}
                strokeWidth={1.5}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - draw}
              />
              {(c.target === 'left' || c.target === 'right' ? [a.x] : [TV_CX, LAPTOP_CX]).map((x) => (
                <circle key={x} cx={x} cy={STEM_FROM} r={3.5} fill="#fff" opacity={draw > 0.02 ? 0.95 : 0} />
              ))}
            </svg>
            <div
              style={{
                position: 'absolute',
                left: a.x - 480,
                width: 960,
                top: PILL_Y - 31,
                display: 'flex',
                justifyContent: 'center',
                opacity: pillP * out,
                transform: `translateY(${(1 - pillP) * 14 + (1 - out) * 6}px)`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '15px 32px 16px 26px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.16)',
                  boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 500,
                  fontSize: 28,
                  letterSpacing: '-0.015em',
                  color: C.text,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: GRAD }} />
                {c.text}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

export const SplitScene: React.FC<{ segment: SplitSegment }> = ({ segment }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const frames = Math.max(1, Math.round(segment.dur * fps));
  const enter = useEnter(0, 36);
  const labelIn = useEnter(14, 28);
  const prog = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: easeInOut });

  const leftVol = resolveVolume(segment.left.src, segment.left.audio?.volume, segment.audio?.volume);
  const rightVol = resolveVolume(segment.right.src, segment.right.audio?.volume);

  // The segment's camera moves the whole pair (no keys: it stays put). While it is zoomed in, the copy steps aside.
  const cam = cameraAt(toFrameKeys(segment.camera), frame, fps, frames, 1);
  const zoomTx = 960 - cam.x * 1920 * cam.scale;
  const zoomTy = 540 - cam.y * 1080 * cam.scale;
  const copyOpacity = 1 - interpolate(cam.scale, [1.06, 1.35], [0, 1], clamp);

  // the pair rises in, then drifts up and pushes in a touch, all together so the baseline never moves
  const groupStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    opacity: Math.min(1, enter * 2.2),
    transformOrigin: '50% 60%',
    transform: `translateY(${(1 - enter) * 26 - prog * 10}px) scale(${(0.97 + enter * 0.03) * (1 + 0.02 * prog)})`,
  };

  return (
    <AbsoluteFill>
      <Backdrop drift={prog} />
      <div style={{ opacity: copyOpacity }}>
        <Headline text={segment.title ?? 'Two screens, one playhead'} frames={frames} fontSize={40} centerY={118} />
      </div>

      {/* Both videos live in the same sequence, so they start on the same frame. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          transform: cam.scale > 1.0001 ? `translate(${zoomTx}px, ${zoomTy}px) scale(${cam.scale})` : undefined,
        }}
      >
        <div style={groupStyle}>
          <div style={{ position: 'absolute', left: TV_LEFT, top: tvTop }}>
            <TvFrame screenW={SCREEN_W} screenH={SCREEN_H}>
              <CameraView keys={segment.left.camera} frames={frames} width={SCREEN_W} height={SCREEN_H} push={1.04}>
                <MediaClip src={segment.left.src} from={segment.left.in} volume={leftVol} variant="screen" />
              </CameraView>
            </TvFrame>
          </div>
          <div style={{ position: 'absolute', left: LAPTOP_LEFT, top: lapTop }}>
            <LaptopFrame screenW={SCREEN_W} screenH={SCREEN_H}>
              <CameraView keys={segment.right.camera} frames={frames} width={SCREEN_W} height={SCREEN_H} push={1.04}>
                <MediaClip src={segment.right.src} from={segment.right.in} volume={rightVol} variant="screen" />
              </CameraView>
            </LaptopFrame>
          </div>
          <SyncLink x1={TV_LEFT + tvW + 8} x2={LAPTOP_LEFT - 8} y={midY} />
          <div style={{ opacity: copyOpacity }}>
            <DeviceLabel text={segment.left.label} cx={TV_CX} top={tvTop - 44} progress={labelIn} />
            <DeviceLabel text={segment.right.label} cx={LAPTOP_CX} top={tvTop - 44} progress={labelIn} />
          </div>
        </div>
      </div>

      <div style={{ opacity: copyOpacity }}>
        <Callouts callouts={segment.callouts} />
      </div>
    </AbsoluteFill>
  );
};
