// Adds the tradie verification feature (app.verify) to the live gdm-api Lambda.
// Run with: node add-verify.js in.mjs out.mjs
const fs = require('fs');
const [,, inp, outp] = process.argv;
let s = fs.readFileSync(inp, 'utf8');

if (s.indexOf('verify.mine') >= 0) { fs.writeFileSync(outp, s); console.log('ALREADY'); process.exit(0); }

const SQL = `
const SQL_008 = \`
create table if not exists app.verify (
  owner uuid not null references app.users(id) on delete cascade,
  kind text not null,
  st text not null default 'pend',
  keys text[] not null default '{}',
  num text not null default '',
  expiry date,
  why text not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner, kind)
);
create index if not exists verify_pend on app.verify (st, updated_at);
alter table app.verify enable row level security;
grant select, insert, update on app.verify to app_user;
drop policy if exists verify_read on app.verify;
create policy verify_read on app.verify for select to app_user using (owner = app.uid());
drop policy if exists verify_add on app.verify;
create policy verify_add on app.verify for insert to app_user with check (owner = app.uid());
drop policy if exists verify_upd on app.verify;
create policy verify_upd on app.verify for update to app_user using (owner = app.uid()) with check (owner = app.uid());
\`;
const V_COLS = 'kind, st, keys, num, expiry, why, updated_at';
`;

const hAt = s.indexOf('export const handler');
if (hAt < 0) { console.error('no handler'); process.exit(1); }
s = s.slice(0, hAt) + SQL + '\n' + s.slice(hAt);

const mark = "const method = event.requestContext?.http?.method || 'POST';";
const at = s.indexOf(mark);
if (at < 0) { console.error('no method mark'); process.exit(1); }
s = s.slice(0, at) +
  "if (!event.requestContext && event && event.action === 'admin.migrate008') {\n" +
  "  const c = await (await db()).connect();\n" +
  "  try { await c.query(SQL_008); } finally { c.release(); }\n" +
  "  return { ok: true, ran: 'verify' };\n" +
  "}\n" +
  // reviewer side: invoked directly, never through the URL
  "if (!event.requestContext && event && event.action === 'admin.verify.queue') {\n" +
  "  const c = await (await db()).connect();\n" +
  "  try {\n" +
  "    const r = await c.query(\"select v.owner, v.kind, v.st, v.keys, v.num, v.expiry, v.updated_at, coalesce(w.name,'') as name from app.verify v left join app.workers w on w.owner = v.owner where v.st = 'pend' order by v.updated_at limit 200\");\n" +
  "    return { ok: true, rows: r.rows };\n" +
  "  } finally { c.release(); }\n" +
  "}\n" +
  "if (!event.requestContext && event && event.action === 'admin.verify.set') {\n" +
  "  const c = await (await db()).connect();\n" +
  "  try {\n" +
  "    const st = ['ok','back','exp','pend'].indexOf(String(event.st)) >= 0 ? String(event.st) : 'pend';\n" +
  "    await c.query('update app.verify set st = $1, why = $2, updated_at = now() where owner = $3 and kind = $4', [st, String(event.why || ''), event.owner, String(event.kind || '')]);\n" +
  "    return { ok: true };\n" +
  "  } finally { c.release(); }\n" +
  "}\n" + s.slice(at);

const listAnchor = "if (q.action === 'works.list') {";
s = s.replace(listAnchor,
  "if (q.action === 'verify.mine') {\n" +
  "  const r = await asUser(uid, (c) => c.query(`select ${V_COLS} from app.verify where owner = app.uid()`));\n" +
  "  return out(200, { rows: r.rows });\n" +
  "}\n" + listAnchor);

const addAnchor = "if (q.action === 'works.create') {";
s = s.replace(addAnchor,
  "if (q.action === 'verify.put') {\n" +
  "  const v = q.item || {};\n" +
  "  const kind = ['id','abn','lic','ins'].indexOf(String(v.kind)) >= 0 ? String(v.kind) : '';\n" +
  "  if (!kind) return out(400, { error: 'kind' });\n" +
  "  const keys = Array.isArray(v.keys) ? v.keys.slice(0, 4).map(String) : [];\n" +
  "  const exp = v.expiry ? String(v.expiry).slice(0, 10) : null;\n" +
  "  await asUser(uid, (c) => c.query(\n" +
  "    `insert into app.verify (owner, kind, st, keys, num, expiry, why, updated_at)\n" +
  "     values (app.uid(), $1, 'pend', $2, $3, $4::date, '', now())\n" +
  "     on conflict (owner, kind) do update set st = 'pend', keys = excluded.keys, num = excluded.num, expiry = excluded.expiry, why = '', updated_at = now()`,\n" +
  "    [kind, keys, String(v.num || '').slice(0, 60), exp]));\n" +
  "  return out(200, { ok: true });\n" +
  "}\n" + addAnchor);

fs.writeFileSync(outp, s);
console.log('PATCHED', s.length);
