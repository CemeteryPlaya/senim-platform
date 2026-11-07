import { db, type Db } from "./db";
import { fail } from "./errors";

export type RateLimitRule = { limit: number; windowSec: number };

/**
 * Фиксированное окно в Postgres: работает одинаково на Vercel (много инстансов) и локально.
 * Атомарно: один INSERT … ON CONFLICT на попытку.
 */
export async function hitRateLimit(key: string, rule: RateLimitRule, client: Db = db) {
  const rows = await client.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${rule.windowSec})
                           THEN now() ELSE "RateLimitBucket"."windowStart" END,
      "count"       = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${rule.windowSec})
                           THEN 1 ELSE "RateLimitBucket"."count" + 1 END
    RETURNING "count", "windowStart"`;
  const { count, windowStart } = rows[0];
  const retryAfterSec = Math.max(0, Math.ceil((windowStart.getTime() + rule.windowSec * 1000 - Date.now()) / 1000));
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterSec };
}

/** То же, но бросает RATE_LIMITED, если лимит исчерпан. */
export async function enforceRateLimit(key: string, rule: RateLimitRule, message?: string) {
  const result = await hitRateLimit(key, rule);
  if (!result.allowed) fail.rateLimited(message);
  return result;
}
