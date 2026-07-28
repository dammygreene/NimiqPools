import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");
const PORT = 3224;
const BASE = `http://127.0.0.1:${PORT}`;
const HASH = "46f57bde4b6e4bf849d8a5348123c05ed8f8addd96f6f3246ec6f3c8c31617dc";

function walletFromMnemonic(mnemonic) {
  const { keyPair, address } = deriveSigningWalletFromMnemonic(mnemonic);
  return { keyPair, address, publicKey: keyPair.publicKey.toHex() };
}
function signPayload(wallet, payload) {
  return wallet.keyPair.sign(Buffer.from(payload, "utf8")).toHex();
}
async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function waitForServer(child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode != null) throw new Error(`Next exited ${child.exitCode}`);
    try { if ((await fetch(`${BASE}/api/config`)).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error("server timeout");
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NIMIQ_SEED_NODES: "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss" },
});

try {
  await waitForServer(server);
  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  const pools = await api("/api/pools");
  const pool = pools.body.pools.find((item) => item.id === "E1E5BE47");
  const payload = JSON.stringify({
    domain: "nimiq-pools",
    version: 1,
    poolId: pool.id,
    participantAddress: rewards.address,
    selectedOutcome: "Yes",
    stakeAmountLuna: pool.stakeAmountLuna,
    predictionClosesAt: pool.predictionClosesAt,
    nonce: crypto.randomUUID(),
  });
  const response = await api(`/api/pools/${pool.id}/join`, {
    method: "POST",
    body: JSON.stringify({
      address: rewards.address,
      predictedOutcome: "Yes",
      predictionPayload: payload,
      predictionPublicKey: rewards.publicKey,
      predictionSignature: signPayload(rewards, payload),
      stakeTxHash: HASH,
      stakeAmountLuna: pool.stakeAmountLuna,
    }),
  });
  console.log(JSON.stringify(response, null, 2));
} finally {
  server.kill();
}
