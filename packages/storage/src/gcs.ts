import { createSign } from 'node:crypto';
import type { ObjectStorage } from './port.js';

/**
 * GCS adapter over the JSON API with service-account JWT auth -
 * hand-rolled with node:crypto and fetch (ADR-0009: the platform over a
 * dependency; the exchange is two documented HTTP calls). D1 chose GCP;
 * a swap to Azure Blob is a sibling adapter behind the same port, which
 * is why nothing GCS-specific leaks past this file.
 */

export interface GcsServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface GcsOptions {
  bucket: string;
  account: GcsServiceAccount;
  /** injectable for tests; defaults to global fetch */
  fetchFn?: typeof fetch;
  apiBase?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** RS256 service-account JWT for the OAuth token exchange. */
export function signServiceAccountJwt(
  account: GcsServiceAccount,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

export function createGcsStorage(options: GcsOptions): ObjectStorage {
  const fetchFn = options.fetchFn ?? fetch;
  const apiBase = options.apiBase ?? 'https://storage.googleapis.com';
  let token: { value: string; expiresAt: number } | null = null;

  const accessToken = async (): Promise<string> => {
    const now = Date.now();
    if (token !== null && token.expiresAt - 60_000 > now) return token.value;
    const jwt = signServiceAccountJwt(options.account);
    const response = await fetchFn(options.account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    if (!response.ok) throw new Error(`gcs token exchange: ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return token.value;
  };

  const objectUrl = (key: string): string =>
    `${apiBase}/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodeURIComponent(key)}`;

  return {
    async put(key, bytes, contentType) {
      const bearer = await accessToken();
      const url =
        `${apiBase}/upload/storage/v1/b/${encodeURIComponent(options.bucket)}/o` +
        `?uploadType=media&name=${encodeURIComponent(key)}`;
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': contentType },
        // Buffer view keeps undici happy without DOM lib types
        body: Buffer.from(bytes),
      });
      if (!response.ok) throw new Error(`gcs put: ${response.status}`);
    },
    async get(key) {
      const bearer = await accessToken();
      const response = await fetchFn(`${objectUrl(key)}?alt=media`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`gcs get: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(key) {
      const bearer = await accessToken();
      const response = await fetchFn(objectUrl(key), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bearer}` },
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`gcs delete: ${response.status}`);
      }
    },
  };
}
