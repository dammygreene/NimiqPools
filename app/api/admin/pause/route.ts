import { apiError, json } from "@/lib/http";
import { getJoinLimits, setPaused } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  return request.headers.get("authorization") === `Bearer ${process.env.ADMIN_TOKEN}`;
}

export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const limits = getJoinLimits();
    return json({
      paused: limits.paused,
      maxStakePerWalletLuna: limits.maxStakePerWalletLuna,
      maxPoolTotalLuna: limits.maxPoolTotalLuna,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.paused !== "boolean") {
      return json({ error: "paused must be a boolean." }, 400);
    }
    return json(setPaused(body.paused));
  } catch (error) {
    return apiError(error);
  }
}
