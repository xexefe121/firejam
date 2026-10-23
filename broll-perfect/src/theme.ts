import { loadFont as loadGeist } from '@remotion/google-fonts/Geist';

// The film uses Geist (a neutral, SF-like grotesk) for everything: tight tracking, weights 500-700.
// The product UI inside the captures keeps its own Outfit/Inter look.
const geist = loadGeist('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

export const FONT_DISPLAY = `${geist.fontFamily}, 'Inter', system-ui, sans-serif`;
export const FONT_BODY = FONT_DISPLAY;

export const C = {
  bg: '#07060b',
  bg2: '#0b0912',
  card: '#1a1628',
  card2: '#241e37',
  line: 'rgba(255, 255, 255, 0.08)',
  text: '#f7f4ff',
  soft: '#cfc5ec',
  muted: '#9a92b4',
  dim: '#6d6688',
  fire: '#ff6a1f',
  rose: '#ff3d6e',
  amber: '#ffb547',
  violet: '#b14bff',
  ok: '#34e3a4',
} as const;

export const GRAD = 'linear-gradient(120deg, #ffb547 0%, #ff6a1f 35%, #ff3d6e 70%, #c13cff 100%)';
export const GRAD_V = 'linear-gradient(180deg, #ffb547 0%, #ff6a1f 40%, #ff3d6e 100%)';

// Style that paints the brand gradient into text. Put it on an element that carries no opacity/filter
// of its own, and animate a parent instead.
export const gradientText = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
} as const;
