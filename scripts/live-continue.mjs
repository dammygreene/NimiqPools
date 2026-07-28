import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.LIVE_VERIFY_PORT || 3221);
const BASE = `http://127.0.0.1:${PORT}`;
const POOLS = {
  txNotFound: "774EBF25",
  wrongAmount: "3DE14A0C",
  valid: "FB136A57",
  reuse: "F2E3E0E9",
};
const HASHES = {
  wrongAmount: "463245861f571aa60880c3694d667e99ee847c6dce2276988f23d72ae83dbe33",
  valid: "dd32c82ff87358e9ebb976eb4aadfb78cc397819d5fdddba18b8373dbd6eb168",
};

function cleanAddress(value) {
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function walletFromMnemonic(mnemonic) {
  const { keyPair, address } = deriveSigningWalletFromMnemonic(mnemonic);
  return {
    keyPair,
    address,
    publicKey: keyPair.publicKey.toHex(),
  };
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
    if (child.exitCode != null) throw new Error(`Next dev server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/api/config`);
      if (response.ok) return;
    } catch {}
    await delay(1000);
  }
  throw new Error("Timed out waiting for Next server");
}

async function getPool(id) {
  const pools = await api("/api/pools");
  const pool = pools.body.pools.find((item) => item.id === id);
  if (!pool) throw new Error(`Pool ${id} not found`);
  return pool;
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
  const payloadText = JSON.stringify(payload);
  return {
    address: wallet.address,
    predictedOutcome: outcome,
    predictionPayload: payloadText,
    predictionPublicKey: wallet.publicKey,
    predictionSignature: signPayload(wallet, payloadText),
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
    body: JSON.stringify({
      address: wallet.address,
      rewardEventId: reward.id,
      payload,
      signature: signPayload(wallet, payload),
      publicKey: wallet.publicKey,
    }),
  });
}

async function claimPayout(wallet, poolId) {
  const payload = JSON.stringify({
    domain: "nimiq-pools-payout",
    version: 1,
    address: wallet.address,
    nonce: crypto.randomUUID(),
    poolId,
  });
  return api(`/api/pools/${poolId}/claim`, {
    method: "POST",
    body: JSON.stringify({
      address: wallet.address,
      payload,
      signature: signPayload(wallet, payload),
      publicKey: wallet.publicKey,
    }),
  });
}

async function main() {
  const escrow = walletFromMnemonic(process.env.NIMIQ_ESCROW_MNEMONIC);
  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  if (cleanAddress(escrow.address) !== cleanAddress(process.env.NIMIQ_ESCROW_ADDRESS)) throw new Error("Escrow mismatch");
  if (cleanAddress(rewards.address) !== cleanAddress(process.env.NIMIQ_REWARDS_POOL_ADDRESS)) throw new Error("Rewards mismatch");

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NIMIQ_SEED_NODES: "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss", NIMIQ_CONSENSUS_TIMEOUT_MS: "90000" },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  const report = { pools: POOLS, hashes: HASHES, cases: {} };
  try {
    await waitForServer(server);
    const referrerDashboard = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    const referralCode = referrerDashboard.body.referralCode.code;

    const txNotFoundPool = await getPool(POOLS.txNotFound);
    const fakeHash = `FAKE${crypto.randomUUID().replaceAll("-", "").toUpperCase()}0000000000000000000000000000`.slice(0, 64);
    report.cases.txNotFound = {
      poolId: POOLS.txNotFound,
      txHash: fakeHash,
      response: await api(`/api/pools/${POOLS.txNotFound}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, txNotFoundPool, "Yes", fakeHash)),
      }),
    };

    const wrongPool = await getPool(POOLS.wrongAmount);
    report.cases.wrongAmount = {
      poolId: POOLS.wrongAmount,
      txHash: HASHES.wrongAmount,
      response: await api(`/api/pools/${POOLS.wrongAmount}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, wrongPool, "Yes", HASHES.wrongAmount)),
      }),
    };

    const validPool = await getPool(POOLS.valid);
    report.cases.validJoin = {
      poolId: POOLS.valid,
      txHash: HASHES.valid,
      response: await api(`/api/pools/${POOLS.valid}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, validPool, "Yes", HASHES.valid, referralCode)),
      }),
    };

    const reusePool = await getPool(POOLS.reuse);
    report.cases.reusedHash = {
      poolId: POOLS.reuse,
      txHash: HASHES.valid,
      response: await api(`/api/pools/${POOLS.reuse}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, reusePool, "Yes", HASHES.valid)),
      }),
    };

    const participantDashboard = await api(`/api/referrals?address=${encodeURIComponent(rewards.address)}`);
    const referrerDashboardAfterJoin = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    report.cases.validJoin.rewardsUnlocked = {
      participantSignup: participantDashboard.body.signupReward,
      referrerReferral: (referrerDashboardAfterJoin.body.claimableRewards || []).find((item) => item.type === "referral") || null,
    };

    const referralReward = report.cases.validJoin.rewardsUnlocked.referrerReferral;
    report.cases.rewardClaim = referralReward
      ? {
          rewardEventId: referralReward.id,
          amountNim: referralReward.amount,
          response: await claimReward(escrow, referralReward),
          dashboardAfter: await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`),
        }
      : { skipped: true, reason: "No referral reward unlocked." };

    report.cases.payout = {
      vote: await api(`/api/pools/${POOLS.valid}/vote`, {
        method: "POST",
        body: JSON.stringify({ address: rewards.address, outcome: "Yes", evidenceNote: "Live verification winning vote." }),
      }),
      resolveDue: await api("/api/admin/resolve-due", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
        body: JSON.stringify({}),
      }),
      claim: await claimPayout(rewards, POOLS.valid),
    };

    report.reconciliation = await api("/api/admin/reconciliation", {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    });
  } finally {
    server.kill();
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
