/** Environment configuration, parsed once at bootstrap. Fails loud. */
export interface ApiConfig {
  port: number;
  databaseUrl: string;
  /** HMAC pepper for OTP hashing - never the same secret as anything else. */
  otpPepper: string;
  cookieSecure: boolean;
  publicBaseUrl: string;
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
  };
}
