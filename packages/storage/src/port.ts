/**
 * The object-storage PORT (ADR-0010): the application speaks this
 * interface and nothing narrower than it. The filesystem adapter serves
 * dev and tests; the GCS adapter serves deployments; a swap to Azure
 * Blob is one more adapter behind the same seam - that is the whole
 * point of the port.
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * The scanner PORT for the quarantine pipeline (WP-24). ClamAV over
 * clamd's TCP protocol in deployments; the dev scanner passes
 * everything except the EICAR test file, so the rejection path stays
 * exercisable everywhere.
 */
export interface ScanResult {
  verdict: 'clean' | 'infected';
  /** scanner identity + signature for the audit trail */
  detail: string;
}

export interface Scanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}
