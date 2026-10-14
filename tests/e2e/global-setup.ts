import { sql } from 'drizzle-orm';
import { createTestDatabase } from '../support/db';

/** The web server starts before global setup but touches the database only on the first test request. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const database = await createTestDatabase(process.env.E2E_DATABASE_NAME);
  return async () => {
    const { rows } = await database.db.execute<{ users: number }>(
      sql`select count(*)::int as users from users`,
    );
    console.log(
      `e2e database ${process.env.E2E_DATABASE_NAME}: ${rows[0].users} users before drop`,
    );
    await database.close();
  };
}
