import { json } from "@/lib/http";
import { getJoinLimits } from "@/lib/db";
import { getAppBaseUrl } from "@/lib/app-config";
import { nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const limits = getJoinLimits();
  void nimiqService.warmupConsensus().catch((error) => {
    console.warn("Nimiq consensus warmup failed from config route", error);
  });
  return json({
    appBaseUrl: getAppBaseUrl(),
    escrowAddress: process.env.NIMIQ_ESCROW_ADDRESS || null,
    rewardsPoolAddress: process.env.NIMIQ_REWARDS_POOL_ADDRESS || null,
    network: process.env.NIMIQ_NETWORK || "testnet",
    paused: limits.paused,
    maxStakePerWalletLuna: limits.maxStakePerWalletLuna,
    maxPoolTotalLuna: limits.maxPoolTotalLuna,
  });
}
