import type { ReactElement } from 'react';
import { BODY_VIEWBOX, FRONT_REGIONS, BACK_REGIONS, type RegionPath } from './body-map-geometry.js';

/**
 * The body map (docs/architecture/surveys-and-alerts.md): front and back
 * figures with individually selectable regions. Pointer, keyboard and
 * assistive tech are first-class on the SAME component - the SVG is the
 * pointer surface, and a parallel, properly labelled checkbox group
 * carries the SAME state for keyboard and AT; the selection summary is
 * text, so the interaction is confirmable without the picture. The
 * component knows geometry only - region ids, labels and criticality all
 * come from the caller (and patients are never handed criticality).
 *
 * The figures themselves live in body-map-geometry.ts: organic
 * silhouettes whose regions tile the body, per the B3/P4 reference.
 */

export interface BodyMapProps {
  selected: readonly string[];
  onToggle: (regionId: string) => void;
  /** region id -> localized label */
  labels: Record<string, string>;
  viewLabels: { front: string; back: string };
  /** "Right" / "Left" shown above the figure halves, as the reference
   * draws them - the front view faces the viewer, so the patient's
   * right appears on the viewer's left; the back view un-mirrors. */
  sideLabels?: { left: string; right: string };
  /** accessible name of the parallel checkbox group */
  legendLabel: string;
  /** "2 areas selected — chest, left forearm" - composed by the caller */
  summary: string;
}

function Figure({
  regions,
  title,
  viewerLeft,
  viewerRight,
  selected,
  onToggle,
}: {
  regions: readonly RegionPath[];
  title: string;
  viewerLeft?: string;
  viewerRight?: string;
  selected: ReadonlySet<string>;
  onToggle: (regionId: string) => void;
}): ReactElement {
  return (
    <figure className="m-0 w-[150px] text-center">
      <figcaption className="mb-1">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
          <span aria-hidden className="h-px flex-1 bg-hairline" />
          {title}
          <span aria-hidden className="h-px flex-1 bg-hairline" />
        </span>
        {viewerLeft !== undefined && viewerRight !== undefined ? (
          <span aria-hidden className="mt-0.5 flex justify-between px-3 text-[11px] text-muted">
            <span>{viewerLeft}</span>
            <span>{viewerRight}</span>
          </span>
        ) : null}
      </figcaption>
      <svg viewBox={BODY_VIEWBOX} width={150} height={255} aria-hidden focusable="false">
        {regions.map(({ id, d }) => (
          <path
            key={id}
            d={d}
            strokeWidth={1.4}
            strokeLinejoin="round"
            className={
              selected.has(id)
                ? 'cursor-pointer fill-teal stroke-teal-hover'
                : 'cursor-pointer fill-surface-sunken stroke-border hover:fill-teal-tint'
            }
            onClick={() => onToggle(id)}
          />
        ))}
      </svg>
    </figure>
  );
}

export function BodyMap({
  selected,
  onToggle,
  labels,
  viewLabels,
  sideLabels,
  legendLabel,
  summary,
}: BodyMapProps): ReactElement {
  const selectedSet = new Set(selected);
  const allRegionIds = [...new Set([...FRONT_REGIONS, ...BACK_REGIONS].map((region) => region.id))];
  return (
    <div>
      <div className="flex justify-center gap-6">
        <Figure
          regions={FRONT_REGIONS}
          title={viewLabels.front}
          {...(sideLabels !== undefined
            ? { viewerLeft: sideLabels.right, viewerRight: sideLabels.left }
            : {})}
          selected={selectedSet}
          onToggle={onToggle}
        />
        <Figure
          regions={BACK_REGIONS}
          title={viewLabels.back}
          {...(sideLabels !== undefined
            ? { viewerLeft: sideLabels.left, viewerRight: sideLabels.right }
            : {})}
          selected={selectedSet}
          onToggle={onToggle}
        />
      </div>
      <p className="mt-2 text-center text-sm text-secondary" aria-live="polite">
        {summary}
      </p>
      {/* The parallel representation: the same regions, the same state,
          fully labelled - keyboard and AT operate here. */}
      <fieldset className="mt-3 rounded-inner border border-hairline bg-paper px-3 py-2.5">
        {/* The legend names the group for AT; the visible caption lives
            INSIDE the box - a styled legend straddles the border and the
            border line runs through the text. */}
        <legend className="sr-only">{legendLabel}</legend>
        <p aria-hidden className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          {legendLabel}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {allRegionIds.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={selectedSet.has(id)} onChange={() => onToggle(id)} />
              {labels[id] ?? id}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
