import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");
const PORT = 3222;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss";
const HASHES = [
  "463245861f571aa60880c3694d667e99ee847c6dce2276988f23d72ae83dbe33",
  "46f57bde4b6e4bf849d8a5348123c05ed8f8addd96f6f3246ec6f3c8c31617dc",
  "95e1899706efa7278064b4a0d1030e5b92db449d42a2b7f8eca2ea069db688f3",
  "9be33db8dab732e6415847a5527c1af2ba34fd892eec21ec3746365bcf6f7aec",
];

function walletFromMnemonic(mnemonic) {
  const { keyPair, address } = deriveSigningWalletFromMnemonic(mnemonic);
  return { keyPair, address, publicKey: keyPair.publicKey.toHex() };
}

function signPayload(wallet, payload) {
  return wallet.keyPair.sign(Buffer.from(payload, "utf8")).toHex();
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitForServer(child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) throw new Error(`Next exited ${child.exitCode}`);
    try { if ((await fetch(`${BASE}/api/config`)).ok) return; } catch {}
    await delay(1000);
  }
}

function predictionBody(wallet, pool, txHash) {
  const payload = {
    domain: "nimiq-pools",
    version: 1,
    poolId: pool.id,
    participantAddress: wallet.address,
    selectedOutcome: "Yes",
    stakeAmountLuna: pool.stakeAmountLuna,
    predictionClosesAt: pool.predictionClosesAt,
    nonce: crypto.randomUUID(),
  };
  const text = JSON.stringify(payload);
  return {
    address: wallet.address,
    predictedOutcome: "Yes",
    predictionPayload: text,
    predictionPublicKey: wallet.publicKey,
    predictionSignature: signPayload(wallet, text),
    stakeTxHash: txHash,
    stakeAmountLuna: pool.stakeAmountLuna,
  };
}

async function main() {
  const config = new Nimiq.ClientConfiguration();
  config.network("TestAlbatross");
  config.seedNodes([SEED]);
  config.logLevel("warn");
  const client = await Nimiq.Client.create(config.build());
  await client.waitForConsensusEstablished();
  const head = await client.getHeadHeight();
  const txs = [];
  for (const hash of HASHES) {
    const tx = await client.getTransaction(hash);
    txs.push({
      hash,
      blockHeight: tx.blockHeight,
      confirmations: head - tx.blockHeight + 1,
      sender: tx.sender,
      recipient: tx.recipient,
      value: String(tx.value),
      fee: String(tx.fee),
      dataRaw: tx.data?.raw ?? null,
    });
  }

  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NIMIQ_SEED_NODES: SEED, NIMIQ_CONSENSUS_TIMEOUT_MS: "90000" },
  });
  try {
    await waitForServer(server);
    const pools = await api("/api/pools");
    const reusePool = pools.body.pools.find((pool) => pool.id === "E1E5BE47");
    const reuseResponse = await api("/api/pools/E1E5BE47/join", {
      method: "POST",
      body: JSON.stringify(predictionBody(rewards, reusePool, "46f57bde4b6e4bf849d8a5348123c05ed8f8addd96f6f3246ec6f3c8c31617dc")),
    });
    const reconciliation = await api("/api/admin/reconciliation", {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    });
    console.log(JSON.stringify({ head, txs, reuseResponse, reconciliation }, null, 2));
  } finally {
    server.kill();
    try { if (client.disconnectNetwork) await client.disconnectNetwork(); } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
