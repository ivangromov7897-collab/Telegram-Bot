import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb(): Promise<void> {
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

export async function trackUser(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): Promise<{ isNew: boolean }> {
  const now = Date.now();
  const res = await pool.query<{ first_seen: string }>(
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
  const inserted = (res.rows[0] as any).inserted as boolean;
  return { isNew: inserted };
}

export async function trackQuery(
  from: { id: number; username?: string; first_name?: string },
  text: string,
  type: QueryRecord["type"],
): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO bot_queries (user_id, username, first_name, text, type, ts)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [from.id, from.username ?? null, from.first_name ?? null, text, type, now],
  );
  // Keep only latest 500 rows
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
  const res = await pool.query<any>(
    "SELECT * FROM bot_users ORDER BY last_seen DESC LIMIT $1",
    [n],
  );
  return res.rows.map(rowToUser);
}

export async function getRecentQueries(n = 30): Promise<QueryRecord[]> {
  const res = await pool.query<any>(
    "SELECT * FROM bot_queries ORDER BY ts DESC LIMIT $1",
    [n],
  );
  return res.rows.map(rowToQuery);
}

export async function getAllUsers(): Promise<UserRecord[]> {
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
