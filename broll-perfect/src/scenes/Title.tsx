import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { TitleSegment } from '../types';
import { C, FONT_DISPLAY, gradientText } from '../theme';
import { Backdrop, BrandIcon, WordReveal, useEnter } from '../ui';

const STATEMENT: React.CSSProperties = {
  maxWidth: 1500,
  textAlign: 'center',
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: 132,
  lineHeight: 1.04,
  letterSpacing: '-0.05em',
  color: C.text,
  filter: 'drop-shadow(0 6px 40px rgba(0,0,0,0.5))',
};

// The wordmark of the logo version: one word, risen and un-blurred like the end card. A trailing "Jam" is gradient.
const Wordmark: React.FC<{ text: string }> = ({ text }) => {
  const p = useEnter(10, 34);
  const m = /^(.*?)(Jam)$/.exec(text);
  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 600,
        fontSize: 170,
        lineHeight: 1,
        letterSpacing: '-0.055em',
        color: C.text,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px)`,
        filter: p < 0.99 ? `blur(${(1 - p) * 8}px)` : undefined,
      }}
    >
      {m ? (
        <>
          {m[1]}
          <span style={gradientText}>{m[2]}</span>
        </>
      ) : (
        text
      )}
    </div>
  );
};

// One statement, centred. The backdrop is the same glow as every other scene, so it carries on across the cut.
export const TitleScene: React.FC<{ segment: TitleSegment }> = ({ segment }) => {
  const words = segment.text.split(' ').length;
  const iconP = useEnter(0, 40);
  const sub = segment.sub ? (
    <WordReveal
      text={segment.sub}
      delay={segment.logo ? 24 : 3 + words * 3 + 8}
      stagger={2}
      rise={14}
      style={{
        maxWidth: 1300,
        textAlign: 'center',
        fontFamily: FONT_DISPLAY,
        fontWeight: 500,
        fontSize: 40,
        lineHeight: 1.25,
        letterSpacing: '-0.015em',
        color: C.muted,
      }}
    />
  ) : null;

  if (segment.logo) {
    return (
      <AbsoluteFill>
        <Backdrop intensity={1.4} />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, marginTop: -10 }}>
            <div
              style={{
                position: 'relative',
                marginBottom: 20,
                opacity: iconP,
                transform: `translateY(${(1 - iconP) * 22}px) scale(${0.9 + iconP * 0.1})`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: -80,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(255,106,31,0.26) 0%, rgba(255,106,31,0) 66%)',
                }}
              />
              <BrandIcon size={150} style={{ position: 'relative', filter: 'drop-shadow(0 20px 46px rgba(255,80,60,0.38))' }} />
            </div>
            <Wordmark text={segment.text} />
            {sub}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <Backdrop intensity={1.15} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 190px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, marginTop: -20 }}>
          <WordReveal text={segment.text} delay={3} stagger={3} rise={28} style={STATEMENT} />
          {sub}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
