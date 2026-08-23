import type { ReactElement } from 'react';

/**
 * The body map (docs/architecture/surveys-and-alerts.md): front and back
 * figures with individually selectable regions. Pointer, keyboard and
 * assistive tech are first-class on the SAME component - the SVG is the
 * pointer surface, and a parallel, properly labelled checkbox group
 * carries the SAME state for keyboard and AT; the selection summary is
 * text, so the interaction is confirmable without the picture. The
 * component knows geometry only - region ids, labels and criticality all
 * come from the caller (and patients are never handed criticality).
 */

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

interface Placement {
  id: string;
  shape: Shape;
}

// The FRONT view faces the viewer: the patient's LEFT is on the viewer's
// right. The BACK view is seen from behind: patient's left = viewer's left.
const FRONT: Placement[] = [
  { id: 'head', shape: { kind: 'ellipse', cx: 100, cy: 34, rx: 21, ry: 25 } },
  { id: 'neck', shape: { kind: 'rect', x: 90, y: 60, w: 20, h: 14, rx: 6 } },
  { id: 'shoulder-right', shape: { kind: 'rect', x: 46, y: 76, w: 32, h: 17, rx: 8 } },
  { id: 'shoulder-left', shape: { kind: 'rect', x: 122, y: 76, w: 32, h: 17, rx: 8 } },
  { id: 'chest', shape: { kind: 'rect', x: 76, y: 76, w: 48, h: 40, rx: 10 } },
  { id: 'abdomen', shape: { kind: 'rect', x: 78, y: 118, w: 44, h: 38, rx: 10 } },
  { id: 'pelvis', shape: { kind: 'rect', x: 76, y: 158, w: 48, h: 26, rx: 10 } },
  { id: 'upper-arm-right', shape: { kind: 'rect', x: 42, y: 95, w: 19, h: 48, rx: 9 } },
  { id: 'upper-arm-left', shape: { kind: 'rect', x: 139, y: 95, w: 19, h: 48, rx: 9 } },
  { id: 'forearm-right', shape: { kind: 'rect', x: 40, y: 146, w: 17, h: 44, rx: 8 } },
  { id: 'forearm-left', shape: { kind: 'rect', x: 143, y: 146, w: 17, h: 44, rx: 8 } },
  { id: 'hand-right', shape: { kind: 'ellipse', cx: 48, cy: 204, rx: 11, ry: 13 } },
  { id: 'hand-left', shape: { kind: 'ellipse', cx: 152, cy: 204, rx: 11, ry: 13 } },
  { id: 'thigh-right', shape: { kind: 'rect', x: 77, y: 186, w: 21, h: 62, rx: 10 } },
  { id: 'thigh-left', shape: { kind: 'rect', x: 102, y: 186, w: 21, h: 62, rx: 10 } },
  { id: 'lower-leg-right', shape: { kind: 'rect', x: 79, y: 251, w: 18, h: 58, rx: 8 } },
  { id: 'lower-leg-left', shape: { kind: 'rect', x: 103, y: 251, w: 18, h: 58, rx: 8 } },
  { id: 'foot-right', shape: { kind: 'rect', x: 74, y: 312, w: 23, h: 13, rx: 6 } },
  { id: 'foot-left', shape: { kind: 'rect', x: 103, y: 312, w: 23, h: 13, rx: 6 } },
];

const BACK: Placement[] = [
  { id: 'head', shape: { kind: 'ellipse', cx: 100, cy: 34, rx: 21, ry: 25 } },
  { id: 'neck', shape: { kind: 'rect', x: 90, y: 60, w: 20, h: 14, rx: 6 } },
  { id: 'shoulder-left', shape: { kind: 'rect', x: 46, y: 76, w: 32, h: 17, rx: 8 } },
  { id: 'shoulder-right', shape: { kind: 'rect', x: 122, y: 76, w: 32, h: 17, rx: 8 } },
  { id: 'upper-back', shape: { kind: 'rect', x: 76, y: 76, w: 48, h: 44, rx: 10 } },
  { id: 'lower-back', shape: { kind: 'rect', x: 78, y: 122, w: 44, h: 32, rx: 10 } },
  { id: 'buttocks', shape: { kind: 'rect', x: 76, y: 156, w: 48, h: 28, rx: 10 } },
  { id: 'upper-arm-left', shape: { kind: 'rect', x: 42, y: 95, w: 19, h: 48, rx: 9 } },
  { id: 'upper-arm-right', shape: { kind: 'rect', x: 139, y: 95, w: 19, h: 48, rx: 9 } },
  { id: 'forearm-left', shape: { kind: 'rect', x: 40, y: 146, w: 17, h: 44, rx: 8 } },
  { id: 'forearm-right', shape: { kind: 'rect', x: 143, y: 146, w: 17, h: 44, rx: 8 } },
  { id: 'hand-left', shape: { kind: 'ellipse', cx: 48, cy: 204, rx: 11, ry: 13 } },
  { id: 'hand-right', shape: { kind: 'ellipse', cx: 152, cy: 204, rx: 11, ry: 13 } },
  { id: 'thigh-left', shape: { kind: 'rect', x: 77, y: 186, w: 21, h: 62, rx: 10 } },
  { id: 'thigh-right', shape: { kind: 'rect', x: 102, y: 186, w: 21, h: 62, rx: 10 } },
  { id: 'lower-leg-left', shape: { kind: 'rect', x: 79, y: 251, w: 18, h: 58, rx: 8 } },
  { id: 'lower-leg-right', shape: { kind: 'rect', x: 103, y: 251, w: 18, h: 58, rx: 8 } },
  { id: 'foot-left', shape: { kind: 'rect', x: 74, y: 312, w: 23, h: 13, rx: 6 } },
  { id: 'foot-right', shape: { kind: 'rect', x: 103, y: 312, w: 23, h: 13, rx: 6 } },
];

export interface BodyMapProps {
  selected: readonly string[];
  onToggle: (regionId: string) => void;
  /** region id -> localized label */
  labels: Record<string, string>;
  viewLabels: { front: string; back: string };
  /** accessible name of the parallel checkbox group */
  legendLabel: string;
  /** "2 areas selected — chest, left forearm" - composed by the caller */
  summary: string;
}

function Figure({
  placements,
  title,
  selected,
  onToggle,
}: {
  placements: Placement[];
  title: string;
  selected: ReadonlySet<string>;
  onToggle: (regionId: string) => void;
}): ReactElement {
  return (
    <figure className="m-0 text-center">
      <svg viewBox="0 0 200 335" width={150} height={251} aria-hidden focusable="false">
        {placements.map(({ id, shape }) => {
          const cls = selected.has(id)
            ? 'cursor-pointer fill-teal stroke-teal-hover'
            : 'cursor-pointer fill-surface-sunken stroke-border hover:fill-teal-tint';
          return shape.kind === 'rect' ? (
            <rect
              key={id}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              rx={shape.rx}
              strokeWidth={1.5}
              className={cls}
              onClick={() => onToggle(id)}
            />
          ) : (
            <ellipse
              key={id}
              cx={shape.cx}
              cy={shape.cy}
              rx={shape.rx}
              ry={shape.ry}
              strokeWidth={1.5}
              className={cls}
              onClick={() => onToggle(id)}
            />
          );
        })}
      </svg>
      <figcaption className="text-xs uppercase tracking-wide text-muted">{title}</figcaption>
    </figure>
  );
}

export function BodyMap({
  selected,
  onToggle,
  labels,
  viewLabels,
  legendLabel,
  summary,
}: BodyMapProps): ReactElement {
  const selectedSet = new Set(selected);
  const allRegionIds = [...new Set([...FRONT, ...BACK].map((placement) => placement.id))];
  return (
    <div>
      <div className="flex justify-center gap-6">
        <Figure
          placements={FRONT}
          title={viewLabels.front}
          selected={selectedSet}
          onToggle={onToggle}
        />
        <Figure
          placements={BACK}
          title={viewLabels.back}
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
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
          {legendLabel}
        </legend>
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
