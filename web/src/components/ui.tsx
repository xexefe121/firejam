import { type ReactNode, useEffect, useRef } from 'react';
import { focusEl, focusFirst, useKeys } from '../lib/nav';
import { initials } from '../lib/format';

type Ring = 'online' | 'offline' | 'live' | 'none';

export function Avatar({
  name,
  color,
  size = 3,
  ring = 'none',
}: {
  name: string;
  color: string;
  size?: number;
  ring?: Ring;
}) {
  return (
    <span
      className={`avatar ring-${ring}`}
      style={{ width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.4}rem`, ['--c' as string]: color }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, size = 2.2, max = 4 }: { people: { id: string; name: string; color: string }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} color={p.color} size={size} />
      ))}
      {people.length > max && (
        <span className="avatar more" style={{ width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.38}rem` }}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`progress ${className}`}>
      {/* Moved with transform, not width, so the once-a-second update never re-lays out the page. */}
      <span style={{ transform: `translateX(${Math.min(100, Math.max(0, value * 100)) - 100}%)` }} />
    </span>
  );
}

/**
 * A focus-trapping dialog. D-pad stays inside it, Back closes it, and focus
 * returns to whatever opened it.
 */
export function Modal({
  onClose,
  children,
  className = '',
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => ref.current && focusFirst(ref.current), 0);
    return () => {
      clearTimeout(id);
      if (opener && document.contains(opener)) setTimeout(() => focusEl(opener), 0);
    };
  }, []);
  useKeys((key) => {
    if (key === 'back') {
      onClose();
      return true;
    }
    return false;
  });
  return (
    <div className="modal-backdrop" data-trap role="dialog" aria-modal aria-label={label}>
      <div ref={ref} className={`modal ${className}`}>
        {children}
      </div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  kind = 'ghost',
  autoFocus,
  disabled,
  className = '',
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'quiet';
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      className={`btn btn-${kind} ${className}`}
      data-focus
      data-autofocus={autoFocus || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
