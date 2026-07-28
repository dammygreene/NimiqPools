import { DatabaseSync } from "node:sqlite";
import * as Nimiq from "@nimiq/core";

process.loadEnvFile(".env.local");

const LUNA_PER_NIM = 100_000;
const db = new DatabaseSync(process.env.DATABASE_PATH || "data/nimiq-pools.db");
try {
  db.exec("ALTER TABLE rewards_pool ADD COLUMN total_funded_luna INTEGER NOT NULL DEFAULT 0");
} catch {}

const config = new Nimiq.ClientConfiguration();
config.network("TestAlbatross");
config.seedNodes(["/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss"]);
config.logLevel("warn");
const client = await Nimiq.Client.create(config.build());
await client.waitForConsensusEstablished();

const address = process.env.NIMIQ_REWARDS_POOL_ADDRESS;
const account = await client.getAccount(Nimiq.Address.fromUserFriendlyAddress(address));
const onChainLuna = Number(account.balance || 0);
const distributedNim = Number(db.prepare("SELECT COALESCE(total_distributed, 0) AS amount FROM rewards_pool WHERE address = ?").get(address).amount);
const fundedLuna = onChainLuna + distributedNim * LUNA_PER_NIM;
const fundedNim = Math.floor(fundedLuna / LUNA_PER_NIM);

db.prepare(
  "UPDATE rewards_pool SET total_funded = ?, total_funded_luna = ? WHERE address = ?",
).run(fundedNim, fundedLuna, address);

console.log(JSON.stringify({
  address,
  onChainLuna,
  distributedNim,
  fundedLuna,
  fundedNim,
}, null, 2));

process.exit(0);
