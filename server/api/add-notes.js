// Takes the live gdm-api index.mjs and inserts the notes feature into it.
// Run with: node add-notes.js in.mjs out.mjs
const fs = require('fs');
const [,, inp, outp] = process.argv;
let s = fs.readFileSync(inp, 'utf8');

const hasNotes = s.indexOf("notes.create") >= 0;
const hasSchema = s.indexOf("admin.schema") >= 0;
if (hasNotes && hasSchema) { fs.writeFileSync(outp, s); console.log('ALREADY'); process.exit(0); }

const SQL = `
const SQL_007 = \`
create table if not exists app.notes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references app.users(id) on delete cascade,
  side text not null default 'home',
  big text not null default 'property',
  title text not null default '',
  body text not null default '',
  photos text[] not null default '{}',
  vkey text not null default '',
  ckey text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists notes_new on app.notes (created_at desc);
alter table app.notes enable row level security;
grant select, insert, delete on app.notes to app_user;
drop policy if exists notes_read on app.notes;
create policy notes_read on app.notes for select to app_user using (true);
drop policy if exists notes_add on app.notes;
create policy notes_add on app.notes for insert to app_user with check (owner = app.uid());
drop policy if exists notes_del on app.notes;
create policy notes_del on app.notes for delete to app_user using (owner = app.uid());
create table if not exists app.note_likes (
  note_id uuid not null references app.notes(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  primary key (note_id, user_id)
);
alter table app.note_likes enable row level security;
grant select, insert, delete on app.note_likes to app_user;
drop policy if exists nl_read on app.note_likes;
create policy nl_read on app.note_likes for select to app_user using (true);
drop policy if exists nl_add on app.note_likes;
create policy nl_add on app.note_likes for insert to app_user with check (user_id = app.uid());
drop policy if exists nl_del on app.note_likes;
create policy nl_del on app.note_likes for delete to app_user using (user_id = app.uid());
\`;
const N_COLS = 'n.id, n.owner, n.side, n.big, n.title, n.body, n.photos, n.vkey, n.ckey, n.created_at';
const N_INS = 'id, owner, side, big, title, body, photos, vkey, ckey, created_at';
`;

// 1) put the SQL and columns just above the handler
if (!hasNotes) {
const hAt = s.indexOf('export const handler');
if (hAt < 0) { console.error('no handler'); process.exit(1); }
s = s.slice(0, hAt) + SQL + '\n' + s.slice(hAt);

// 2) migration entry point (invoked directly, not through the URL)
const mark = "    const method = event.requestContext?.http?.method || 'POST';";
const mark2 = "const method = event.requestContext?.http?.method || 'POST';";
const use = s.indexOf(mark) >= 0 ? mark : mark2;
s = s.replace(use,
  "if (!event.requestContext && event && event.action === 'admin.migrate007') {\n" +
  "  const c = await (await db()).connect();\n" +
  "  try { await c.query(SQL_007); } finally { c.release(); }\n" +
  "  return { ok: true, ran: 'notes' };\n" +
  "}\n" + use);

// 3) public read of the feed
const listAnchor = "if (q.action === 'works.list') {";
const notesList =
  "if (q.action === 'notes.list') {\n" +
  "  const r = await asUser(uid, (c) => c.query(\n" +
  "    `select ${N_COLS}, coalesce(w.name, '') as by_name,\n" +
  "       (select count(*) from app.note_likes l where l.note_id = n.id) as likes,\n" +
  "       (case when $1::uuid is null then false else exists (select 1 from app.note_likes l where l.note_id = n.id and l.user_id = $1::uuid) end) as liked\n" +
  "     from app.notes n left join app.workers w on w.owner = n.owner\n" +
  "     order by n.created_at desc limit 300`, [uid]));\n" +
  "  return out(200, { rows: r.rows });\n" +
  "}\n";
s = s.replace(listAnchor, notesList + listAnchor);

// 4) write actions
const addAnchor = "if (q.action === 'works.create') {";
const notesWrite =
  "if (q.action === 'notes.create') {\n" +
  "  const n = q.note || {};\n" +
  "  const photos = Array.isArray(n.photos) ? n.photos.slice(0, 9).map(String) : [];\n" +
  "  const r = await asUser(uid, (c) => c.query(\n" +
  "    `insert into app.notes (owner, side, big, title, body, photos, vkey, ckey)\n" +
  "     values (app.uid(), $1,$2,$3,$4,$5,$6,$7) returning ${N_INS}`,\n" +
  "    [n.side === 'public' ? 'public' : (n.side === 'worker' ? 'worker' : 'home'), n.big || 'property',\n" +
  "     String(n.title || '').slice(0, 200), String(n.body || '').slice(0, 4000), photos,\n" +
  "     String(n.vkey || ''), String(n.ckey || '')]));\n" +
  "  return out(200, { row: r.rows[0] });\n" +
  "}\n" +
  "if (q.action === 'notes.delete') {\n" +
  "  await asUser(uid, (c) => c.query('delete from app.notes where id = $1 and owner = app.uid()', [q.id]));\n" +
  "  return out(200, { ok: true });\n" +
  "}\n" +
  "if (q.action === 'notes.like') {\n" +
  "  await asUser(uid, (c) => q.on\n" +
  "    ? c.query('insert into app.note_likes (note_id, user_id) values ($1, app.uid()) on conflict do nothing', [q.id])\n" +
  "    : c.query('delete from app.note_likes where note_id = $1 and user_id = app.uid()', [q.id]));\n" +
  "  return out(200, { ok: true });\n" +
  "}\n";
s = s.replace(addAnchor, notesWrite + addAnchor);
}



// A read-only listing of what the database holds, so the project record can be written from facts.
if (!hasSchema) {
  const mk2 = "const method = event.requestContext?.http?.method || 'POST';";
  const at2 = s.indexOf(mk2);
  if (at2 >= 0) {
    s = s.slice(0, at2) +
      "if (!event.requestContext && event && event.action === 'admin.schema') {\n" +
      "  const c = await (await db()).connect();\n" +
      "  try {\n" +
      "    const cols = await c.query(\"select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'app' order by table_name, ordinal_position\");\n" +
      "    const cnt = await c.query(\"select relname as t, n_live_tup as rows from pg_stat_user_tables where schemaname = 'app' order by relname\");\n" +
      "    const fns = await c.query(\"select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' order by 1\");\n" +
      "    const pol = await c.query(\"select tablename, policyname, cmd from pg_policies where schemaname = 'app' order by tablename, policyname\");\n" +
      "    return { ok: true, columns: cols.rows, counts: cnt.rows, functions: fns.rows.map((r) => r.name), policies: pol.rows };\n" +
      "  } finally { c.release(); }\n" +
      "}\n" + s.slice(at2);
  }
}

fs.writeFileSync(outp, s);
console.log('PATCHED', s.length);
