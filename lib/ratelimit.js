// Fixed-window rate limiting stored in D1. Returns true when the request is
// allowed. One atomic upsert per check.

export async function allow(db, key, limit, windowSeconds, now = Math.floor(Date.now() / 1000)) {
  const windowStart = now - (now % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first();
  return row.count <= limit;
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
