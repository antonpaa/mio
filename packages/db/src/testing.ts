/**
 * Test-only helpers ('@mio/db/testing') - never import from runtime code.
 * Provisioning order: MIO_TEST_DATABASE_URL (existing owner cluster), else
 * Testcontainers postgres:17 (the version of record, used where Docker
 * exists).
 */

export interface TestDatabase {
  connectionString: string;
  stop: () => Promise<void>;
}

export async function provisionTestDatabase(): Promise<TestDatabase> {
  const external = process.env['MIO_TEST_DATABASE_URL'];
  if (external) {
    return { connectionString: external, stop: async () => {} };
  }
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  return {
    connectionString: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
