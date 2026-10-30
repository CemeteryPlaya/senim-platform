import { jobHandlers } from "@/jobs";
import { safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";
import { runDueJobs } from "@/platform/jobs";

/** Vercel Cron вызывает GET с заголовком Authorization: Bearer <CRON_SECRET>. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (secret) {
    const given = request.headers.get("authorization") ?? "";
    if (!safeEqual(given, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  } else if (env().NODE_ENV === "production") {
    return new Response("CRON_SECRET is not configured", { status: 500 });
  }
  const summary = await runDueJobs(jobHandlers);
  return Response.json(summary);
}
