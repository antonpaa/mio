import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDevScanner,
  createFsStorage,
  createGcsStorage,
  signServiceAccountJwt,
  sniffImageMime,
} from '../src/index.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mio-storage-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fs storage', () => {
  it('round-trips bytes and returns null for the unknown', async () => {
    const storage = createFsStorage(root);
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await storage.put('quarantine/abc', bytes, 'application/octet-stream');
    expect(await storage.get('quarantine/abc')).toEqual(bytes);
    expect(await storage.get('quarantine/missing')).toBeNull();
    await storage.delete('quarantine/abc');
    expect(await storage.get('quarantine/abc')).toBeNull();
  });

  it('a key is an identifier, never a path - escapes are refused', async () => {
    const storage = createFsStorage(root);
    await expect(storage.put('../evil', new Uint8Array(1), 'x')).rejects.toThrow(/unsafe/);
    await expect(storage.get('/etc/passwd')).rejects.toThrow(/unsafe/);
  });
});

describe('sniffing', () => {
  it('recognises the four served image types by bytes, nothing by name', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
    expect(sniffImageMime(png)).toBe('image/png');
    expect(sniffImageMime(jpeg)).toBe('image/jpeg');
    expect(sniffImageMime(gif)).toBe('image/gif');
    expect(sniffImageMime(webp)).toBe('image/webp');
    // an executable claiming to be a picture is still not a picture
    expect(
      sniffImageMime(new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
  });
});

describe('dev scanner', () => {
  it('passes ordinary bytes and flags EICAR, so the rejection path stays testable', async () => {
    const scanner = createDevScanner();
    expect((await scanner.scan(new Uint8Array([1, 2, 3]))).verdict).toBe('clean');
    const eicar = new TextEncoder().encode(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );
    const result = await scanner.scan(eicar);
    expect(result.verdict).toBe('infected');
    expect(result.detail).toContain('Eicar');
  });
});

describe('gcs adapter', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    client_email: 'mio@test-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.test/token',
  };

  it('signs a verifiable RS256 service-account JWT', () => {
    const jwt = signServiceAccountJwt(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const parsed = JSON.parse(Buffer.from(claims!, 'base64url').toString()) as {
      iss: string;
      aud: string;
      exp: number;
    };
    expect(parsed.iss).toBe(account.client_email);
    expect(parsed.aud).toBe(account.token_uri);
    expect(parsed.exp).toBe(1_700_000_000 + 3600);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it('exchanges the JWT once, then uploads and reads with the bearer', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init !== undefined ? { init } : {}) });
      if (String(url) === account.token_uri) {
        return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (String(url).includes('/upload/')) return new Response('{}', { status: 200 });
      return new Response(new Uint8Array([9, 9]).buffer, { status: 200 });
    }) as typeof fetch;
    const storage = createGcsStorage({ bucket: 'mio-attachments', account, fetchFn });

    await storage.put('quarantine/k1', new Uint8Array([1]), 'image/png');
    const got = await storage.get('quarantine/k1');
    expect(got).toEqual(new Uint8Array([9, 9]));

    // one token exchange serves both calls (cached until expiry)
    expect(calls.filter((call) => call.url === account.token_uri)).toHaveLength(1);
    const put = calls.find((call) => call.url.includes('/upload/'))!;
    expect(put.url).toContain('b/mio-attachments/o');
    expect(put.url).toContain('name=quarantine%2Fk1');
    expect((put.init?.headers as Record<string, string>)['authorization']).toBe('Bearer tok-1');
    const read = calls.find((call) => call.url.includes('alt=media'))!;
    expect(read.url).toContain('/o/quarantine%2Fk1');
  });
});
