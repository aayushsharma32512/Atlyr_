/**
 * Beta launch metrics: signups, onboarding, activation, outfits, inspiration imports, try-ons, saves.
 *
 *   bun run metrics:launch                                   # by day since the 2026-09-15 launch
 *   bun run metrics:launch --since 2026-09-01
 *   bun run metrics:launch --since "2026-09-21 15:52:00+00"  # a timestamp works too
 *   bun run metrics:launch --users                           # every user ever, one row each, all-time counts
 *   bun run metrics:launch --csv [--users]                   # same rows as CSV on stdout
 *   bun run metrics:launch --sheets                          # write daily + users + meta tabs to Google Sheets
 *   bun run metrics:launch --team                            # also list the excluded team accounts
 *
 * Env: DATABASE_URL_DIRECT (Bun loads .env automatically). Runs SELECT only.
 * All timestamps and day boundaries are IST (Asia/Kolkata).
 * For --sheets: METRICS_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON or a path to the key
 * file). Share the sheet with the service account's client_email first.
 */

// Team accounts are matched by email, not id, so adding a new one is a one-line edit here.
const TEAM_EMAILS = [
  "krishantsethia27@gmail.com",
  "krishantsethia@gmail.com",
  "krishantsethia28@gmail.com",
  "krishantnewsletter@gmail.com",
  "krishant@chiralitylabs.com",
  "krishant.iitd@gmail.com",
  "metasanatani@gmail.com",
  "aayushsharma32512@gmail.com",
  "namjain06@gmail.com",
  "sumakesh1997@gmail.com",
  "suicide1997@gmail.com",
  "silov.solutions@gmail.com",
  "sumakesh1997sbdav@gmail.com",
  "atlyrapp@gmail.com",
]

const LAUNCH_DATE = "2026-09-15"

const DAY_COLUMNS = [
  "day", "signups", "onboarded", "signups_activated", "active_users", "returning_users",
  "outfits", "outfit_creators", "imports", "imports_committed", "tryons", "saves",
]

const USER_COLUMNS = [
  "name", "email", "signed_up", "onboarded", "gender", "age", "invite_code", "last_sign_in",
  "outfits", "imports", "imports_committed", "tryons", "saves", "total_actions",
  "active_days", "returned", "first_action", "last_action",
]

type Row = Record<string, unknown>

function arg(flag: string): string | undefined {
  const i = Bun.argv.indexOf(flag)
  return i === -1 ? undefined : Bun.argv[i + 1]
}

const since = arg("--since") ?? LAUNCH_DATE
const asCsv = Bun.argv.includes("--csv")
const byUser = Bun.argv.includes("--users")
const toSheets = Bun.argv.includes("--sheets")
const showTeam = Bun.argv.includes("--team")

const url = process.env.DATABASE_URL_DIRECT
if (!url) {
  console.error("DATABASE_URL_DIRECT is not set. Run from the repo root so .env is picked up.")
  process.exit(1)
}

// One connection, so the session time zone below applies to every query.
const sql = new Bun.SQL(url, { max: 1 })
await sql.unsafe("set timezone to 'Asia/Kolkata'")

const team = await sql`
  select u.id, u.email, coalesce(p.name, u.raw_user_meta_data->>'full_name') as name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where lower(u.email) in ${sql(TEAM_EMAILS)}
  order by u.email
`
// Bun's SQL tag expands an array into a value list, which an empty array would break.
const teamIds: string[] = team.length
  ? team.map((t: { id: string }) => t.id)
  : ["00000000-0000-0000-0000-000000000000"]

// An action is: creating an outfit, triggering an import, starting a try-on, or saving a favourite.
const ACTS = sql`
  select user_id, created_at, 'outfit' as kind, false as committed
    from public.outfits where user_id is not null
  union all
  select user_id, created_at, 'import', status = 'committed'
    from public.inspiration_imports
  union all
  select user_id, created_at, 'tryon', false
    from public.user_generations
  union all
  select user_id, created_at, 'save', false
    from public.user_favorites
`

// "signups_*" columns are by signup day; every other column is by the day the action happened.
async function fetchDaily(): Promise<Row[]> {
  return sql`
    with users as (
      select u.id, u.created_at, p.onboarding_complete is true as onboarded
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      where u.id not in ${sql(teamIds)}
    ),
    acts as (${ACTS}),
    signups as (
      select u.created_at::date as day,
        count(*)::int as signups,
        count(*) filter (where u.onboarded)::int as onboarded,
        count(*) filter (where exists (select 1 from acts a where a.user_id = u.id))::int as signups_activated
      from users u
      where u.created_at >= ${since}
      group by 1
    ),
    activity as (
      select a.created_at::date as day,
        count(distinct a.user_id)::int as active_users,
        count(distinct a.user_id) filter (where u.created_at::date < a.created_at::date)::int as returning_users,
        count(*) filter (where a.kind = 'outfit')::int as outfits,
        count(distinct a.user_id) filter (where a.kind = 'outfit')::int as outfit_creators,
        count(*) filter (where a.kind = 'import')::int as imports,
        count(*) filter (where a.kind = 'import' and a.committed)::int as imports_committed,
        count(*) filter (where a.kind = 'tryon')::int as tryons,
        count(*) filter (where a.kind = 'save')::int as saves
      from acts a
      join users u on u.id = a.user_id
      where a.created_at >= ${since}
      group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(s.signups, 0) as signups,
      coalesce(s.onboarded, 0) as onboarded,
      coalesce(s.signups_activated, 0) as signups_activated,
      coalesce(a.active_users, 0) as active_users,
      coalesce(a.returning_users, 0) as returning_users,
      coalesce(a.outfits, 0) as outfits,
      coalesce(a.outfit_creators, 0) as outfit_creators,
      coalesce(a.imports, 0) as imports,
      coalesce(a.imports_committed, 0) as imports_committed,
      coalesce(a.tryons, 0) as tryons,
      coalesce(a.saves, 0) as saves
    from generate_series(${since}::date, current_date, interval '1 day') as d(day)
    left join signups s on s.day = d.day
    left join activity a on a.day = d.day
    order by d.day
  `
}

// One row per user, every account ever, all-time action counts. --since does not apply here:
// early users reached the app without the invite route, so a signup-date cut would drop them.
async function fetchUsers(): Promise<Row[]> {
  return sql`
    with acts as (${ACTS})
    select
      coalesce(p.name, u.raw_user_meta_data->>'full_name') as name,
      u.email,
      to_char(u.created_at, 'YYYY-MM-DD HH24:MI') as signed_up,
      p.onboarding_complete is true as onboarded,
      p.gender,
      p.age,
      (select string_agg(r.code, ' ') from public.invite_redemptions r where r.user_id = u.id) as invite_code,
      to_char(u.last_sign_in_at, 'YYYY-MM-DD HH24:MI') as last_sign_in,
      count(a.user_id) filter (where a.kind = 'outfit')::int as outfits,
      count(a.user_id) filter (where a.kind = 'import')::int as imports,
      count(a.user_id) filter (where a.kind = 'import' and a.committed)::int as imports_committed,
      count(a.user_id) filter (where a.kind = 'tryon')::int as tryons,
      count(a.user_id) filter (where a.kind = 'save')::int as saves,
      count(a.user_id)::int as total_actions,
      count(distinct a.created_at::date)::int as active_days,
      coalesce(bool_or(a.created_at::date > u.created_at::date), false) as returned,
      to_char(min(a.created_at), 'YYYY-MM-DD HH24:MI') as first_action,
      to_char(max(a.created_at), 'YYYY-MM-DD HH24:MI') as last_action
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join acts a on a.user_id = u.id
    where u.id not in ${sql(teamIds)}
    group by u.id, u.email, u.created_at, u.last_sign_in_at, u.raw_user_meta_data,
      p.name, p.onboarding_complete, p.gender, p.age
    order by total_actions desc, u.created_at
  `
}

function table(rows: Row[], columns: string[]) {
  if (rows.length === 0) return console.log("  (none)")
  const width = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)))
  const line = (cells: string[]) => "  " + cells.map((c, i) => c.padEnd(width[i])).join("  ")
  console.log(line(columns))
  console.log(line(width.map((w) => "-".repeat(w))))
  for (const r of rows) console.log(line(columns.map((c) => String(r[c] ?? ""))))
}

function csv(rows: Row[], columns: string[]) {
  const cell = (v: unknown) => {
    const t = v == null ? "" : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  console.log(columns.join(","))
  for (const r of rows) console.log(columns.map((c) => cell(r[c])).join(","))
}

// ── Google Sheets ──

type ServiceAccount = { client_email: string; private_key: string; token_uri: string }

async function loadServiceAccount(): Promise<ServiceAccount> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set")
  const text = raw.trimStart().startsWith("{") ? raw : await Bun.file(raw).text()
  return JSON.parse(text)
}

const b64url = (s: string | Uint8Array) => Buffer.from(s).toString("base64url")

// Google's service-account flow: sign a JWT with the key, trade it for a one-hour access token.
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }))
  const der = Buffer.from(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64")
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  )
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`))
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(new Uint8Array(sig))}`,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  return (await res.json()).access_token
}

async function pushToSheets(daily: Row[], users: Row[]) {
  const sheetId = process.env.METRICS_SHEET_ID
  if (!sheetId) throw new Error("METRICS_SHEET_ID is not set")
  const token = await accessToken(await loadServiceAccount())
  const [{ now }] = await sql`select to_char(now(), 'YYYY-MM-DD HH24:MI') as now`
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    })
    if (!res.ok) throw new Error(`Sheets API ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status})`)
    return res.json()
  }

  const tabs: Record<string, [string[], Row[]]> = {
    daily: [DAY_COLUMNS, daily],
    users: [USER_COLUMNS, users],
    meta: [["updated_at_ist", "since", "team_accounts_excluded"],
      [{ updated_at_ist: now, since, team_accounts_excluded: team.length }]],
  }

  const meta = await call("?fields=sheets.properties.title")
  const existing = new Set(meta.sheets.map((s: { properties: { title: string } }) => s.properties.title))
  const missing = Object.keys(tabs).filter((t) => !existing.has(t))
  if (missing.length) {
    await call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    })
  }

  for (const [tab, [columns, rows]] of Object.entries(tabs)) {
    const values = [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))]
    await call(`/values/${tab}:clear`, { method: "POST" })
    await call(`/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    })
    console.log(`${tab}: ${rows.length} rows`)
  }
}

// ── Modes ──

if (toSheets) {
  await pushToSheets(await fetchDaily(), await fetchUsers())
  await sql.end()
  process.exit(0)
}

if (byUser) {
  const users = await fetchUsers()
  if (asCsv) csv(users, USER_COLUMNS)
  else {
    console.log(`\nAll users (${users.length} rows, ${team.length} team accounts excluded)\n`)
    table(users, USER_COLUMNS)
  }
  await sql.end()
  process.exit(0)
}

const daily = await fetchDaily()

if (asCsv) {
  csv(daily, DAY_COLUMNS)
  await sql.end()
  process.exit(0)
}

const sum = (c: string) => daily.reduce((n: number, r: Row) => n + (r[c] as number), 0)
const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`)

const [distinct] = await sql`
  with acts as (${ACTS})
  select
    (select count(distinct user_id) from acts
      where created_at >= ${since} and user_id not in ${sql(teamIds)})::int as active_users,
    (select count(distinct user_id) from acts
      where kind = 'outfit' and created_at >= ${since} and user_id not in ${sql(teamIds)})::int as outfit_creators,
    (select count(distinct user_id) from acts
      where kind = 'import' and created_at >= ${since} and user_id not in ${sql(teamIds)})::int as importers
`

const signups = sum("signups")
const imports = sum("imports")

console.log(`\nAtlyr launch metrics since ${since} (${team.length} team accounts excluded, times in IST)\n`)
table(
  [
    { metric: "Signups", value: signups, share: "" },
    { metric: "Completed onboarding", value: sum("onboarded"), share: pct(sum("onboarded"), signups) },
    { metric: "Signups that took any action", value: sum("signups_activated"), share: pct(sum("signups_activated"), signups) },
    { metric: "Active users (distinct)", value: distinct.active_users, share: "" },
    { metric: "Outfits created", value: sum("outfits"), share: `${distinct.outfit_creators} users` },
    { metric: "Inspiration imports", value: imports, share: `${distinct.importers} users` },
    { metric: "Imports opened in studio", value: sum("imports_committed"), share: pct(sum("imports_committed"), imports) },
    { metric: "Try-ons", value: sum("tryons"), share: "" },
    { metric: "Saves", value: sum("saves"), share: "" },
  ],
  ["metric", "value", "share"],
)

console.log("\nBy day\n")
table(daily, DAY_COLUMNS)

if (showTeam) {
  console.log("\nExcluded team accounts\n")
  table(team, ["email", "name"])
}

console.log("\nSession time is not recorded in Postgres — it only exists in PostHog.\n")

await sql.end()
