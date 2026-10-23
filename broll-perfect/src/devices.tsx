import React from 'react';

// Slim-bezel devices. `screenW/H` is the picture; the frame adds the numbers below.

const SCREEN_GLOSS = 'linear-gradient(112deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 34%)';

export const TV_BEZEL = 7;
export const TV_STAND = 26; // neck + foot under the panel
export const LAPTOP_BEZEL = 10;
export const LAPTOP_BASE = 13;
export const PHONE_BEZEL = 9;

// outer sizes include the 1px frame border
export const tvOuterWidth = (screenW: number) => screenW + TV_BEZEL * 2 + 2;
export const tvOuterHeight = (screenH: number) => screenH + TV_BEZEL * 2 + 2 + TV_STAND;
export const laptopOuterWidth = (screenW: number) => screenW + LAPTOP_BEZEL * 2 + 2;
export const laptopOuterHeight = (screenH: number) => screenH + LAPTOP_BEZEL * 2 + 1 + LAPTOP_BASE;
export const phoneOuterWidth = (screenW: number) => screenW + PHONE_BEZEL * 2 + 2;
export const phoneOuterHeight = (screenH: number) => screenH + PHONE_BEZEL * 2 + 2;

type ScreenProps = { screenW: number; screenH: number; children: React.ReactNode };

const Screen: React.FC<{ w: number; h: number; radius: number; children: React.ReactNode }> = ({
  w,
  h,
  radius,
  children,
}) => (
  <div style={{ position: 'relative', width: w, height: h, borderRadius: radius, overflow: 'hidden', background: '#000' }}>
    {children}
    <div style={{ position: 'absolute', inset: 0, background: SCREEN_GLOSS, pointerEvents: 'none' }} />
  </div>
);

const BODY_BG = 'linear-gradient(160deg, #1b1826 0%, #0a0910 60%, #07060b 100%)';
const BODY_BORDER = '1px solid rgba(255,255,255,0.13)';

/** A TV with a thin bezel on a slim neck and foot. */
export const TvFrame: React.FC<ScreenProps> = ({ screenW, screenH, children }) => (
  <div style={{ position: 'relative', width: tvOuterWidth(screenW) }}>
    <div
      style={{
        padding: TV_BEZEL,
        borderRadius: 15,
        background: BODY_BG,
        border: BODY_BORDER,
        boxSizing: 'border-box',
        boxShadow: '0 40px 80px -18px rgba(0,0,0,0.7), 0 100px 150px -40px rgba(0,0,0,0.75)',
      }}
    >
      <Screen w={screenW} h={screenH} radius={6}>
        {children}
      </Screen>
    </div>
    <div
      style={{
        margin: '0 auto',
        width: 64,
        height: 18,
        background: 'linear-gradient(180deg, #1c1828 0%, #0b0910 100%)',
        clipPath: 'polygon(12% 0, 88% 0, 100% 100%, 0 100%)',
      }}
    />
    <div
      style={{
        margin: '0 auto',
        width: 230,
        height: 8,
        borderRadius: '2px 2px 5px 5px',
        background: 'linear-gradient(180deg, #2d2744 0%, #100d1a 100%)',
        boxShadow: '0 16px 30px rgba(0,0,0,0.55)',
      }}
    />
  </div>
);

/** A laptop: slim lid with a camera dot and a hinged base with a thumb notch. */
export const LaptopFrame: React.FC<ScreenProps> = ({ screenW, screenH, children }) => (
  <div style={{ position: 'relative', width: laptopOuterWidth(screenW) }}>
    <div
      style={{
        position: 'relative',
        padding: `${LAPTOP_BEZEL}px`,
        borderRadius: '15px 15px 3px 3px',
        background: BODY_BG,
        border: BODY_BORDER,
        borderBottom: 'none',
        boxSizing: 'border-box',
        boxShadow: '0 40px 80px -18px rgba(0,0,0,0.7)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: '50%',
          marginLeft: -2.5,
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#2a2440',
        }}
      />
      <Screen w={screenW} h={screenH} radius={4}>
        {children}
      </Screen>
    </div>
    <div
      style={{
        position: 'relative',
        marginLeft: -12,
        width: laptopOuterWidth(screenW) + 24,
        height: LAPTOP_BASE,
        borderRadius: '0 0 20px 20px',
        background: 'linear-gradient(180deg, #3a3354 0%, #1a1626 55%, #100d19 100%)',
        boxShadow: '0 24px 50px -6px rgba(0,0,0,0.75), 0 60px 100px -30px rgba(0,0,0,0.7)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          marginLeft: -64,
          width: 128,
          height: 5,
          borderRadius: '0 0 8px 8px',
          background: '#0b0910',
        }}
      />
    </div>
  </div>
);

/** A phone with a pill camera cut-out. */
export const PhoneFrame: React.FC<ScreenProps> = ({ screenW, screenH, children }) => (
  <div style={{ position: 'relative', width: phoneOuterWidth(screenW) }}>
    <div
      style={{
        position: 'relative',
        padding: PHONE_BEZEL,
        borderRadius: 46,
        background: 'linear-gradient(150deg, #2c2644 0%, #0c0a12 65%)',
        border: '1px solid rgba(255,255,255,0.17)',
        boxSizing: 'border-box',
        boxShadow: '0 50px 90px -16px rgba(0,0,0,0.8), 0 120px 170px -40px rgba(0,0,0,0.8)',
      }}
    >
      <Screen w={screenW} h={screenH} radius={38}>
        {children}
      </Screen>
      <div
        style={{
          position: 'absolute',
          top: PHONE_BEZEL + 12,
          left: '50%',
          marginLeft: -screenW * 0.13,
          width: screenW * 0.26,
          height: 20,
          borderRadius: 10,
          background: '#000',
        }}
      />
    </div>
  </div>
);
