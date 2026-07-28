import { DatabaseSync } from "node:sqlite";
import * as Nimiq from "@nimiq/core";

process.loadEnvFile(".env.local");

const db = new DatabaseSync(process.env.DATABASE_PATH || "data/nimiq-pools.db");
const rewards = db.prepare("SELECT * FROM rewards_pool LIMIT 1").get();
const pendingRewards = Number(
  db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM reward_events WHERE status IN ('pending','broadcast')").get().amount,
);
const outstandingEscrow = Number(
  db.prepare(`SELECT COALESCE(SUM(p.stake_amount_luna),0) amount FROM participants p
    JOIN pools x ON x.id=p.pool_id WHERE x.status NOT IN ('PAID','REFUNDED')`).get().amount,
);

const config = new Nimiq.ClientConfiguration();
config.network("TestAlbatross");
config.seedNodes(["/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss"]);
config.logLevel("warn");
const client = await Nimiq.Client.create(config.build());
await client.waitForConsensusEstablished();

async function balance(address) {
  const account = await client.getAccount(Nimiq.Address.fromUserFriendlyAddress(address));
  return Number(account.balance || 0);
}

const rewardsOnChain = await balance(process.env.NIMIQ_REWARDS_POOL_ADDRESS);
const escrowOnChain = await balance(process.env.NIMIQ_ESCROW_ADDRESS);
const rewardsLedger = (Number(rewards.total_funded) - Number(rewards.total_distributed)) * 100_000;

console.log(JSON.stringify({
  network: "testnet",
  rewards: {
    address: process.env.NIMIQ_REWARDS_POOL_ADDRESS,
    onChainLuna: rewardsOnChain,
    ledgerAvailableLuna: rewardsLedger,
    diverged: rewardsOnChain !== rewardsLedger,
    warning: rewardsOnChain !== rewardsLedger ? "Rewards ledger and chain balance diverge." : null,
    pendingRewardsNim: pendingRewards,
    totalDistributedNim: Number(rewards.total_distributed),
  },
  escrow: {
    address: process.env.NIMIQ_ESCROW_ADDRESS,
    onChainLuna: escrowOnChain,
    outstandingLiabilitiesLuna: outstandingEscrow,
    diverged: escrowOnChain < outstandingEscrow,
    warning: escrowOnChain < outstandingEscrow ? "Escrow is below outstanding pool liabilities." : null,
  },
}, null, 2));

process.exit(0);
