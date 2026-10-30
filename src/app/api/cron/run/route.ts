import { drainJobs, enqueueDailyJobs } from "@/jobs";
import { safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/** Очередь разбирается до ~50 с (drainJobs) — запас до лимита функции. */
export const maxDuration = 60;

/** Vercel Cron вызывает GET с заголовком Authorization: Bearer <CRON_SECRET>. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (secret) {
    const given = request.headers.get("authorization") ?? "";
    if (!safeEqual(given, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  } else if (env().NODE_ENV === "production") {
    return new Response("CRON_SECRET is not configured", { status: 500 });
  }
  await enqueueDailyJobs();
  const summary = await drainJobs();
  return Response.json(summary);
}
