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

const users   = new Map<number, UserRecord>();
const queries: QueryRecord[] = [];
const MAX_QUERIES = 200;

export function trackUser(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): { isNew: boolean } {
  const existing = users.get(from.id);
  const now = Date.now();
  if (existing) {
    existing.lastSeen    = now;
    existing.username    = from.username;
    existing.firstName   = from.first_name;
    existing.lastName    = from.last_name;
    existing.queryCount += 1;
    return { isNew: false };
  }
  users.set(from.id, {
    id:         from.id,
    username:   from.username,
    firstName:  from.first_name,
    lastName:   from.last_name,
    firstSeen:  now,
    lastSeen:   now,
    queryCount: 1,
  });
  return { isNew: true };
}

export function trackQuery(
  from: { id: number; username?: string; first_name?: string },
  text: string,
  type: QueryRecord["type"],
) {
  queries.push({ userId: from.id, username: from.username, firstName: from.first_name, text, type, ts: Date.now() });
  if (queries.length > MAX_QUERIES) queries.splice(0, queries.length - MAX_QUERIES);
}

export function getStats() {
  const total = users.size;
  const byType: Record<string, number> = {};
  for (const q of queries) byType[q.type] = (byType[q.type] ?? 0) + 1;
  const activeToday = [...users.values()].filter(u => Date.now() - u.lastSeen < 86_400_000).length;
  return { totalUsers: total, activeToday, totalQueries: queries.length, byType };
}

export function getRecentUsers(n = 20): UserRecord[] {
  return [...users.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, n);
}

export function getRecentQueries(n = 30): QueryRecord[] {
  return queries.slice(-n).reverse();
}

export function getAllUsers(): UserRecord[] {
  return [...users.values()].sort((a, b) => b.firstSeen - a.firstSeen);
}
