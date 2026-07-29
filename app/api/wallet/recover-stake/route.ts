import { apiError, json } from "@/lib/http";
import { InputError } from "@/lib/db";
import { canonicalAddress, nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const address = canonicalAddress(body.address, "Wallet address");
    const recipient = canonicalAddress(body.recipient, "Prediction escrow address");
    const amountLuna = Number(body.amountLuna);
    if (!Number.isSafeInteger(amountLuna) || amountLuna <= 0) {
      throw new InputError("Stake amount must be a positive integer.");
    }
    const result = await nimiqService.findRecentStakeTransaction(address, recipient, amountLuna);
    return json({ transaction: result });
  } catch (error) {
    return apiError(error);
  }
}
