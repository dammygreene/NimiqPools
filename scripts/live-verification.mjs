import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.LIVE_VERIFY_PORT || 3217);
const BASE = `http://127.0.0.1:${PORT}`;
const SEEDS = (process.env.NIMIQ_SEED_NODES || "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss")
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);
const LUNA_PER_NIM = 100_000;
const STAKE = 100_000;
const WRONG_STAKE = 90_000;

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

function numberValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toString === "function") return Number(value.toString());
  return NaN;
}

async function getBalance(client, address) {
  const account = await client.getAccount(Nimiq.Address.fromUserFriendlyAddress(address));
  return numberValue(account?.balance ?? account?.value ?? account);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function waitForServer(child) {
  let lastError;
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) throw new Error(`Next dev server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/api/config`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for Next server: ${lastError?.message || "unknown error"}`);
}

async function createClient() {
  const config = new Nimiq.ClientConfiguration();
  config.network("TestAlbatross");
  config.seedNodes(SEEDS);
  config.logLevel("warn");
  const client = await Nimiq.Client.create(config.build());
  await client.waitForConsensusEstablished();
  return client;
}

async function sendStake(client, wallet, recipientAddress, amount, poolId) {
  const sender = Nimiq.Address.fromUserFriendlyAddress(wallet.address);
  const recipient = Nimiq.Address.fromUserFriendlyAddress(recipientAddress);
  const height = await client.getHeadHeight();
  const networkId = await client.getNetworkId();
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    sender,
    recipient,
    new TextEncoder().encode(`POOL:${poolId}`),
    BigInt(amount),
    BigInt(0),
    height,
    networkId,
  );
  tx.sign(wallet.keyPair);
  const result = await client.sendTransaction(tx);
  return String(result?.transactionHash ?? result?.hash ?? tx.hash());
}

async function waitForConfirmations(client, txHash, min = 2, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const transaction = await client.getTransaction(txHash);
      const blockHeight = numberValue(transaction?.blockHeight);
      if (Number.isFinite(blockHeight) && blockHeight > 0) {
        const head = numberValue(await client.getHeadHeight());
        last = Math.max(0, head - blockHeight + 1);
      }
      if (last >= min) return last;
    } catch {}
    await delay(2000);
  }
  throw new Error(`Timed out waiting for ${min} confirmations for ${txHash}; last=${last}`);
}

async function createPool(label, creatorAddress, eventOffsetMs = 3_600_000) {
  const now = Date.now();
  const result = await api("/api/pools", {
    method: "POST",
    body: JSON.stringify({
      question: `Live verification ${label} ${new Date().toISOString()}`,
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
  if (result.status !== 201) throw new Error(`Pool creation failed: ${JSON.stringify(result)}`);
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
  if (cleanAddress(escrow.address) !== cleanAddress(process.env.NIMIQ_ESCROW_ADDRESS)) throw new Error("Escrow mnemonic/address mismatch.");
  if (cleanAddress(rewards.address) !== cleanAddress(process.env.NIMIQ_REWARDS_POOL_ADDRESS)) throw new Error("Rewards mnemonic/address mismatch.");

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NIMIQ_CONSENSUS_TIMEOUT_MS: "90000", NIMIQ_SEED_NODES: SEEDS.join(",") },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  let client;
  const report = {
    seedNodes: SEEDS,
    wallets: {
      escrowAddress: escrow.address,
      rewardsAddress: rewards.address,
    },
    cases: {},
  };

  try {
    await waitForServer(server);
    client = await createClient();
    report.clientHead = Number(await client.getHeadHeight());
    report.initialBalances = {
      escrowLuna: Number(await getBalance(client, escrow.address)),
      rewardsLuna: Number(await getBalance(client, rewards.address)),
    };

    const refDashboard = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    const referralCode = refDashboard.body.referralCode?.code;

    const nonexistentPool = await createPool("TX_NOT_FOUND", escrow.address);
    const fabricated = `FAKE${crypto.randomUUID().replaceAll("-", "").toUpperCase()}0000000000000000000000000000`.slice(0, 64);
    report.cases.fabricatedTx = {
      poolId: nonexistentPool.id,
      txHash: fabricated,
      join: await api(`/api/pools/${nonexistentPool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, nonexistentPool, "Yes", fabricated)),
      }),
    };

    const wrongAmountPool = await createPool("AMOUNT_MISMATCH", escrow.address);
    const wrongAmountHash = await sendStake(client, rewards, escrow.address, WRONG_STAKE, wrongAmountPool.id);
    const wrongAmountConfirmations = await waitForConfirmations(client, wrongAmountHash);
    report.cases.wrongAmount = {
      poolId: wrongAmountPool.id,
      txHash: wrongAmountHash,
      confirmations: wrongAmountConfirmations,
      join: await api(`/api/pools/${wrongAmountPool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, wrongAmountPool, "Yes", wrongAmountHash)),
      }),
    };

    const validPool = await createPool("VALID_AND_PAYOUT", escrow.address, -30_000);
    const reusePool = await createPool("REUSE_REJECT", escrow.address);
    const validHash = await sendStake(client, rewards, escrow.address, STAKE, validPool.id);
    const validConfirmations = await waitForConfirmations(client, validHash);
    const validJoin = await api(`/api/pools/${validPool.id}/join`, {
      method: "POST",
      body: JSON.stringify(predictionBody(rewards, validPool, "Yes", validHash, referralCode)),
    });
    const reuseJoin = await api(`/api/pools/${reusePool.id}/join`, {
      method: "POST",
      body: JSON.stringify(predictionBody(rewards, reusePool, "Yes", validHash)),
    });
    const rewardsDashboard = await api(`/api/referrals?address=${encodeURIComponent(rewards.address)}`);
    const escrowDashboard = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
    report.cases.validJoin = {
      poolId: validPool.id,
      txHash: validHash,
      confirmations: validConfirmations,
      join: validJoin,
      rewardsUnlocked: {
        signupForParticipant: rewardsDashboard.body.signupReward ?? null,
        referralForReferrer: escrowDashboard.body.claimableRewards?.find((item) => item.type === "referral") ?? null,
      },
    };
    report.cases.reusedHash = {
      firstPoolId: validPool.id,
      secondPoolId: reusePool.id,
      txHash: validHash,
      secondJoin: reuseJoin,
    };

    const referralReward = report.cases.validJoin.rewardsUnlocked.referralForReferrer;
    if (!referralReward) {
      report.cases.rewardClaim = { skipped: true, reason: "No referral reward was unlocked for the referrer." };
    } else {
      const before = Number(await getBalance(client, process.env.NIMIQ_REWARDS_POOL_ADDRESS));
      const claim = await claimReward(escrow, referralReward);
      const afterDashboard = await api(`/api/referrals?address=${encodeURIComponent(escrow.address)}`);
      report.cases.rewardClaim = {
        rewardEventId: referralReward.id,
        amountNim: Number(referralReward.amount),
        rewardsPoolBalanceBeforeLuna: before,
        claim,
        afterRewardEvent: afterDashboard.body.signupReward?.id === referralReward.id
          ? afterDashboard.body.signupReward
          : [...(afterDashboard.body.claimableRewards || [])].find((item) => item.id === referralReward.id) ?? null,
      };
    }

    const vote = await api(`/api/pools/${validPool.id}/vote`, {
      method: "POST",
      body: JSON.stringify({ address: rewards.address, outcome: "Yes", evidenceNote: "Live verification winning vote." }),
    });
    const resolveDue = await api("/api/admin/resolve-due", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({}),
    });
    const escrowBefore = Number(await getBalance(client, process.env.NIMIQ_ESCROW_ADDRESS));
    const payoutClaim = await claimPayout(rewards, validPool.id);
    report.cases.payoutClaim = {
      poolId: validPool.id,
      vote,
      resolveDueForPool: resolveDue.body.results?.find((item) => item.poolId === validPool.id) ?? null,
      fullResolveDue: resolveDue,
      escrowBalanceBeforeLuna: escrowBefore,
      claim: payoutClaim,
    };

    report.reconciliation = await api("/api/admin/reconciliation", {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    });
  } catch (error) {
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.log(JSON.stringify(report, null, 2));
    throw error;
  } finally {
    try { if (client?.disconnectNetwork) await client.disconnectNetwork(); } catch {}
    server.kill();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
