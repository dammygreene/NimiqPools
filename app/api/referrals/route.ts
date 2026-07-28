import { apiError, json } from "@/lib/http";
import { InputError, referralDashboard } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get("address");
    if (!address) throw new InputError("Wallet address is required.");
    return json(referralDashboard(address, url.origin));
  } catch (error) {
    return apiError(error);
  }
}
