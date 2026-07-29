import { apiError, json } from "@/lib/http";
import { ConflictError, InputError, PausedError, getOrCreatePayout, isPaused, markPayoutBroadcast, markPayoutConfirmed } from "@/lib/db";
import { canonicalAddress, nimiqService, verifySignedClaimPayload } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isPaused()) throw new PausedError("The service is temporarily paused.");

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const address = canonicalAddress(body.address, "Wallet address");

    verifySignedClaimPayload({
      payload: String(body.payload || ""),
      signature: String(body.signature || ""),
      publicKey: String(body.publicKey || ""),
      expectedAddress: address,
      expectedDomain: "nimiq-pools-payout",
      claimIdField: "poolId",
      claimId: id,
    });

    const payout = getOrCreatePayout(id, address);
    if (payout.status === "completed") {
      return json({ ok: true, status: "completed", payoutTxHash: payout.payout_tx_hash, amountLuna: payout.amount_luna });
    }

    const from = process.env.NIMIQ_ESCROW_ADDRESS;
    if (!from) throw new ConflictError("Testnet escrow wallet is not configured.");
    const amount = Number(payout.amount_luna);
    if (await nimiqService.getBalance(from) < amount) {
      throw new ConflictError("Escrow has insufficient on-chain balance. Payout remains pending.");
    }

    let hash = String(payout.payout_tx_hash || "");
    if (!hash) {
      const sent = await nimiqService.sendPayout(from, address, amount);
      hash = sent.hash;
      markPayoutBroadcast(String(payout.id), hash);
    }

    const confirmations = await nimiqService.waitForConfirmation(hash);
    if (confirmations < nimiqService.confirmationsRequired) {
      return json({ ok: false, status: "pending", payoutTxHash: hash, reason: "Broadcast but awaiting confirmations." }, 202);
    }
    markPayoutConfirmed(String(payout.id), hash);
    return json({ ok: true, status: "completed", payoutTxHash: hash, amountLuna: amount, confirmations });
  } catch (error) {
    return apiError(error);
  }
}
