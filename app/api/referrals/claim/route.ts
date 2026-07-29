import { apiError, json } from "@/lib/http";
import { ConflictError, InputError, PausedError, getRewardEvent, isPaused, markRewardBroadcast, markRewardConfirmed } from "@/lib/db";
import { canonicalAddress, nimiqService, verifySignedClaimPayload } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (isPaused()) throw new PausedError("The service is temporarily paused.");

    const body = (await request.json()) as Record<string, unknown>;
    const address = canonicalAddress(body.address, "Wallet address");
    const id = String(body.rewardEventId || "");
    if (!id) throw new InputError("Wallet and reward event are required.");

    const reward = getRewardEvent(id, address);
    if (!reward || !["pending", "broadcast"].includes(String(reward.status))) {
      throw new ConflictError("This reward is unavailable or already claimed.");
    }

    verifySignedClaimPayload({
      payload: String(body.payload || ""),
      signature: String(body.signature || ""),
      publicKey: String(body.publicKey || ""),
      expectedAddress: address,
      expectedDomain: "nimiq-pools-reward",
      claimIdField: "rewardEventId",
      claimId: id,
      expectedAmount: Number(reward.amount),
    });

    const from = process.env.NIMIQ_REWARDS_POOL_ADDRESS;
    if (!from) throw new ConflictError("Testnet rewards wallet is not configured.");
    const amountLuna = Number(reward.amount) * 100_000;
    const balance = await nimiqService.getBalance(from);
    if (balance < amountLuna) {
      throw new ConflictError("Rewards pool has insufficient on-chain balance. Claim remains pending.");
    }

    let hash = String(reward.claim_tx_hash || "");
    if (!hash) {
      const sent = await nimiqService.sendReward(from, address, amountLuna);
      hash = sent.hash;
      markRewardBroadcast(id, hash);
    }

    const confirmations = await nimiqService.waitForConfirmation(hash);
    if (confirmations < nimiqService.confirmationsRequired) {
      return json({ ok: false, status: "pending", claimTxHash: hash, reason: "Broadcast but not yet confirmed. Retry this claim to continue confirmation." }, 202);
    }
    const verified = await nimiqService.verifyRewardClaim(hash);
    if (!verified.ok) return json({ ok: false, status: "pending", claimTxHash: hash, reason: verified.reason }, 202);
    markRewardConfirmed(id, hash);
    return json({ ok: true, status: "claimed", claimTxHash: hash, amount: Number(reward.amount), confirmations });
  } catch (error) {
    return apiError(error);
  }
}
