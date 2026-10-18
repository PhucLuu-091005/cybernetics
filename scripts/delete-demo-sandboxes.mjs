// Deletes the demo copies (AUTH_MODE=demo) made more than N days ago. Run by hand, not by a cron job.
// Usage: DATABASE_URL=... node scripts/delete-demo-sandboxes.mjs [--days 30] [--apply]
// Without --apply it only counts. Steps and numbers: docs/deploy-cloud-run-neon.md.
// Profile photos go too: AVATAR_BUCKET=<bucket> deletes them with gcloud, AVATAR_STORE=local from
// AVATAR_DIR; without either, the script lists the photo objects it leaves behind.
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

const PHOTO_KEY = /^avatars\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/;

/** Deletes the photo objects of the deleted people; returns how many went. */
async function deletePhotos(keys) {
  const valid = keys.filter((key) => PHOTO_KEY.test(key));
  if (!valid.length) return 0;
  const left = (why, rest) =>
    console.error(JSON.stringify({ event: 'demo_photos_left', why, keys: rest }));
  if (process.env.AVATAR_BUCKET) {
    const bucket = process.env.AVATAR_BUCKET;
    let done = 0;
    for (let at = 0; at < valid.length; at += 100) {
      const batch = valid.slice(at, at + 100);
      const result = spawnSync(
        'gcloud',
        ['storage', 'rm', '--quiet', ...batch.map((key) => `gs://${bucket}/${key}`)],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      if (result.status !== 0) {
        process.exitCode = 1;
        left('gcloud storage rm failed', valid.slice(at));
        return done;
      }
      done += batch.length;
    }
    return done;
  }
  if (process.env.AVATAR_STORE === 'local') {
    const root = resolve(process.env.AVATAR_DIR || '.avatars');
    for (const key of valid) await rm(join(root, key), { force: true });
    return valid.length;
  }
  left('set AVATAR_BUCKET (or AVATAR_STORE=local) to delete them', valid);
  return 0;
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
  const photos = (
    await client.query(
      `select avatar_key as key from users
       where id in (select id from doomed_users) and avatar_key is not null order by avatar_key`,
    )
  ).rows.map((row) => row.key);
  if (apply) {
    for (const table of await tenantTablesInDeleteOrder(client))
      await client.query(
        `delete from ${pg.escapeIdentifier(table)} where workspace_id in (select id from doomed_workspaces)`,
      );
    // A personal key keeps its person's home workspace, but goes with its person in any case.
    await client.query('delete from agent_tokens where user_id in (select id from doomed_users)');
    await client.query(
      `delete from workspace_members
       where workspace_id in (select id from doomed_workspaces) or user_id in (select id from doomed_users)`,
    );
    await client.query('delete from workspaces where id in (select id from doomed_workspaces)');
    await client.query('delete from users where id in (select id from doomed_users)');
    await client.query('commit');
  } else await client.query('rollback');
  // The rows are gone first: a photo object that stays is unreachable, a row without its object is not.
  const photosDeleted = apply ? await deletePhotos(photos) : 0;
  console.log(
    JSON.stringify({
      event: 'demo_sandboxes',
      days,
      people,
      workspaces,
      photos: photos.length,
      ...(apply ? { photosDeleted } : {}),
      deleted: apply,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
