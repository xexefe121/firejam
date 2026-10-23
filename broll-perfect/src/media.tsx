import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Freeze, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Video } from '@remotion/media';
import brollJson from '../manifest/broll.json';
import type { BrollManifest } from './types';
import { C, FONT_BODY } from './theme';

// The manifest the project ships with. FireJamDemo replaces it through its `broll` prop, previews use it as is.
const bundledBroll = brollJson as unknown as BrollManifest;

export const BrollContext = createContext<BrollManifest>(bundledBroll);
export const useBroll = () => useContext(BrollContext);

const norm = (p: string) =>
  p
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/^public\//, '');
const base = (p: string) => norm(p).split('/').pop() ?? '';

export type ClipInfo = { available: boolean; duration?: number; width?: number; height?: number };

// A src is present when it lives under clips/ (user footage, always trusted) or when the capture
// script has listed it in broll.json. Anything else gets a slate so the composition always renders.
export const resolveClip = (broll: BrollManifest, src: string): ClipInfo => {
  const n = norm(src);
  if (n.startsWith('clips/')) return { available: true };
  const hit = (broll.clips ?? []).find((c) => {
    const f = norm(c.file ?? '');
    return f === n || base(f) === base(n);
  });
  if (!hit) return { available: false };
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  return { available: true, duration: num(hit.duration), width: num(hit.width), height: num(hit.height) };
};

// Video audio is muted unless a volume is set; footage under clips/ defaults to full volume.
export const resolveVolume = (src: string, ...overrides: Array<number | undefined>): number => {
  for (const o of overrides) if (typeof o === 'number') return o;
  return norm(src).startsWith('clips/') ? 1 : 0;
};

export type SlateVariant = 'full' | 'screen' | 'phone' | 'ambient';

/** CameraView draws its content at this multiple of its on-screen size; slates scale their type to match. */
export const SupersampleContext = createContext(1);

const SCALE: Record<SlateVariant, number> = { full: 1, screen: 0.62, phone: 0.5, ambient: 0.8 };

export const Slate: React.FC<{ src: string; variant?: SlateVariant }> = ({ src, variant = 'full' }) => {
  const frame = useCurrentFrame();
  const k = SCALE[variant] * useContext(SupersampleContext);
  const boost = variant === 'ambient' ? 2.4 : 1;
  const t = frame / 120;
  const ax = 28 + Math.sin(t * 2) * 6;
  const ay = 22 + Math.cos(t * 1.6) * 5;
  const bx = 78 + Math.cos(t * 1.4) * 6;
  const by = 86 + Math.sin(t * 1.9) * 5;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(60% 55% at ${ax}% ${ay}%, rgba(255,106,31,${Math.min(0.6, 0.2 * boost)}) 0%, rgba(255,106,31,0) 70%)`,
          `radial-gradient(55% 60% at ${bx}% ${by}%, rgba(177,75,255,${Math.min(0.5, 0.18 * boost)}) 0%, rgba(177,75,255,0) 70%)`,
          `linear-gradient(145deg, ${C.card} 0%, ${C.bg2} 100%)`,
        ].join(','),
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_BODY,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      />
      {variant === 'ambient' ? (
        <div
          style={{
            position: 'absolute',
            left: 48,
            bottom: 40,
            fontSize: 24,
            color: C.dim,
            letterSpacing: '0.02em',
          }}
        >
          {src}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 * k }}>
          <div
            style={{
              width: 92 * k,
              height: 92 * k,
              borderRadius: '50%',
              border: `${Math.max(2, 2.5 * k)}px solid rgba(255,255,255,0.16)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                marginLeft: 8 * k,
                width: 0,
                height: 0,
                borderTop: `${15 * k}px solid transparent`,
                borderBottom: `${15 * k}px solid transparent`,
                borderLeft: `${25 * k}px solid rgba(255,255,255,0.34)`,
              }}
            />
          </div>
          <div
            style={{
              fontSize: 34 * k,
              fontWeight: 500,
              color: C.muted,
              letterSpacing: '0.01em',
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {src}
          </div>
          <div
            style={{
              fontSize: 19 * k,
              fontWeight: 600,
              color: C.dim,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
            }}
          >
            Waiting for footage
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

type MediaClipProps = {
  src: string;
  /** Start offset into the source, in seconds. */
  from?: number;
  /** 0 mutes. Use resolveVolume() to apply the manifest defaults. */
  volume: number;
  variant?: SlateVariant;
};

// A video that fills its (positioned) parent, or a slate when the file is not available yet.
// If the capture is shorter than the time it has to fill, the last frame is held rather than the clip looping.
export const MediaClip: React.FC<MediaClipProps> = ({ src, from = 0, volume, variant = 'full' }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const broll = useBroll();
  const info = resolveClip(broll, src);

  const wrap: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' };

  if (!info.available) {
    return (
      <div style={wrap}>
        <Slate src={src} variant={variant} />
      </div>
    );
  }

  const startFrame = Math.round(from * fps);
  const url = staticFile(norm(src));
  const muted = volume <= 0;
  const renderVideo = (trimBefore: number) => (
    <Video
      src={url}
      trimBefore={trimBefore}
      muted={muted}
      volume={volume}
      objectFit="cover"
      style={{ width: '100%', height: '100%' }}
    />
  );

  const playable =
    info.duration !== undefined ? Math.max(0, Math.floor((info.duration - from) * fps) - 2) : null;
  if (playable !== null && playable >= 2 && playable < durationInFrames) {
    return (
      <div style={wrap}>
        <Sequence durationInFrames={playable} layout="none">
          {renderVideo(startFrame)}
        </Sequence>
        <Sequence from={playable} layout="none">
          <Freeze frame={0}>{renderVideo(startFrame + playable - 1)}</Freeze>
        </Sequence>
      </div>
    );
  }

  return <div style={wrap}>{renderVideo(startFrame)}</div>;
};
