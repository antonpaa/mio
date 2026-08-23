import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkInvariants, defaultMatrixPath, grantCount, loadMatrix } from '../src/matrix.js';
import { generateArtifacts } from '../src/generate.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('capability matrix', () => {
  const matrix = loadMatrix(defaultMatrixPath(REPO_ROOT));

  it('satisfies its six declared invariants', () => {
    expect(checkInvariants(matrix)).toEqual([]);
  });

  it('is fully explicit', () => {
    expect(grantCount(matrix)).toBeGreaterThanOrEqual(324);
  });

  it('generated artifacts are fresh (regenerate: pnpm --filter @mio/authz generate)', () => {
    for (const artifact of generateArtifacts()) {
      const onDisk = readFileSync(artifact.filePath, 'utf8');
      expect(onDisk, `${path.relative(REPO_ROOT, artifact.filePath)} is stale`).toBe(
        artifact.content,
      );
    }
  });
});
