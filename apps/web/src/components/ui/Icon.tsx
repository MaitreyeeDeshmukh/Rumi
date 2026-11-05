/** Icons ported from prototype/src/core.tsx as typed path data (no innerHTML). */
type Shape =
  | { t: 'path'; d: string; fill?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx: number };

const ICONS = {
  home: [{ t: 'path', d: 'M3 10.5 12 3l9 7.5' }, { t: 'path', d: 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5' }],
  notes: [{ t: 'path', d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z' }, { t: 'path', d: 'M14 3v6h6M8 13h8M8 17h5' }],
  chat: [{ t: 'path', d: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-5.6A8 8 0 1 1 21 12Z' }],
  list: [{ t: 'path', d: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01' }],
  sliders: [{ t: 'path', d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }],
  check: [{ t: 'path', d: 'M20 6 9 17l-5-5' }],
  x: [{ t: 'path', d: 'M18 6 6 18M6 6l12 12' }],
  plus: [{ t: 'path', d: 'M12 5v14M5 12h14' }],
  mic: [{ t: 'rect', x: 9, y: 2.5, w: 6, h: 12, rx: 3 }, { t: 'path', d: 'M5 11a7 7 0 0 0 14 0M12 18v3.5' }],
  pause: [{ t: 'rect', x: 6, y: 5, w: 4, h: 14, rx: 1 }, { t: 'rect', x: 14, y: 5, w: 4, h: 14, rx: 1 }],
  repeat: [{ t: 'path', d: 'M17 2l4 4-4 4' }, { t: 'path', d: 'M3 11V9a3 3 0 0 1 3-3h15' }, { t: 'path', d: 'm7 22-4-4 4-4' }, { t: 'path', d: 'M21 13v2a3 3 0 0 1-3 3H3' }],
  volume: [{ t: 'path', d: 'M11 5 6 9H2v6h4l5 4Z' }, { t: 'path', d: 'M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14' }],
  hand: [{ t: 'path', d: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8' }, { t: 'path', d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15' }],
  end: [{ t: 'path', d: 'M3 14.5c5-4.7 13-4.7 18 0l-2.2 2.8-3.6-1.4v-2.6a10 10 0 0 0-6.4 0v2.6l-3.6 1.4Z' }],
  share: [{ t: 'circle', cx: 18, cy: 5, r: 3 }, { t: 'circle', cx: 6, cy: 12, r: 3 }, { t: 'circle', cx: 18, cy: 19, r: 3 }, { t: 'path', d: 'm8.6 13.5 6.8 4M15.4 6.5l-6.8 4' }],
  edit: [{ t: 'path', d: 'M12 20h9' }, { t: 'path', d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }],
  copy: [{ t: 'rect', x: 9, y: 9, w: 12, h: 12, rx: 2 }, { t: 'path', d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }],
  alert: [{ t: 'path', d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }, { t: 'path', d: 'M12 9v4M12 17h.01' }],
  info: [{ t: 'circle', cx: 12, cy: 12, r: 9 }, { t: 'path', d: 'M12 16v-4M12 8h.01' }],
  undo: [{ t: 'path', d: 'M9 17 4 12l5-5' }, { t: 'path', d: 'M20 18v-2a4 4 0 0 0-4-4H4' }],
  heart: [{ t: 'path', d: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z' }],
  slow: [{ t: 'circle', cx: 12, cy: 12, r: 9 }, { t: 'path', d: 'M12 7v5l3 2' }],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, label }: { name: IconName; size?: number; label?: string }) {
  const shapes: readonly Shape[] = ICONS[name];
  return (
    <svg className="ic" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {shapes.map((s, i) => {
        if (s.t === 'path') return <path key={i} d={s.d} fill={s.fill ? 'currentColor' : undefined} />;
        if (s.t === 'circle') return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill ? 'currentColor' : undefined} />;
        return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />;
      })}
    </svg>
  );
}
