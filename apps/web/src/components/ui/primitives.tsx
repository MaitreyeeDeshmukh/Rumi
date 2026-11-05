'use client';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { COPY } from '../copy';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', big, small, busy, icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean; small?: boolean; busy?: boolean; icon?: IconName }) {
  const cls = ['btn', `btn-${variant}`, big ? 'big' : '', small ? 'btn-sm' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** Label, hint and error wired to one control by id. `children` receives the props to spread on the control. */
export function Field({ label, hint, error, children }: {
  label: ReactNode; hint?: ReactNode; error?: string;
  children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : '';
  const errId = error ? `${id}-err` : '';
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{label}</label>
      {hint ? <p className="hint" id={hintId}>{hint}</p> : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <p className="err" id={errId}><Icon name="alert" size={18} />{error}</p> : null}
    </div>
  );
}

export function Chip({ children, suggested }: { children: ReactNode; suggested?: boolean }) {
  return <span className={`chip${suggested ? ' suggested' : ''}`}>{children}</span>;
}

export function ChoiceCard({ title, description, pressed, onPress, num }: {
  title: string; description?: string; pressed: boolean; onPress: () => void; num?: number;
}) {
  return (
    <button type="button" className="choice" aria-pressed={pressed} onClick={onPress}>
      {num !== undefined ? <span className="choice-num" aria-hidden="true">{num}</span> : null}
      <span className="choice-text"><strong>{title}</strong>{description ? <span>{description}</span> : null}</span>
      <span className="choice-mark" aria-hidden="true">{pressed ? <Icon name="check" size={16} /> : null}</span>
    </button>
  );
}

export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label" id={`${id}-l`}>{label}</span>
        {description ? <span className="hint" id={`${id}-d`}>{description}</span> : null}
      </span>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined} onClick={() => onChange(!checked)}>
        <span className="switch-knob" aria-hidden="true" />
        <span className="switch-state" aria-hidden="true">{checked ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const icon: IconName = tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info';
  return <div className={`notice${tone === 'info' ? '' : ` ${tone}`}`}><Icon name={icon} size={20} /><div>{children}</div></div>;
}

export function Banner({ children }: { children: ReactNode }) {
  return <p className="banner" role="note"><Icon name="info" size={20} />{children}</p>;
}

/** Text status for loading and results. Always in the DOM so screen readers hear changes. */
export function Status({ children, busy }: { children?: ReactNode; busy?: boolean }) {
  return (
    <p className="status-line" role="status" aria-live="polite">
      {busy && children ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </p>
  );
}

/** "Step 2 of 3" with the step name. Text, not a progress bar, so it never feels like a countdown. */
export function Steps({ current, total, name }: { current: number; total: number; name: string }) {
  return (
    <p className="steps">
      <span className="steps-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < current ? 'on' : undefined} />)}
      </span>
      <span>{COPY.common.step(current, total, name)}</span>
    </p>
  );
}

/** A section that stays closed until the person opens it. Native <details>, so it works with keyboard and screen readers. */
export function Disclosure({ summary, children, open, onToggle }: { summary: string; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void }) {
  return (
    <details className="disclosure" open={open} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}>
      <summary><span>{summary}</span><Icon name="chevron" size={20} /></summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
