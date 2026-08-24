/** Environment configuration, parsed once at bootstrap. Fails loud. */
export interface ApiConfig {
  port: number;
  databaseUrl: string;
  /** HMAC pepper for OTP hashing - never the same secret as anything else. */
  otpPepper: string;
  cookieSecure: boolean;
  publicBaseUrl: string;
  /** filesystem storage root (dev/tests); a GCS bucket takes over in
   * deployments via MIO_GCS_BUCKET + MIO_GCS_KEY_FILE (WP-24) */
  storageDir: string;
  gcsBucket: string | null;
  gcsKeyFile: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env['MIO_DATABASE_URL'];
  if (!databaseUrl) throw new Error('MIO_DATABASE_URL is required');
  const otpPepper = env['MIO_OTP_PEPPER'] ?? '';
  if (otpPepper.length < 16) {
    throw new Error('MIO_OTP_PEPPER is required (>=16 chars)');
  }
  return {
    port: Number(env['PORT'] ?? 3000),
    databaseUrl,
    otpPepper,
    cookieSecure: env['MIO_COOKIE_SECURE'] !== 'false',
    publicBaseUrl: env['MIO_PUBLIC_BASE_URL'] ?? 'http://localhost:5173',
    storageDir: env['MIO_STORAGE_DIR'] ?? '.storage-dev',
    gcsBucket: env['MIO_GCS_BUCKET'] ?? null,
    gcsKeyFile: env['MIO_GCS_KEY_FILE'] ?? null,
  };
}
