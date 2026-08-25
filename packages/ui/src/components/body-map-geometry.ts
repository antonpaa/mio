/**
 * The body-map figures (B3/P4/C7 reference): two organic silhouettes
 * whose regions TILE the body - every stroke between two regions is a
 * shared edge, so the segmentation lines read as the figure's anatomy
 * rather than as boxes floating near it. All paths use absolute
 * M/L/C commands with "x,y" pairs only, because the left half of each
 * figure is produced by reflecting the right half across the vertical
 * midline (x = 100 in the 200-wide viewBox) - symmetry is guaranteed by
 * construction, not by hand-matching coordinates.
 *
 * Region ids are the platform vocabulary from @mio/survey-schema and
 * MUST NOT change here: stored answers and template critical-area
 * configuration reference them.
 */

export const BODY_VIEWBOX = '0 0 200 340';

const round = (value: number): number => Math.round(value * 10) / 10;

/** Reflect a path across the figure midline. Only "x,y" pairs move. */
export function mirrorX(d: string): string {
  return d.replace(
    /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,
    (_match, x: string, y: string) => `${round(200 - Number(x))},${y}`,
  );
}

export interface RegionPath {
  id: string;
  d: string;
}

// -- centre pieces (already symmetric) -----------------------------------

const HEAD =
  'M100,9 C110,9 116,16.5 116,27 C116,34.5 113.2,40.8 109,44.8 ' +
  'C106.4,47.3 103.3,48.5 100,48.5 C96.7,48.5 93.6,47.3 91,44.8 ' +
  'C86.8,40.8 84,34.5 84,27 C84,16.5 90,9 100,9 Z';

const NECK =
  'M92.4,44 C92.7,48.3 91.9,52.3 89.5,56 L110.5,56 ' +
  'C108.1,52.3 107.3,48.3 107.6,44 C105.4,47 102.9,48.5 100,48.5 ' +
  'C97.1,48.5 94.6,47 92.4,44 Z';

const CHEST =
  'M89.5,56 L110.5,56 C116.5,60 121.5,63.5 125,68 L125.5,86 ' +
  'C125.7,94 125.4,102.5 124.5,110 C116.5,114.6 108.3,116.8 100,116.8 ' +
  'C91.7,116.8 83.5,114.6 75.5,110 C74.6,102.5 74.3,94 74.5,86 L75,68 ' +
  'C78.5,63.5 83.5,60 89.5,56 Z';

const ABDOMEN =
  'M75.5,110 C83.5,114.6 91.7,116.8 100,116.8 C108.3,116.8 116.5,114.6 124.5,110 ' +
  'C123.4,117.5 122.9,125 123.1,132.5 C123.3,138.5 123.9,144.5 125,150 ' +
  'C117,154.4 108.7,156.6 100,156.6 C91.3,156.6 83,154.4 75,150 ' +
  'C76.1,144.5 76.7,138.5 76.9,132.5 C77.1,125 76.6,117.5 75.5,110 Z';

const PELVIS =
  'M75,150 C83,154.4 91.3,156.6 100,156.6 C108.7,156.6 117,154.4 125,150 ' +
  'C126.3,155 127.2,160.5 127.6,166.5 C127.9,172 127.4,177 126.2,181.5 ' +
  'L103.2,187.5 C101.8,185.2 100.7,184 100,184 C99.3,184 98.2,185.2 96.8,187.5 ' +
  'L73.8,181.5 C72.6,177 72.1,172 72.4,166.5 C72.8,160.5 73.7,155 75,150 Z';

const UPPER_BACK =
  'M89.5,56 L110.5,56 C116.5,60 121.5,63.5 125,68 L125.5,86 ' +
  'C125.7,97 125.3,110 124.4,122 C116.4,125.2 108.2,126.8 100,126.8 ' +
  'C91.8,126.8 83.6,125.2 75.6,122 C74.7,110 74.3,97 74.5,86 L75,68 ' +
  'C78.5,63.5 83.5,60 89.5,56 Z';

const LOWER_BACK =
  'M75.6,122 C83.6,125.2 91.8,126.8 100,126.8 C108.2,126.8 116.4,125.2 124.4,122 ' +
  'C124,128.5 123.9,135 124.2,141.5 C124.4,146 124.7,150.5 125.2,154.5 ' +
  'C117.2,158.6 108.8,160.6 100,160.6 C91.2,160.6 82.8,158.6 74.8,154.5 ' +
  'C75.3,150.5 75.6,146 75.8,141.5 C76.1,135 76,128.5 75.6,122 Z';

const BUTTOCKS =
  'M74.8,154.5 C82.8,158.6 91.2,160.6 100,160.6 C108.8,160.6 117.2,158.6 125.2,154.5 ' +
  'C126.5,159.5 127.4,165 127.7,171 C128,178.5 126.7,185.5 123.8,190 ' +
  'C117.5,194.3 109.8,196 103,194 C101.8,193.6 100.8,192.8 100,191.6 ' +
  'C99.2,192.8 98.2,193.6 97,194 C90.2,196 82.5,194.3 76.2,190 ' +
  'C73.3,185.5 72,178.5 72.3,171 C72.6,165 73.5,159.5 74.8,154.5 Z';

// -- side pieces, drawn on the VIEWER-LEFT half and mirrored -------------

const SHOULDER_L =
  'M89.5,56 C78.5,58.8 68.5,62.5 61.8,67.5 C57.6,70.6 55,75.8 54,82 ' +
  'L74,89.5 L75,68 C78.5,63.5 83.5,60 89.5,56 Z';

const UPPER_ARM_L =
  'M54,82 C48.3,93 43.5,106 39.8,119 C38.4,124 37.2,128.8 36.2,133.2 ' +
  'L51.8,137.8 C54,127.8 56.8,117 60.2,107 C63.2,98 67.8,92.2 74,89.5 Z';

const FOREARM_L =
  'M36.2,133.2 C33.4,142.5 30.8,153 28.8,163 C27.7,168.5 26.9,173.8 26.4,178.5 ' +
  'L37.8,181.8 C40.4,173 43.2,162.5 45.9,152.5 C47.9,145 49.9,140.1 51.8,137.8 Z';

const HAND_L =
  'M26.4,178.5 L37.8,181.8 C39.2,185.8 39.8,190.3 39.5,195 ' +
  'C39.2,200.5 37.4,205.8 34.5,210.2 C32.9,212.5 30.7,213.4 28.4,212.7 ' +
  'C25.8,211.9 23.7,209.5 22.5,206.2 C21.1,202 20.6,197 21.1,191.8 ' +
  'C19.1,191.1 17.9,189.5 17.9,187.3 C17.9,184.6 19.6,182.6 22.3,182.2 ' +
  'L24.6,181.9 C25.1,180.6 25.7,179.4 26.4,178.5 Z';

const THIGH_FRONT_L =
  'M73.8,181.5 C81.5,183.5 89.2,185.5 96.8,187.5 C98.2,185.2 99.3,184 100,184 ' +
  'C99.8,190 99.5,196 99.2,202 C98.5,216 97.9,231 97.5,246 ' +
  'L77.5,248 C76.2,232 75,215.5 74.3,200 C74,193.8 73.8,187.6 73.8,181.5 Z';

const LOWER_LEG_FRONT_L =
  'M77.5,248 C76,256.5 75.7,265.5 76.7,274.5 C78,288 80.6,302 84.2,315 ' +
  'L93.2,314 C94.9,302 96,289 96.6,276 C97,266.6 97.3,257.3 97.5,246 Z';

const FOOT_FRONT_L =
  'M84.2,315 C80.6,319 77,323.3 74.7,327.5 C73.3,330.2 74.3,332.5 77.2,333.3 ' +
  'C82.4,334.7 88,334.7 92.4,333.5 C94.4,332.9 95.3,331.3 95.1,329 ' +
  'C94.6,324 94,319 93.2,314 Z';

const THIGH_BACK_L =
  'M76.2,190 C82.5,194.3 90.2,196 97,194 C98.2,193.6 99.2,192.8 100,191.6 ' +
  'C99.8,197.4 99.5,203.2 99.2,209 C98.5,222 97.9,235 97.5,248 ' +
  'L77.5,250 C76.4,235 75.4,219.5 74.9,205 C74.7,199.9 75.2,194.9 76.2,190 Z';

const LOWER_LEG_BACK_L =
  'M77.5,250 C76,258.5 75.7,267 76.7,276 C78,289 80.6,302.5 84.2,315 ' +
  'L93.2,314 C94.9,302.5 96,289.5 96.6,277 C97,267.5 97.3,258.6 97.5,248 Z';

/** From behind only the heel and sole show; they stay attached to the
 * ankle - a floating sole reads as an amputation, not a foot. */
const FOOT_BACK_L =
  'M84.2,315 C82.7,319.5 82.1,324 82.5,328.5 C82.8,331.6 84.7,333.4 87.7,333.7 ' +
  'C90.3,333.9 92.7,333.4 94.2,332 C95.5,330.6 95.9,327.8 95.7,324 ' +
  'C95.5,320.6 94.7,317.2 93.2,314 Z';

// -- assembled views -----------------------------------------------------
// FRONT faces the viewer: the patient's RIGHT side is on the viewer's
// LEFT. BACK is seen from behind: patient's left = viewer's left.

function sided(
  view: 'front' | 'back',
  suffix: string,
  viewerLeftPath: string,
): [RegionPath, RegionPath] {
  const viewerLeftIsPatientRight = view === 'front';
  return [
    { id: `${suffix}-${viewerLeftIsPatientRight ? 'right' : 'left'}`, d: viewerLeftPath },
    { id: `${suffix}-${viewerLeftIsPatientRight ? 'left' : 'right'}`, d: mirrorX(viewerLeftPath) },
  ];
}

export const FRONT_REGIONS: readonly RegionPath[] = [
  { id: 'head', d: HEAD },
  { id: 'neck', d: NECK },
  ...sided('front', 'shoulder', SHOULDER_L),
  { id: 'chest', d: CHEST },
  { id: 'abdomen', d: ABDOMEN },
  { id: 'pelvis', d: PELVIS },
  ...sided('front', 'upper-arm', UPPER_ARM_L),
  ...sided('front', 'forearm', FOREARM_L),
  ...sided('front', 'hand', HAND_L),
  ...sided('front', 'thigh', THIGH_FRONT_L),
  ...sided('front', 'lower-leg', LOWER_LEG_FRONT_L),
  ...sided('front', 'foot', FOOT_FRONT_L),
];

export const BACK_REGIONS: readonly RegionPath[] = [
  { id: 'head', d: HEAD },
  { id: 'neck', d: NECK },
  ...sided('back', 'shoulder', SHOULDER_L),
  { id: 'upper-back', d: UPPER_BACK },
  { id: 'lower-back', d: LOWER_BACK },
  { id: 'buttocks', d: BUTTOCKS },
  ...sided('back', 'upper-arm', UPPER_ARM_L),
  ...sided('back', 'forearm', FOREARM_L),
  ...sided('back', 'hand', HAND_L),
  ...sided('back', 'thigh', THIGH_BACK_L),
  ...sided('back', 'lower-leg', LOWER_LEG_BACK_L),
  ...sided('back', 'foot', FOOT_BACK_L),
];
