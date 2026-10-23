import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { EndSegment } from '../types';
import { C, FONT_DISPLAY, gradientText } from '../theme';
import { Backdrop, BrandIcon, clamp, easeInOut, useEnter } from '../ui';

export const CREDIT_LINE =
  'Films by the Blender Foundation (CC BY): Sintel, Big Buck Bunny, Tears of Steel, Elephants Dream';

// Logo mark, wordmark, tagline. Then, small and quiet, the credit.
export const EndScene: React.FC<{ segment: EndSegment }> = () => {
  const frame = useCurrentFrame();
  const iconP = useEnter(0, 40);
  const wordP = useEnter(10, 34);
  const tagP = useEnter(26, 34);
  const creditP = useEnter(58, 40);
  // the whole lockup drifts very slowly so the hold never feels frozen
  const drift = interpolate(frame, [0, 150], [0, 1], { ...clamp, easing: easeInOut });
  const glow = 0.5 + 0.5 * Math.sin(frame / 26);

  return (
    <AbsoluteFill>
      <Backdrop intensity={1.5} drift={drift} />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${-14 - drift * 8}px) scale(${1 + 0.025 * drift})`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              position: 'relative',
              opacity: iconP,
              transform: `translateY(${(1 - iconP) * 22}px) scale(${0.9 + iconP * 0.1})`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: -90,
                borderRadius: '50%',
                background: `radial-gradient(circle, rgba(255,106,31,${0.2 + glow * 0.07}) 0%, rgba(255,106,31,0) 66%)`,
              }}
            />
            <BrandIcon
              size={156}
              style={{ position: 'relative', filter: 'drop-shadow(0 22px 50px rgba(255,80,60,0.35))' }}
            />
          </div>

          <div
            style={{
              marginTop: 44,
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 168,
              lineHeight: 1,
              letterSpacing: '-0.055em',
              color: C.text,
              opacity: wordP,
              transform: `translateY(${(1 - wordP) * 24}px)`,
              filter: wordP < 0.99 ? `blur(${(1 - wordP) * 8}px)` : undefined,
            }}
          >
            Fire<span style={gradientText}>Jam</span>
          </div>

          <div
            style={{
              marginTop: 26,
              fontFamily: FONT_DISPLAY,
              fontWeight: 500,
              fontSize: 46,
              letterSpacing: '-0.025em',
              color: C.soft,
              opacity: tagP,
              transform: `translateY(${(1 - tagP) * 16}px)`,
              filter: tagP < 0.99 ? `blur(${(1 - tagP) * 6}px)` : undefined,
            }}
          >
            The living room is back.
          </div>
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          left: 96,
          right: 96,
          bottom: 96,
          textAlign: 'center',
          fontFamily: FONT_DISPLAY,
          fontWeight: 400,
          fontSize: 20,
          letterSpacing: '0.005em',
          color: C.dim,
          opacity: creditP,
        }}
      >
        {CREDIT_LINE}
      </div>
    </AbsoluteFill>
  );
};
