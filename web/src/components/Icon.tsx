const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5',
  map: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  friends: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.3a4 4 0 0 1 0 7.4M18 14a6 6 0 0 1 4 5.7V21',
  film: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
  back10: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5M10 10v5M13 10h2.5v5H13z',
  fwd10: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5M10 10v5M13 10h2.5v5H13z',
  invite: 'M15 19v-1a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v1M8.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  leave: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11',
  swap: 'M4 7h13l-3.5-3.5M20 17H7l3.5 3.5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  ghost: 'M5 20V10a7 7 0 0 1 14 0v10l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2zM9.5 10.5h.01M14.5 10.5h.01',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0',
  phone: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2',
  flag: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  code: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 9v6M12 9v6M16 9v6',
};

export function Icon({ name, size = '1.5em', fill = false }: { name: keyof typeof PATHS | string; size?: string; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Flame({ size = '1em' }: { size?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="fj-flame" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ff3d6e" />
          <stop offset=".55" stopColor="#ff7a1f" />
          <stop offset="1" stopColor="#ffc247" />
        </linearGradient>
      </defs>
      <path d="M33 4c2 10-7 13-7 22 0 3 2 6 5 6-1-5 3-8 7-11 1 7 8 10 8 19a14 14 0 0 1-28 0c0-14 14-19 15-36z" fill="url(#fj-flame)" />
    </svg>
  );
}
