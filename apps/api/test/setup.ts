// Config defaults for tests that boot AppModule without touching the
// database (pg.Pool is lazy - nothing connects until a query runs). Tests
// that DO hit the database overwrite these in their beforeAll.
process.env['MIO_DATABASE_URL'] ??= 'postgres://placeholder@localhost:5432/placeholder';
process.env['MIO_OTP_PEPPER'] ??= 'test-pepper-not-for-production';
process.env['MIO_COOKIE_SECURE'] ??= 'false';
