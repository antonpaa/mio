import type { ReactElement } from 'react';

export type Severity = 'high' | 'moderate' | 'low';

const SEVERITY_STYLES: Record<Severity, { chip: string; dot: string; label: string }> = {
  high: { chip: 'border-red-chip-border bg-red-tint text-red', dot: 'bg-red', label: 'High' },
  moderate: {
    chip: 'border-amber-chip-border bg-amber-tint text-amber',
    dot: 'bg-amber',
    label: 'Moderate',
  },
  // The X6 decision (2026-08-24): Low is the teal OUTLINE - surface
  // background, no tint fill - deliberately quieter than the tinted
  // High/Moderate chips so severity reads as a hierarchy at a glance.
  low: { chip: 'border-teal-chip-border bg-surface text-teal', dot: 'bg-teal', label: 'Low' },
};

/**
 * Severity is never color-alone: the chip pairs color with a leading dot AND
 * the text label (docs/design/design-system.md, accessibility hotspots).
 */
export function SeverityChip({
  severity,
  label,
}: {
  severity: Severity;
  label?: string;
}): ReactElement {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${style.chip}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-pill ${style.dot}`} />
      {label ?? style.label}
    </span>
  );
}

export type ChipTone = 'neutral' | 'teal' | 'amber' | 'red';

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-sunken text-ink-strong-secondary',
  teal: 'border-teal-chip-border bg-teal-tint text-teal',
  amber: 'border-amber-chip-border bg-amber-tint text-amber',
  red: 'border-red-chip-border bg-red-tint text-red',
};

/** Status chip - Active, Draft, Published, Ended, Unclaimed... */
export function StatusChip({
  tone = 'neutral',
  children,
}: {
  tone?: ChipTone;
  children: string;
}): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
