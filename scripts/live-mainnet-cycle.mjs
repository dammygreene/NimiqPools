import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { DEFAULT_MAINALBATROSS_SEED_NODES } from "../lib/nimiq-service.ts";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const BASE = process.env.LIVE_MAINNET_BASE || "http://127.0.0.1:3006";
const STAKE_LUNA = 100_000;
const PARTICIPANT_FUND_LUNA = 200_000;
const CONFIRMATIONS_REQUIRED = Number(process.env.NIMIQ_CONFIRMATIONS_REQUIRED || 2);

function cleanAddress(value) {
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function walletFromKeyPair(keyPair) {
  return {
    keyPair,
    address: keyPair.publicKey.toAddress().toUserFriendlyAddress(),
    publicKey: keyPair.publicKey.toHex(),
  };
}

function signPayload(wallet, payload) {
  return wallet.keyPair.sign(Buffer.from(payload, "utf8")).toHex();
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
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/config`);
      if (response.ok) return;
    } catch {}
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${BASE}`);
}

async function createClient() {
  const config = new Nimiq.ClientConfiguration();
  config.network("MainAlbatross");
  config.seedNodes(DEFAULT_MAINALBATROSS_SEED_NODES);
  config.logLevel("warn");
  const client = await Nimiq.Client.create(config.build());
  await client.waitForConsensusEstablished();
  return client;
}

async function waitForConfirmations(client, txHash, min = CONFIRMATIONS_REQUIRED, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const tx = await client.getTransaction(txHash);
      if (tx?.blockHeight) {
        const head = Number(await client.getHeadHeight());
        last = Math.max(0, head - Number(tx.blockHeight) + 1);
        if (last >= min) return last;
      }
    } catch {}
    await delay(2000);
  }
  throw new Error(`Timed out waiting for ${min} confirmations for ${txHash}; last=${last}`);
}

async function sendBasicTx(client, fromWallet, toAddress, amountLuna, data = "") {
  const sender = Nimiq.Address.fromUserFriendlyAddress(fromWallet.address);
  const recipient = Nimiq.Address.fromUserFriendlyAddress(toAddress);
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    sender,
    recipient,
    new TextEncoder().encode(data),
    BigInt(amountLuna),
    BigInt(0),
    await client.getHeadHeight(),
    await client.getNetworkId(),
  );
  tx.sign(fromWallet.keyPair);
  const result = await client.sendTransaction(tx);
  return String(result?.transactionHash ?? result?.hash ?? tx.hash());
}

function rewardPayload({ wallet, rewardEventId, amount }) {
  return JSON.stringify({
    domain: "nimiq-pools-reward",
    version: 1,
    address: wallet.address,
    nonce: crypto.randomUUID(),
    rewardEventId,
    amount,
  });
}

function payoutPayload({ wallet, poolId }) {
  return JSON.stringify({
    domain: "nimiq-pools-payout",
    version: 1,
    address: wallet.address,
    nonce: crypto.randomUUID(),
    poolId,
  });
}

async function main() {
  const stage = (label) => console.log(`[stage] ${label}`);
  await waitForServer();
  stage("server ready");
  const client = await createClient();
  stage("consensus established");

  const escrow = deriveSigningWalletFromMnemonic(process.env.NIMIQ_ESCROW_MNEMONIC.trim());
  const rewards = deriveSigningWalletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC.trim());
  const referrerKeyPair = Nimiq.KeyPair.generate();
  const referrer = walletFromKeyPair(referrerKeyPair);
  const participantKeyPair = Nimiq.KeyPair.generate();
  const participant = walletFromKeyPair(participantKeyPair);
  stage(`wallets ready participant=${cleanAddress(participant.address)} referrer=${cleanAddress(referrer.address)}`);

  stage("funding participant");
  const fundingHash = await sendBasicTx(client, rewards, participant.address, PARTICIPANT_FUND_LUNA, "NIMIQ-POOLS:PARTICIPANT-FUND");
  stage(`funding broadcast ${fundingHash}`);
  await waitForConfirmations(client, fundingHash);
  stage(`funding confirmed ${fundingHash}`);

  const referralDashboard = await api(`/api/referrals?address=${encodeURIComponent(referrer.address)}`);
  const referralCode = typeof referralDashboard.referralCode === "string"
    ? referralDashboard.referralCode
    : String(referralDashboard.referralCode?.code || referralDashboard.referralCode?.referralCode || referralDashboard.referralCode || "");
  stage(`referral code ready ${referralCode}`);

  const now = Date.now();
  const pool = await api("/api/pools", {
    method: "POST",
    body: JSON.stringify({
      question: `Mainnet smoke cycle ${new Date(now).toISOString()}`,
      category: "manual",
      resolverType: "MANUAL",
      resolverConfig: {},
      outcomes: ["Yes", "No"],
      stakeAmountLuna: STAKE_LUNA,
      creatorAddress: escrow.address,
      predictionClosesAt: new Date(now + 5 * 60_000).toISOString(),
      eventResolvesAt: new Date(now - 60_000).toISOString(),
      resolutionDeadline: new Date(now + 30 * 60_000).toISOString(),
      settlementRule: "Mainnet smoke cycle.",
      refundRule: "Refund if unresolved by deadline.",
      evidenceRequirements: "Manual vote only.",
    }),
  });
  stage(`pool created ${pool.pool.id}`);

  const joinPayload = {
    domain: "nimiq-pools",
    version: 1,
    poolId: pool.pool.id,
    participantAddress: participant.address,
    selectedOutcome: "Yes",
    stakeAmountLuna: STAKE_LUNA,
    predictionClosesAt: pool.pool.predictionClosesAt,
    nonce: crypto.randomUUID(),
  };
  const joinText = JSON.stringify(joinPayload);
  stage("broadcasting participant stake");
  const stakeHash = await sendBasicTx(client, participant, escrow.address, STAKE_LUNA, `POOL:${pool.pool.id}`);
  stage(`stake broadcast ${stakeHash}`);
  await waitForConfirmations(client, stakeHash);
  stage(`stake confirmed ${stakeHash}`);

  stage("posting join");
  let joinResponse;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      joinResponse = await api(`/api/pools/${pool.pool.id}/join`, {
        method: "POST",
        body: JSON.stringify({
          address: participant.address,
          predictedOutcome: "Yes",
          predictionPayload: joinText,
          predictionPublicKey: participant.publicKey,
          predictionSignature: signPayload(participant, joinText),
          stakeTxHash: stakeHash,
          stakeAmountLuna: STAKE_LUNA,
          referralCode,
        }),
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/TX_NOT_FOUND|INSUFFICIENT_CONFIRMATIONS/.test(message) || attempt === 20) throw error;
      stage(`join retry ${attempt} because ${message}`);
      await delay(15000);
    }
  }
  stage(`join accepted ${joinResponse.verification?.transactionHash || "ok"}`);

  const participantRewards = await api(`/api/referrals?address=${encodeURIComponent(participant.address)}`);
  const participantSignup = participantRewards.claimableRewards.find((reward) => reward.type === "signup");
  if (!participantSignup) throw new Error("Participant signup reward was not created.");
  stage(`participant signup reward ${participantSignup.id}`);
  const participantRewardPayload = rewardPayload({ wallet: participant, rewardEventId: participantSignup.id, amount: participantSignup.amount });
  const participantRewardClaim = await api("/api/referrals/claim", {
    method: "POST",
    body: JSON.stringify({
      address: participant.address,
      rewardEventId: participantSignup.id,
      payload: participantRewardPayload,
      publicKey: participant.publicKey,
      signature: signPayload(participant, participantRewardPayload),
    }),
  });
  stage(`participant reward claimed ${participantRewardClaim.claimTxHash || participantRewardClaim.claimTxHash || "ok"}`);

  const referrerRewards = await api(`/api/referrals?address=${encodeURIComponent(referrer.address)}`);
  const referralReward = referrerRewards.claimableRewards.find((reward) => reward.type === "referral");
  if (!referralReward) throw new Error("Referral reward was not created.");
  stage(`referral reward ${referralReward.id}`);
  const referrerRewardPayload = rewardPayload({ wallet: referrer, rewardEventId: referralReward.id, amount: referralReward.amount });
  const referrerRewardClaim = await api("/api/referrals/claim", {
    method: "POST",
    body: JSON.stringify({
      address: referrer.address,
      rewardEventId: referralReward.id,
      payload: referrerRewardPayload,
      publicKey: referrer.publicKey,
      signature: signPayload(referrer, referrerRewardPayload),
    }),
  });
  stage(`referrer reward claimed ${referrerRewardClaim.claimTxHash || "ok"}`);

  stage("casting vote");
  await api(`/api/pools/${pool.pool.id}/vote`, {
    method: "POST",
    body: JSON.stringify({
      address: participant.address,
      outcome: "Yes",
      evidenceNote: "Mainnet smoke cycle vote.",
    }),
  });
  stage("resolving pool");

  const resolution = await api(`/api/pools/${pool.pool.id}/resolve`, {
    method: "POST",
  });
  stage(`pool resolved ${JSON.stringify(resolution)}`);

  const payoutPayloadText = payoutPayload({ wallet: participant, poolId: pool.pool.id });
  stage("claiming payout");
  const payoutClaim = await api(`/api/pools/${pool.pool.id}/claim`, {
    method: "POST",
    body: JSON.stringify({
      address: participant.address,
      payload: payoutPayloadText,
      publicKey: participant.publicKey,
      signature: signPayload(participant, payoutPayloadText),
    }),
  });
  stage(`payout claimed ${payoutClaim.payoutTxHash || "ok"}`);

  console.log(JSON.stringify({
    base: BASE,
    participant: cleanAddress(participant.address),
    referrer: cleanAddress(referrer.address),
    creator: cleanAddress(escrow.address),
    poolId: pool.pool.id,
    fundingHash,
    stakeHash,
    joinResponse,
    participantRewardClaim,
    referrerRewardClaim,
    resolution,
    payoutClaim,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
