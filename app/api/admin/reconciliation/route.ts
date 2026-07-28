import { apiError, json } from "@/lib/http";
import { accountingSnapshot } from "@/lib/db";
import { nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (request.headers.get("authorization") !== `Bearer ${process.env.ADMIN_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const snapshot = accountingSnapshot();
    const rewardsAddress = process.env.NIMIQ_REWARDS_POOL_ADDRESS || String(snapshot.rewards.address);
    const escrowAddress = process.env.NIMIQ_ESCROW_ADDRESS || "";
    const rewardsOnChain = await nimiqService.getBalance(rewardsAddress);
    const escrowOnChain = await nimiqService.getBalance(escrowAddress);
    const fundedLuna = Number(snapshot.rewards.total_funded_luna ?? Number(snapshot.rewards.total_funded ?? 0) * 100_000);
    const distributedLuna = Number(snapshot.rewards.total_distributed ?? 0) * 100_000;
    const rewardsLedger = fundedLuna - distributedLuna;

    return json({
      network: process.env.NIMIQ_NETWORK || "testnet",
      rewards: {
        address: rewardsAddress,
        onChainLuna: rewardsOnChain,
        ledgerAvailableLuna: rewardsLedger,
        diverged: rewardsOnChain !== rewardsLedger,
        warning: rewardsOnChain !== rewardsLedger ? "Rewards ledger and chain balance diverge." : null,
      },
      escrow: {
        address: escrowAddress,
        onChainLuna: escrowOnChain,
        outstandingLiabilitiesLuna: snapshot.outstandingEscrow,
        diverged: escrowOnChain < snapshot.outstandingEscrow,
        warning: escrowOnChain < snapshot.outstandingEscrow ? "Escrow is below outstanding pool liabilities." : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
