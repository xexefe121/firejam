// Bridge to the Fire TV shell (android/). Present only inside the Fire TV app;
// in a browser every call is a no-op and Prime jams fall back to a remote view.

interface Bridge {
  info(): string;
  device(): string;
  openPrime(link: string, title: string): boolean;
  syncJam(json: string): void;
  stopSync(): void;
  overlay(text: string): void;
  setIdentity(server: string, userId: string, token: string, share: boolean): void;
  openAccessSettings(): boolean;
  /** Missing in Fire TV builds before Alexa voice control. */
  mediaState?(json: string): void;
  /** Missing in builds before the Android TV pop-up permission step. */
  openOverlaySettings?(): boolean;
}

export interface NativeInfo {
  /** The Prime Video app is installed on this TV. */
  primeInstalled: boolean;
  /** FireJam may read and drive other apps' playback (notification-listener access). */
  sessionAccess: boolean;
  /** FireJam may draw reactions on top of Prime Video. */
  overlayAccess: boolean;
  /** Component name to grant listener access to over adb. */
  listener: string;
  /** This TV has a settings screen for that access (Android TV yes, Fire TV no). */
  settingsAvailable: boolean;
  /** This TV has a "Display over other apps" screen for FireJam (Android TV yes, Fire TV no). */
  overlaySettingsAvailable?: boolean;
}

/** What the Fire TV tells us about itself, so first launch needs no setup. */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  /** "Dhanusha" from "Dhanusha's Fire TV", when the TV is named that way. */
  ownerName: string | null;
  timezone: string;
  primeInstalled: boolean;
  /** The active Fire TV profile, hashed; null off Fire TV and in builds before profile switching. */
  tvProfile?: string | null;
}

/** `loose`: Prime Video doesn't share its position, so only play/pause are linked (see PrimeSync.kt). */
export type PrimeState = 'opening' | 'waiting' | 'synced' | 'catching' | 'loose' | 'paused' | 'left' | 'no-access' | 'no-app';

export type PrimeEvent =
  | { type: 'status'; state: PrimeState; drift?: number; title?: string }
  | { type: 'local'; kind: 'play' | 'pause' | 'seek'; position: number };

/** An Alexa transport command for the film jam on screen ("Alexa, pause", "rewind 30 seconds"). */
export type VoiceCommand = { kind: 'play' | 'pause' } | { kind: 'seek'; position: number };

const w = window as unknown as {
  FireJamNative?: Bridge;
  firejamPrime?: (e: PrimeEvent) => void;
  firejamVoice?: (c: VoiceCommand) => void;
};
export const native: Bridge | undefined = w.FireJamNative;

export function nativeInfo(): NativeInfo | null {
  try {
    return native ? (JSON.parse(native.info()) as NativeInfo) : null;
  } catch {
    return null;
  }
}

export function deviceInfo(): DeviceInfo | null {
  try {
    return native ? (JSON.parse(native.device()) as DeviceInfo) : null;
  } catch {
    return null;
  }
}

const listeners = new Set<(e: PrimeEvent) => void>();
w.firejamPrime = (e) => listeners.forEach((l) => l(e));

let voice: ((c: VoiceCommand) => void) | null = null;
w.firejamVoice = (c) => voice?.(c);

/** Tell the TV which FireJam film jam is on screen so Alexa can drive it; returns a cleanup. */
export function voiceControl(state: () => object, on: (c: VoiceCommand) => void) {
  if (!native?.mediaState) return { report() {}, stop() {} };
  voice = on;
  return {
    report: () => native!.mediaState!(JSON.stringify(state())),
    stop: () => {
      voice = null;
      native!.mediaState!('');
    },
  };
}

export function onPrime(l: (e: PrimeEvent) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
