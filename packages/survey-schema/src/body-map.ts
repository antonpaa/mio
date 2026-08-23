/**
 * The body map region catalogue (docs/architecture/surveys-and-alerts.md,
 * B3/P4/C7): head / trunk / limb granularity, sided L/R where applicable.
 * Region IDS are platform vocabulary - stable, language-neutral; their
 * labels live in the apps' i18n, and each region keeps room for a SNOMED
 * CT body-structure code (filled in when the coding pass lands).
 */

export type BodyView = 'front' | 'back';
export type BodySide = 'left' | 'right';

export interface BodyRegion {
  id: string;
  /** which figure(s) the region is selectable on */
  views: BodyView[];
  side?: BodySide;
  /** SNOMED CT body structure code, when assigned */
  snomed?: string;
}

export const BODY_REGIONS: readonly BodyRegion[] = [
  { id: 'head', views: ['front', 'back'] },
  { id: 'neck', views: ['front', 'back'] },
  { id: 'chest', views: ['front'] },
  { id: 'abdomen', views: ['front'] },
  { id: 'pelvis', views: ['front'] },
  { id: 'upper-back', views: ['back'] },
  { id: 'lower-back', views: ['back'] },
  { id: 'buttocks', views: ['back'] },
  { id: 'shoulder-left', views: ['front', 'back'], side: 'left' },
  { id: 'shoulder-right', views: ['front', 'back'], side: 'right' },
  { id: 'upper-arm-left', views: ['front', 'back'], side: 'left' },
  { id: 'upper-arm-right', views: ['front', 'back'], side: 'right' },
  { id: 'forearm-left', views: ['front', 'back'], side: 'left' },
  { id: 'forearm-right', views: ['front', 'back'], side: 'right' },
  { id: 'hand-left', views: ['front', 'back'], side: 'left' },
  { id: 'hand-right', views: ['front', 'back'], side: 'right' },
  { id: 'thigh-left', views: ['front', 'back'], side: 'left' },
  { id: 'thigh-right', views: ['front', 'back'], side: 'right' },
  { id: 'lower-leg-left', views: ['front', 'back'], side: 'left' },
  { id: 'lower-leg-right', views: ['front', 'back'], side: 'right' },
  { id: 'foot-left', views: ['front', 'back'], side: 'left' },
  { id: 'foot-right', views: ['front', 'back'], side: 'right' },
] as const;

export const BODY_REGION_IDS: ReadonlySet<string> = new Set(
  BODY_REGIONS.map((region) => region.id),
);
