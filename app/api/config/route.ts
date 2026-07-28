import { json } from "@/lib/http";
import { getJoinLimits } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const limits = getJoinLimits();
  return json({
    escrowAddress: process.env.NIMIQ_ESCROW_ADDRESS || null,
    rewardsPoolAddress: process.env.NIMIQ_REWARDS_POOL_ADDRESS || null,
    network: process.env.NIMIQ_NETWORK || "testnet",
    paused: limits.paused,
    maxStakePerWalletLuna: limits.maxStakePerWalletLuna,
    maxPoolTotalLuna: limits.maxPoolTotalLuna,
  });
}
