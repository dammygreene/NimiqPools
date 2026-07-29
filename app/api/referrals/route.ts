import { apiError, json } from "@/lib/http";
import { InputError, referralDashboard } from "@/lib/db";
import { canonicalAddress } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get("address");
    if (!address) throw new InputError("Wallet address is required.");
    return json(referralDashboard(canonicalAddress(address, "Wallet address")));
  } catch (error) {
    return apiError(error);
  }
}
