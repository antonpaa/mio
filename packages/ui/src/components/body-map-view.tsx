import type { ReactElement } from 'react';
import { BODY_VIEWBOX, FRONT_REGIONS, BACK_REGIONS, type RegionPath } from './body-map-geometry.js';

/**
 * The READ-ONLY body map: the same front/back figures the fill uses,
 * with a selection painted in - for response views (P12, C-side response
 * detail), where the design shows the marked body rather than only a
 * region list. Purely presentational: the svg is aria-hidden and the
 * caller keeps the textual region list as the accessible content.
 */

function FigureView({
  regions,
  title,
  selected,
  width,
}: {
  regions: readonly RegionPath[];
  title: string;
  selected: ReadonlySet<string>;
  width: number;
}): ReactElement {
  return (
    <figure className="m-0 text-center" style={{ width }}>
      <figcaption aria-hidden className="mb-1 text-[10px] uppercase tracking-wide text-muted">
        {title}
      </figcaption>
      <svg
        viewBox={BODY_VIEWBOX}
        width={width}
        height={Math.round(width * 1.7)}
        aria-hidden
        focusable="false"
      >
        {regions.map(({ id, d }) => (
          <path
            key={id}
            d={d}
            strokeWidth={1.4}
            strokeLinejoin="round"
            className={
              selected.has(id) ? 'fill-teal stroke-teal-hover' : 'fill-surface-sunken stroke-border'
            }
          />
        ))}
      </svg>
    </figure>
  );
}

export function BodyMapView({
  selected,
  viewLabels,
  width = 104,
}: {
  selected: readonly string[];
  viewLabels: { front: string; back: string };
  /** width of ONE figure in px */
  width?: number;
}): ReactElement {
  const selectedSet = new Set(selected);
  return (
    <div className="flex gap-4">
      <FigureView
        regions={FRONT_REGIONS}
        title={viewLabels.front}
        selected={selectedSet}
        width={width}
      />
      <FigureView
        regions={BACK_REGIONS}
        title={viewLabels.back}
        selected={selectedSet}
        width={width}
      />
    </div>
  );
}
