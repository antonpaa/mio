/**
 * Architecture boundary rules (ADR-0002). CI fails on violations - the
 * boundaries are enforced, not encouraged.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-app-to-app',
      comment: 'Apps are separate deployables; they share code only through packages/.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-package-to-app',
      comment: 'Shared packages must not depend on any app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'api-module-public-interface',
      comment:
        'API modules are imported only through their public index (docs/architecture/overview.md). ' +
        'Deep imports across module boundaries are the erosion this rule exists to stop.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/.+',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.(ts|js)$'],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'ui-stays-presentational',
      comment: 'The design system must not know about domain packages.',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/(contracts|survey-schema|authz)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(test|spec)\\.tsx?$|vitest\\.config\\.ts$|vite\\.config\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'types'],
    },
  },
};
