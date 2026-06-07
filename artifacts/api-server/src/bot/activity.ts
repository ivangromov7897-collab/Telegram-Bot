import pg from "pg";

const DB_URL = process.env["DATABASE_URL"];
const pool = DB_URL ? new pg.Pool({ connectionString: DB_URL }) : null;

export async function initDb(): Promise<void> {
  if (!pool) {
    console.warn("[activity] No DATABASE_URL — using in-memory storage");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_users (
      id          BIGINT PRIMARY KEY,
      username    TEXT,
      first_name  TEXT,
      last_name   TEXT,
      first_seen  BIGINT NOT NULL,
      last_seen   BIGINT NOT NULL,
      query_count INT    NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS bot_queries (
      id         SERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL,
      username   TEXT,
      first_name TEXT,
      text       TEXT   NOT NULL,
      type       TEXT   NOT NULL,
      ts         BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bot_queries_ts ON bot_queries (ts DESC);
  `);
}

export interface UserRecord {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  firstSeen: number;
  lastSeen: number;
  queryCount: number;
}

export interface QueryRecord {
  userId: number;
  username?: string;
  firstName?: string;
  text: string;
  type: "wallet" | "username" | "number" | "domain" | "other";
  ts: number;
}

// --- In-memory fallback ---
const memUsers = new Map<number, UserRecord>();
const memQueries: QueryRecord[] = [];
const MAX_QUERIES = 200;

export async function trackUser(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): Promise<{ isNew: boolean }> {
  if (!pool) {
    const existing = memUsers.get(from.id);
    const now = Date.now();
    if (existing) {
      existing.lastSeen    = now;
      existing.username    = from.username;
      existing.firstName   = from.first_name;
      existing.lastName    = from.last_name;
      existing.queryCount += 1;
      return { isNew: false };
    }
    memUsers.set(from.id, {
      id: from.id, username: from.username, firstName: from.first_name,
      lastName: from.last_name, firstSeen: now, lastSeen: now, queryCount: 1,
    });
    return { isNew: true };
  }

  const now = Date.now();
  const res = await pool.query(
    `INSERT INTO bot_users (id, username, first_name, last_name, first_seen, last_seen, query_count)
     VALUES ($1, $2, $3, $4, $5, $5, 1)
     ON CONFLICT (id) DO UPDATE
       SET username    = EXCLUDED.username,
           first_name  = EXCLUDED.first_name,
           last_name   = EXCLUDED.last_name,
           last_seen   = EXCLUDED.last_seen,
           query_count = bot_users.query_count + 1
     RETURNING (xmax = 0) AS inserted`,
    [from.id, from.username ?? null, from.first_name ?? null, from.last_name ?? null, now],
  );
  return { isNew: (res.rows[0] as any).inserted as boolean };
}

export async function trackQuery(
  from: { id: number; username?: string; first_name?: string },
  text: string,
  type: QueryRecord["type"],
): Promise<void> {
  const now = Date.now();
  if (!pool) {
    memQueries.push({ userId: from.id, username: from.username, firstName: from.first_name, text, type, ts: now });
    if (memQueries.length > MAX_QUERIES) memQueries.splice(0, memQueries.length - MAX_QUERIES);
    return;
  }
  await pool.query(
    `INSERT INTO bot_queries (user_id, username, first_name, text, type, ts)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [from.id, from.username ?? null, from.first_name ?? null, text, type, now],
  );
  await pool.query(`
    DELETE FROM bot_queries WHERE id NOT IN (
      SELECT id FROM bot_queries ORDER BY ts DESC LIMIT 500
    )
  `);
}

export async function getStats(): Promise<{
  totalUsers: number;
  activeToday: number;
  totalQueries: number;
  byType: Record<string, number>;
}> {
  if (!pool) {
    const byType: Record<string, number> = {};
    for (const q of memQueries) byType[q.type] = (byType[q.type] ?? 0) + 1;
    return {
      totalUsers:   memUsers.size,
      activeToday:  [...memUsers.values()].filter(u => Date.now() - u.lastSeen < 86_400_000).length,
      totalQueries: memQueries.length,
      byType,
    };
  }
  const [usersRes, todayRes, totalQRes, byTypeRes] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM bot_users"),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM bot_users WHERE last_seen > $1", [Date.now() - 86_400_000]),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM bot_queries"),
    pool.query<{ type: string; count: string }>("SELECT type, COUNT(*) AS count FROM bot_queries GROUP BY type"),
  ]);
  const byType: Record<string, number> = {};
  for (const row of byTypeRes.rows) byType[row.type] = parseInt(row.count, 10);
  return {
    totalUsers:   parseInt(usersRes.rows[0].count, 10),
    activeToday:  parseInt(todayRes.rows[0].count, 10),
    totalQueries: parseInt(totalQRes.rows[0].count, 10),
    byType,
  };
}

export async function getRecentUsers(n = 20): Promise<UserRecord[]> {
  if (!pool) {
    return [...memUsers.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, n);
  }
  const res = await pool.query<any>("SELECT * FROM bot_users ORDER BY last_seen DESC LIMIT $1", [n]);
  return res.rows.map(rowToUser);
}

export async function getRecentQueries(n = 30): Promise<QueryRecord[]> {
  if (!pool) return memQueries.slice(-n).reverse();
  const res = await pool.query<any>("SELECT * FROM bot_queries ORDER BY ts DESC LIMIT $1", [n]);
  return res.rows.map(rowToQuery);
}

export async function getAllUsers(): Promise<UserRecord[]> {
  if (!pool) return [...memUsers.values()].sort((a, b) => b.firstSeen - a.firstSeen);
  const res = await pool.query<any>("SELECT * FROM bot_users ORDER BY first_seen DESC");
  return res.rows.map(rowToUser);
}

function rowToUser(r: any): UserRecord {
  return {
    id:         r.id,
    username:   r.username ?? undefined,
    firstName:  r.first_name ?? undefined,
    lastName:   r.last_name ?? undefined,
    firstSeen:  Number(r.first_seen),
    lastSeen:   Number(r.last_seen),
    queryCount: r.query_count,
  };
}

function rowToQuery(r: any): QueryRecord {
  return {
    userId:    r.user_id,
    username:  r.username ?? undefined,
    firstName: r.first_name ?? undefined,
    text:      r.text,
    type:      r.type,
    ts:        Number(r.ts),
  };
}
