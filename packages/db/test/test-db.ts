/**
 * Test database provisioning. Order of preference:
 *  1. MIO_TEST_DATABASE_URL - an existing owner/superuser connection
 *     (local clusters, environments without Docker);
 *  2. Testcontainers postgres:17 - the version of record, used in CI.
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
