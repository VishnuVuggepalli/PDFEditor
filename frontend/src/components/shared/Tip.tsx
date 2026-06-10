/** Hover tooltip wrapper (pure CSS, from the design). */
import type { ReactNode } from 'react';

interface Props {
  label: string;
  sub?: string;
  pos?: 'top' | 'bottom';
  children: ReactNode;
}

export function Tip({ label, sub, pos = 'bottom', children }: Props) {
  return (
    <span className="tip-wrap">
      {children}
      <span className={`tip ${pos}`}>
        {label}
        {sub ? <span className="sub">{sub}</span> : null}
      </span>
    </span>
  );
}
