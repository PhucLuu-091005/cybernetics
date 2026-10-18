// Deletes the demo copies (AUTH_MODE=demo) made more than N days ago. Run by hand, not by a cron job.
// Usage: DATABASE_URL=... node scripts/delete-demo-sandboxes.mjs [--days 30] [--apply]
// Without --apply it only counts. Steps and numbers: docs/deploy-cloud-run-neon.md.
import pg from 'pg';

const args = process.argv.slice(2);
const at = args.indexOf('--days');
const days = at === -1 ? 30 : Number(args[at + 1]);
const apply = args.includes('--apply');
if (!Number.isInteger(days) || days < 1) {
  console.error('--days must be a whole number of days, 1 or more');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

// Children before parents, read from the foreign keys, so a new tenant table needs no change here.
async function tenantTablesInDeleteOrder(client) {
  const { rows: tables } = await client.query(
    `select table_name as name from information_schema.columns
     where table_schema = 'public' and column_name = 'workspace_id' and table_name <> 'workspace_members'`,
  );
  const { rows: edges } = await client.query(
    `select conrelid::regclass::text as child, confrelid::regclass::text as parent
     from pg_constraint where contype = 'f' and conrelid <> confrelid`,
  );
  const left = new Set(tables.map((t) => t.name));
  const order = [];
  while (left.size) {
    const next = [...left].filter(
      (table) => !edges.some((e) => e.parent === table && e.child !== table && left.has(e.child)),
    );
    if (!next.length) throw new Error(`Foreign keys form a cycle among: ${[...left].join(', ')}`);
    for (const table of next.sort()) {
      order.push(table);
      left.delete(table);
    }
  }
  return order;
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});
client.on('error', () => {});
try {
  await client.connect();
  await client.query('begin');
  await client.query(
    `create temp table doomed_users on commit drop as
     select id from users where subject like 'demo:%' and created_at < now() - make_interval(days => $1)`,
    [days],
  );
  // A workspace goes only when every one of its people goes with it.
  await client.query(
    `create temp table doomed_workspaces on commit drop as
     select distinct m.workspace_id as id from workspace_members m
     where m.user_id in (select id from doomed_users)
       and not exists (select 1 from workspace_members o
                       where o.workspace_id = m.workspace_id
                         and o.user_id not in (select id from doomed_users))`,
  );
  const count = async (table) =>
    (await client.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  const people = await count('doomed_users');
  const workspaces = await count('doomed_workspaces');
  if (apply) {
    for (const table of await tenantTablesInDeleteOrder(client))
      await client.query(
        `delete from ${pg.escapeIdentifier(table)} where workspace_id in (select id from doomed_workspaces)`,
      );
    await client.query(
      `delete from workspace_members
       where workspace_id in (select id from doomed_workspaces) or user_id in (select id from doomed_users)`,
    );
    await client.query('delete from workspaces where id in (select id from doomed_workspaces)');
    await client.query('delete from users where id in (select id from doomed_users)');
    await client.query('commit');
  } else await client.query('rollback');
  console.log(
    JSON.stringify({ event: 'demo_sandboxes', days, people, workspaces, deleted: apply }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
