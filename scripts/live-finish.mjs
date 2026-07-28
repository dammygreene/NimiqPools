import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.LIVE_VERIFY_PORT || 3221);
const BASE = `http://127.0.0.1:${PORT}`;
const STAKE = 100_000;
const SEED = "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss";

function log(label, value) {
  console.log(`${label} ${JSON.stringify(value)}`);
}

function cleanAddress(value) {
  return String(value).replace(/\s+/g, "").toUpperCase();
}

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
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return;
    } catch {}
    await delay(1000);
  }
  throw new Error("Timed out waiting for server");
}

async function createClient() {
  const config = new Nimiq.ClientConfiguration();
  config.network("TestAlbatross");
  config.seedNodes([SEED]);
  config.logLevel("warn");
  const client = await Nimiq.Client.create(config.build());
  await client.waitForConsensusEstablished();
  return client;
}

async function sendStake(client, wallet, recipientAddress, amount, poolId) {
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    Nimiq.Address.fromUserFriendlyAddress(wallet.address),
    Nimiq.Address.fromUserFriendlyAddress(recipientAddress),
    new TextEncoder().encode(`POOL:${poolId}`),
    BigInt(amount),
    BigInt(0),
    await client.getHeadHeight(),
    await client.getNetworkId(),
  );
  tx.sign(wallet.keyPair);
  const result = await client.sendTransaction(tx);
  return String(result?.transactionHash ?? result?.hash ?? tx.hash());
}

async function waitForConfirmations(client, txHash, min = 2, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const tx = await client.getTransaction(txHash);
      if (tx?.blockHeight) {
        last = Math.max(0, Number(await client.getHeadHeight()) - Number(tx.blockHeight) + 1);
        if (last >= min) return last;
      }
    } catch {}
    await delay(2000);
  }
  throw new Error(`Timed out waiting for confirmations for ${txHash}; last=${last}`);
}

async function createPool(label, creatorAddress, eventOffsetMs) {
  const now = Date.now();
  const result = await api("/api/pools", {
    method: "POST",
    body: JSON.stringify({
      question: `Live finish ${label} ${new Date().toISOString()}`,
      category: "manual",
      resolverType: "MANUAL",
      resolverConfig: {},
      outcomes: ["Yes", "No"],
      stakeAmountLuna: STAKE,
      creatorAddress,
      predictionClosesAt: new Date(now + 30 * 60_000).toISOString(),
      eventResolvesAt: new Date(now + eventOffsetMs).toISOString(),
      resolutionDeadline: new Date(now + eventOffsetMs + 30 * 60_000).toISOString(),
      settlementRule: "Manual live verification pool.",
      refundRule: "Refund if no manual majority by deadline.",
      evidenceRequirements: "Live verification evidence.",
    }),
  });
  log(`CREATE_${label}`, result);
  if (result.status !== 201) throw new Error(`create ${label} failed`);
  return result.body.pool;
}

function predictionBody(wallet, pool, outcome, txHash, referralCode = null) {
  const payload = {
    domain: "nimiq-pools",
    version: 1,
    poolId: pool.id,
    participantAddress: wallet.address,
    selectedOutcome: outcome,
    stakeAmountLuna: pool.stakeAmountLuna,
    predictionClosesAt: pool.predictionClosesAt,
    nonce: crypto.randomUUID(),
  };
  const predictionPayload = JSON.stringify(payload);
  return {
    address: wallet.address,
    predictedOutcome: outcome,
    predictionPayload,
    predictionPublicKey: wallet.publicKey,
    predictionSignature: signPayload(wallet, predictionPayload),
    stakeTxHash: txHash,
    stakeAmountLuna: pool.stakeAmountLuna,
    referralCode,
  };
}

async function claimReward(wallet, reward) {
  const payload = JSON.stringify({
    domain: "nimiq-pools-reward",
    version: 1,
    address: wallet.address,
    nonce: crypto.randomUUID(),
    rewardEventId: reward.id,
    amount: Number(reward.amount),
  });
  return api("/api/referrals/claim", {
    method: "POST",
    body: JSON.stringify({ address: wallet.address, rewardEventId: reward.id, payload, signature: signPayload(wallet, payload), publicKey: wallet.publicKey }),
  });
}

async function claimPayout(wallet, poolId) {
  const payload = JSON.stringify({ domain: "nimiq-pools-payout", version: 1, address: wallet.address, nonce: crypto.randomUUID(), poolId });
  return api(`/api/pools/${poolId}/claim`, {
    method: "POST",
    body: JSON.stringify({ address: wallet.address, payload, signature: signPayload(wallet, payload), publicKey: wallet.publicKey }),
  });
}

async function main() {
  const escrow = walletFromMnemonic(process.env.NIMIQ_ESCROW_MNEMONIC);
  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  if (cleanAddress(escrow.address) !== cleanAddress(process.env.NIMIQ_ESCROW_ADDRESS)) throw new Error("escrow mismatch");
  if (cleanAddress(rewards.address) !== cleanAddress(process.env.NIMIQ_REWARDS_POOL_ADDRESS)) throw new Error("rewards mismatch");

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NIMIQ_SEED_NODES: SEED, NIMIQ_CONSENSUS_TIMEOUT_MS: "90000" },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  let client;
  try {
    await waitForServer(server);
    client = await createClient();

    const refDash = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    const referralCode = refDash.body.referralCode.code;
    log("REFERRAL_CODE", referralCode);

    const validPool = await createPool("VALID", escrow.address, -30_000);
    const reusePool = await createPool("REUSE", escrow.address, 3_600_000);
    const txHash = await sendStake(client, rewards, escrow.address, STAKE, validPool.id);
    log("VALID_STAKE_BROADCAST", { poolId: validPool.id, txHash });
    const confirmations = await waitForConfirmations(client, txHash);
    log("VALID_STAKE_CONFIRMED", { txHash, confirmations });

    const join = await api(`/api/pools/${validPool.id}/join`, {
      method: "POST",
      body: JSON.stringify(predictionBody(rewards, validPool, "Yes", txHash, referralCode)),
    });
    log("VALID_JOIN", join);

    const reuse = await api(`/api/pools/${reusePool.id}/join`, {
      method: "POST",
      body: JSON.stringify(predictionBody(rewards, reusePool, "Yes", txHash)),
    });
    log("REUSE_JOIN", reuse);

    const participantDash = await api(`/api/referrals?address=${encodeURIComponent(rewards.address)}`);
    const referrerDash = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    log("REWARDS_UNLOCKED", {
      participantSignup: participantDash.body.signupReward,
      referrerReferral: (referrerDash.body.claimableRewards || []).find((item) => item.type === "referral") || null,
    });

    const referralReward = (referrerDash.body.claimableRewards || []).find((item) => item.type === "referral");
    if (referralReward) log("REWARD_CLAIM", await claimReward(escrow, referralReward));
    else log("REWARD_CLAIM", { skipped: true, reason: "No referral reward unlocked" });

    log("VOTE", await api(`/api/pools/${validPool.id}/vote`, {
      method: "POST",
      body: JSON.stringify({ address: rewards.address, outcome: "Yes", evidenceNote: "Live finish winning vote." }),
    }));
    log("RESOLVE_DUE", await api("/api/admin/resolve-due", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({}),
    }));
    log("PAYOUT_CLAIM", await claimPayout(rewards, validPool.id));
    log("RECONCILIATION", await api("/api/admin/reconciliation", {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    }));
  } finally {
    try { if (client?.disconnectNetwork) await client.disconnectNetwork(); } catch {}
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
