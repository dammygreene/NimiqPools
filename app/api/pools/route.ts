import { apiError, json } from "@/lib/http";
import { createPool, isDiscoverablePool, listPools, listPoolsForWallet } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const discoverOnly = url.searchParams.get("discover") === "1";
    const address = url.searchParams.get("address");
    const pools = address ? listPoolsForWallet(address) : listPools();
    return json({ pools: discoverOnly ? pools.filter(isDiscoverablePool) : pools });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const pool = createPool((await request.json()) as Record<string, unknown>);
    return json({ pool }, 201);
  } catch (error) {
    return apiError(error);
  }
}
