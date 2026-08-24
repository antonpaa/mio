import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { ObjectStorage } from './port.js';

/**
 * Filesystem adapter: dev and tests. Keys are validated against path
 * escape - a key is an opaque identifier, never a path the caller
 * controls.
 */
export function createFsStorage(root: string): ObjectStorage {
  const resolve = (key: string): string => {
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    const full = normalize(join(root, key));
    if (!full.startsWith(normalize(root) + sep)) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    return full;
  };
  return {
    async put(key, bytes) {
      const path = resolve(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
