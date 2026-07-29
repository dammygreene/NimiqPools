import { apiError, json } from "@/lib/http";
import { canonicalAddress, nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = canonicalAddress(url.searchParams.get("address"), "Wallet address");
    const balanceLuna = await nimiqService.getBalance(address);
    return json({ address, balanceLuna, balanceNim: balanceLuna / 100_000 });
  } catch (error) {
    return apiError(error);
  }
}
