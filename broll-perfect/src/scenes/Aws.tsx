import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AwsFocus, AwsNodeKey, AwsSegment, AwsStep } from '../types';
import { C, FONT_BODY, FONT_DISPLAY, GRAD, gradientText } from '../theme';
import { Backdrop, WordReveal, clamp, easeInOut, easeOut, fadeOut, smartQuotes, useEnter } from '../ui';

// Default walkthrough, used when the segment has no `steps`.
export const DEFAULT_AWS_STEPS: AwsStep[] = [
  {
    at: 0,
    focus: 'tv',
    title: 'Native Fire TV app',
    lines: [
      'Kotlin shell, React UI built for the D-pad',
      "Follows Prime Video through Android's media session",
      'Handles Alexa voice commands',
    ],
  },
  {
    at: 10.5,
    focus: 'server',
    title: 'One shared clock',
    lines: ['Node + Socket.IO on AWS Graviton (EC2 t4g)', 'Every jam synced, served worldwide via CloudFront'],
  },
  {
    at: 19.5,
    focus: 'ai',
    title: "Amazon Bedrock picks what's next",
    lines: ["Amazon Nova Lite knows everyone's local time", '"It\'s 11:40 pm in Hyderabad, so something short"'],
  },
];

// Which nodes a focus lights up. `server` lights CloudFront and EC2 together.
const FOCUS_NODES: Record<AwsFocus, AwsNodeKey[]> = {
  tv: ['tv'],
  edge: ['edge'],
  server: ['edge', 'server'],
  ai: ['ai'],
};

// ---------- layout (1920x1080 canvas) ----------
// Sized to read on a phone: names 38px, sub lines 24px, a panel title of 64px and lines of 34px.
// The diagram sits in the upper ~55% (y 236 to 614); the panel is centred in the space below it.
const MAIN_H = 200;
const MAIN_Y = 325;
const MID_Y = MAIN_Y + MAIN_H / 2; // 425
const PANEL_TOP = 681;
const CAMERA_MAX = 1.045; // the slow push toward the focused node never goes past this
const CAMERA_BIAS = 0.5; // how far the zoom point leans toward the focused node, which keeps its side inside the margin
const STEP_FADE = 16; // frames a focus change takes

type NodeSpec = {
  key: AwsNodeKey;
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  accent: string;
  accent2: string;
  icon: React.ReactNode;
  name: string;
  sub: string;
};

const stroke = { fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ICON = 26;

const IconTv = (
  <svg viewBox="0 0 24 24" width={ICON} height={ICON}>
    <rect x="3" y="4" width="18" height="12" rx="2" {...stroke} />
    <path d="M8 20h8M12 16v4" {...stroke} />
  </svg>
);
const IconDevices = (
  <svg viewBox="0 0 24 24" width={ICON} height={ICON}>
    <rect x="3" y="5" width="13" height="9" rx="1.6" {...stroke} />
    <path d="M1.5 17.5h16" {...stroke} />
    <rect x="15.5" y="9" width="6" height="10" rx="1.6" {...stroke} />
  </svg>
);
const IconGlobe = (
  <svg viewBox="0 0 24 24" width={ICON} height={ICON}>
    <circle cx="12" cy="12" r="9" {...stroke} />
    <ellipse cx="12" cy="12" rx="4" ry="9" {...stroke} />
    <path d="M3 12h18" {...stroke} />
  </svg>
);
const IconChip = (
  <svg viewBox="0 0 24 24" width={ICON} height={ICON}>
    <rect x="7" y="7" width="10" height="10" rx="1.6" {...stroke} />
    <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" {...stroke} />
  </svg>
);
const IconSpark = (
  <svg viewBox="0 0 24 24" width={ICON} height={ICON}>
    <path d="M12 2.5l2.2 7.3 7.3 2.2-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2z" {...stroke} />
  </svg>
);

const NODES: NodeSpec[] = [
  { key: 'tv', x: 113, y: 236, w: 392, h: 180, delay: 4, accent: '#ffb547', accent2: '#ff6a1f', icon: IconTv, name: 'Fire TV app', sub: 'Kotlin shell + React UI' },
  { key: 'web', x: 113, y: 434, w: 392, h: 180, delay: 10, accent: '#ffb547', accent2: '#ff6a1f', icon: IconDevices, name: 'Phones and laptops', sub: 'Browser, nothing to install' },
  { key: 'edge', x: 581, y: MAIN_Y, w: 392, h: MAIN_H, delay: 20, accent: '#ff6a1f', accent2: '#ff3d6e', icon: IconGlobe, name: 'Amazon CloudFront', sub: 'HTTPS + WebSockets' },
  { key: 'server', x: 1049, y: MAIN_Y, w: 330, h: MAIN_H, delay: 30, accent: '#ff3d6e', accent2: '#c13cff', icon: IconChip, name: 'Amazon EC2', sub: 'Graviton t4g.micro' },
  { key: 'ai', x: 1455, y: MAIN_Y, w: 352, h: MAIN_H, delay: 40, accent: '#c13cff', accent2: '#7a5cff', icon: IconSpark, name: 'Amazon Bedrock', sub: 'Amazon Nova Lite' },
];

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** How strongly each node is in focus right now (0..1), and whether any focus is active at all. */
const useFocus = (steps: AwsStep[]) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let idx = -1;
  steps.forEach((s, i) => {
    if (s.at * fps <= frame) idx = i;
  });
  const cur = new Set<AwsNodeKey>(idx >= 0 ? FOCUS_NODES[steps[idx].focus] : []);
  const prev = new Set<AwsNodeKey>(idx > 0 ? FOCUS_NODES[steps[idx - 1].focus] : []);
  const t = idx >= 0 ? easeInOut(clamp01((frame - steps[idx].at * fps) / STEP_FADE)) : 0;
  const weight = (k: AwsNodeKey) => (prev.has(k) ? 1 - t : 0) + (cur.has(k) ? t : 0);
  // before the first step nothing is dimmed; afterwards everything but the focus is
  const act = idx >= 0 ? (idx > 0 ? 1 : t) : 0;
  return { weight: (k: AwsNodeKey) => Math.min(1, weight(k)), act, idx, t };
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const NodeCard: React.FC<{
  n: NodeSpec;
  w: number;
  act: number;
  name: string;
  sub: string;
}> = ({ n, w, act, name, sub }) => {
  const frame = useCurrentFrame();
  const p = useEnter(n.delay, 28);
  const dim = 1 - 0.55 * act * (1 - w);
  const bob = Math.sin(frame / 46 + n.x) * 3 * w; // a focused node floats a little, so a long hold stays alive
  const breathe = 0.5 + 0.5 * Math.sin(frame / 30 + n.x);
  return (
    <div
      style={{
        position: 'absolute',
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        boxSizing: 'border-box',
        padding: '20px 24px',
        borderRadius: 28,
        background: `linear-gradient(160deg, ${C.card2} 0%, ${C.card} 100%)`,
        border: `1.5px solid ${w > 0.01 ? hexA(n.accent, 0.18 + 0.5 * w) : 'rgba(255,255,255,0.09)'}`,
        boxShadow: [
          '0 30px 80px rgba(0,0,0,0.45)',
          `0 0 ${50 + 70 * w}px ${hexA(n.accent, 0.1 + w * (0.22 + 0.08 * breathe))}`,
          'inset 0 1px 0 rgba(255,255,255,0.08)',
        ].join(', '),
        opacity: p * dim,
        transform: `translateY(${(1 - p) * 24 + bob}px) scale(${(0.965 + p * 0.035) * (1 + 0.03 * w)})`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 15,
          background: `linear-gradient(135deg, ${n.accent} 0%, ${n.accent2} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
          flexShrink: 0,
          boxShadow: `0 10px 28px ${hexA(n.accent, 0.33)}`,
        }}
      >
        {n.icon}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 38,
          letterSpacing: '-0.03em',
          color: C.text,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 24, lineHeight: 1.3, letterSpacing: '-0.005em', color: C.muted }}>
        {sub}
      </div>
    </div>
  );
};

// ---------- connectors ----------
type Pt = [number, number];
type Conn = {
  a: AwsNodeKey;
  b: AwsNodeKey;
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
  drawFrom: number;
  drawTo: number;
  twoWay: boolean;
};

const straight = (a: Pt, b: Pt): Pick<Conn, 'p0' | 'p1' | 'p2' | 'p3'> => ({
  p0: a,
  p1: [a[0] + (b[0] - a[0]) / 3, a[1]],
  p2: [a[0] + ((b[0] - a[0]) * 2) / 3, b[1]],
  p3: b,
});

const CONNS: Conn[] = [
  { a: 'tv', b: 'edge', p0: [505, 326], p1: [543, 326], p2: [543, 395], p3: [581, 395], drawFrom: 14, drawTo: 34, twoWay: true },
  { a: 'web', b: 'edge', p0: [505, 524], p1: [543, 524], p2: [543, 455], p3: [581, 455], drawFrom: 18, drawTo: 38, twoWay: true },
  { a: 'edge', b: 'server', ...straight([973, MID_Y], [1049, MID_Y]), drawFrom: 28, drawTo: 46, twoWay: true },
  { a: 'server', b: 'ai', ...straight([1379, MID_Y], [1455, MID_Y]), drawFrom: 40, drawTo: 58, twoWay: false },
];

const bez = (c: Conn, t: number): Pt => {
  const u = 1 - t;
  const f = (a: number, b: number, cc: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * cc + t * t * t * d;
  return [f(c.p0[0], c.p1[0], c.p2[0], c.p3[0]), f(c.p0[1], c.p1[1], c.p2[1], c.p3[1])];
};

const Head: React.FC<{ at: Pt; dir: 1 | -1; opacity: number }> = ({ at, dir, opacity }) => (
  <path
    d={`M${at[0] - dir * 12} ${at[1] - 8}L${at[0]} ${at[1]}L${at[0] - dir * 12} ${at[1] + 8}`}
    fill="none"
    stroke="url(#awsLine)"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    opacity={opacity}
  />
);

const Connectors: React.FC<{ weight: (k: AwsNodeKey) => number; act: number }> = ({ weight, act }) => {
  const frame = useCurrentFrame();
  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <defs>
        <linearGradient id="awsLine" gradientUnits="userSpaceOnUse" x1="96" y1="0" x2="1824" y2="0">
          <stop offset="0" stopColor="#ffb547" />
          <stop offset="0.4" stopColor="#ff6a1f" />
          <stop offset="0.72" stopColor="#ff3d6e" />
          <stop offset="1" stopColor="#c13cff" />
        </linearGradient>
      </defs>
      {CONNS.map((c, i) => {
        const p = easeOut(interpolate(frame, [c.drawFrom, c.drawTo], [0, 1], clamp));
        const heads = interpolate(p, [0.88, 1], [0, 1], clamp);
        const hot = Math.max(weight(c.a), weight(c.b));
        const level = 1 - 0.65 * act * (1 - hot); // a link that touches the focus stays bright
        const d = `M${c.p0[0]} ${c.p0[1]}C${c.p1[0]} ${c.p1[1]} ${c.p2[0]} ${c.p2[1]} ${c.p3[0]} ${c.p3[1]}`;
        // Pulses keep travelling for the whole segment: one forward, one back on two-way links.
        const live = frame >= c.drawTo;
        const period = 66;
        const tf = ((((frame - c.drawTo) % period) + period) % period) / period;
        const tb = 1 - (((frame - c.drawTo + period / 2) % period) + period) % period / period;
        const dots: Array<{ t: number; k: number }> = [{ t: tf, k: tf }];
        if (c.twoWay) dots.push({ t: tb, k: 1 - tb });
        return (
          <g key={i} opacity={level}>
            <path d={d} fill="none" stroke="url(#awsLine)" strokeOpacity={0.16} strokeWidth={10} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
            <path d={d} fill="none" stroke="url(#awsLine)" strokeWidth={3} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
            <Head at={c.p3} dir={1} opacity={heads} />
            {c.twoWay ? <Head at={c.p0} dir={-1} opacity={heads} /> : null}
            {live
              ? dots.map((dt, j) => {
                  const [x, y] = bez(c, dt.t);
                  return (
                    <circle
                      key={j}
                      cx={x}
                      cy={y}
                      r={5.5}
                      fill="#fff"
                      opacity={Math.sin(Math.PI * dt.k) * 0.95}
                      style={{ filter: 'drop-shadow(0 0 8px rgba(255,150,90,0.95))' }}
                    />
                  );
                })
              : null}
          </g>
        );
      })}
    </svg>
  );
};

// ---------- detail panel ----------
const Line: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const p = useEnter(delay, 24);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
        filter: p < 0.99 ? `blur(${(1 - p) * 6}px)` : undefined,
      }}
    >
      {smartQuotes(text)}
    </div>
  );
};

/** One step's title and lines. It lives in its own Sequence, so its clock starts at the step. */
const StepPanel: React.FC<{ step: AwsStep; accent: string; holdFrames: number; last: boolean; lead: number }> = ({
  step,
  accent,
  holdFrames,
  last,
  lead,
}) => {
  const frame = useCurrentFrame();
  // leaves a few frames before the next step's title starts to rise
  const out = last ? 1 : fadeOut(frame, holdFrames + 8, 12);
  const bar = useEnter(lead, 26);
  const lines = (step.lines ?? []).slice(0, 3);
  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        right: 96,
        top: PANEL_TOP,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        opacity: out,
        transform: `translateY(${(1 - out) * 6}px)`,
      }}
    >
      <div
        style={{
          width: 64 * bar,
          height: 3,
          borderRadius: 3,
          background: `linear-gradient(90deg, ${accent}, #ff3d6e)`,
          marginBottom: 22,
          boxShadow: `0 0 18px ${hexA(accent, 0.6)}`,
        }}
      />
      {step.title ? (
        <WordReveal
          text={smartQuotes(step.title)}
          delay={lead}
          stagger={2}
          rise={20}
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 64,
            lineHeight: 1.06,
            letterSpacing: '-0.04em',
            color: C.text,
            maxWidth: 1728,
          }}
        />
      ) : null}
      <div
        style={{
          marginTop: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontFamily: FONT_BODY,
          fontWeight: 400,
          fontSize: 34,
          lineHeight: 1.3,
          letterSpacing: '-0.012em',
          color: C.soft,
          maxWidth: 1728,
        }}
      >
        {lines.map((l, i) => (
          <Line key={i} text={l} delay={lead + 10 + i * 7} />
        ))}
      </div>
    </div>
  );
};

export const AwsScene: React.FC<{ segment: AwsSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const steps = [...(segment.steps && segment.steps.length > 0 ? segment.steps : DEFAULT_AWS_STEPS)].sort(
    (a, b) => a.at - b.at,
  );
  const { weight, act, idx, t: focusT } = useFocus(steps);
  const titleP = useEnter(0, 26);
  const footP = useEnter(24, 24);
  const prog = interpolate(frame, [0, durationInFrames], [0, 1], { ...clamp, easing: easeInOut });

  // Camera: a slow push toward whatever is in focus. The zoom point glides between nodes with the focus, the
  // push builds over each step (never past CAMERA_MAX) and eases back to a gentle start when the focus moves on.
  const sumW = NODES.reduce((a, n) => a + weight(n.key), 0);
  const focusX = sumW > 0.001 ? NODES.reduce((a, n) => a + weight(n.key) * (n.x + n.w / 2), 0) / sumW : 960;
  const focusY = sumW > 0.001 ? NODES.reduce((a, n) => a + weight(n.key) * (n.y + n.h / 2), 0) / sumW : MID_Y;
  const cur = idx >= 0 ? steps[idx] : null;
  const nextStep = idx >= 0 ? steps[idx + 1] : undefined;
  const stepStart = cur ? Math.round(cur.at * fps) : 0;
  const stepEnd = nextStep ? Math.round(nextStep.at * fps) : durationInFrames;
  const stepProg = interpolate(frame, [stepStart, stepEnd], [0, 1], { ...clamp, easing: easeInOut });
  const START = 1 + (CAMERA_MAX - 1) * 0.3;
  const curScale = START + (CAMERA_MAX - START) * stepProg;
  const prevScale = idx > 0 ? CAMERA_MAX : 1;
  const camScale = idx >= 0 ? prevScale + (curScale - prevScale) * focusT : 1;
  const originX = 960 + (focusX - 960) * CAMERA_BIAS;
  const originY = MID_Y + (focusY - MID_Y) * CAMERA_BIAS;

  const accentOf = (f: AwsFocus) => NODES.find((n) => n.key === FOCUS_NODES[f][FOCUS_NODES[f].length - 1])!.accent;

  return (
    <AbsoluteFill>
      <Backdrop drift={prog} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 96,
          textAlign: 'center',
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 64,
          letterSpacing: '-0.045em',
          lineHeight: 1,
          color: C.text,
          opacity: titleP,
          transform: `translateY(${(1 - titleP) * -14}px)`,
        }}
      >
        Runs on <span style={gradientText}>AWS</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 172,
          textAlign: 'center',
          fontFamily: FONT_BODY,
          fontWeight: 500,
          fontSize: 24,
          letterSpacing: '0.06em',
          color: C.muted,
          opacity: footP,
        }}
      >
        S3 releases · SSM deploys · IAM
      </div>

      {/* the camera: a slow push toward the focused node, so a long hold never sits still */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: `${originX}px ${originY}px`,
          transform: `scale(${camScale})`,
        }}
      >
        <Connectors weight={weight} act={act} />
        {NODES.map((n) => {
          const o = segment.nodes?.[n.key];
          return <NodeCard key={n.key} n={n} w={weight(n.key)} act={act} name={o?.name ?? n.name} sub={o?.sub ?? n.sub} />;
        })}
      </div>

      {steps.map((step, i) => {
        const startFrame = Math.round(step.at * fps);
        const next = steps[i + 1];
        const hold = next ? Math.round(next.at * fps) - startFrame : durationInFrames - startFrame;
        return (
          <Sequence key={i} from={startFrame} durationInFrames={Math.max(1, hold + 14)} layout="none">
            <StepPanel step={step} accent={accentOf(step.focus)} holdFrames={hold} last={!next} lead={i === 0 ? 16 : 6} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
