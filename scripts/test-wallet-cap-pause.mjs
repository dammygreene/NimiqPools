import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.LIMITS_TEST_PORT || 3232);
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = (process.env.NIMIQ_SEED_NODES || "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss")
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);
const TEST_ADMIN_TOKEN = "limits-test-token";
const WALLET_CAP_LUNA = 150_000;
const POOL_CAP_LUNA = 1_000_000;
const STAKE_LUNA = 100_000;

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
  config.seedNodes(SEED);
  config.logLevel("warn");
  const client = await Nimiq.Client.create(config.build());
  await client.waitForConsensusEstablished();
  return client;
}

async function sendTx(client, wallet, recipientAddress, amount, data = "") {
  const sender = Nimiq.Address.fromUserFriendlyAddress(wallet.address);
  const recipient = Nimiq.Address.fromUserFriendlyAddress(recipientAddress);
  const height = await client.getHeadHeight();
  const networkId = await client.getNetworkId();
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    sender,
    recipient,
    new TextEncoder().encode(data),
    BigInt(amount),
    BigInt(0),
    height,
    networkId,
  );
  tx.sign(wallet.keyPair);
  const result = await client.sendTransaction(tx);
  return String(result?.transactionHash ?? result?.hash ?? tx.hash());
}

async function waitForConfirmations(client, txHash, min = 2, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const tx = await client.getTransaction(txHash);
      const blockHeight = numberValue(tx?.blockHeight);
      if (Number.isFinite(blockHeight) && blockHeight > 0) {
        const head = numberValue(await client.getHeadHeight());
        last = Math.max(0, head - blockHeight + 1);
      }
      if (last >= min) return last;
    } catch {}
    await delay(2000);
  }
  throw new Error(`Timed out waiting for confirmations for ${txHash}; last=${last}`);
}

async function createPool(label, creatorAddress, stakeAmountLuna) {
  const now = Date.now();
  const result = await api("/api/pools", {
    method: "POST",
    body: JSON.stringify({
      question: `Limits verification ${label} ${new Date().toISOString()}`,
      category: "manual",
      resolverType: "MANUAL",
      resolverConfig: {},
      outcomes: ["Yes", "No"],
      stakeAmountLuna,
      creatorAddress,
      predictionClosesAt: new Date(now + 30 * 60_000).toISOString(),
      eventResolvesAt: new Date(now + 60 * 60_000).toISOString(),
      resolutionDeadline: new Date(now + 90 * 60_000).toISOString(),
      settlementRule: "Limits verification pool.",
      refundRule: "Refund if no manual majority by deadline.",
      evidenceRequirements: "Limits verification evidence.",
    }),
  });
  if (result.status !== 201) throw new Error(`Pool creation failed for ${label}: ${JSON.stringify(result)}`);
  return result.body.pool;
}

function predictionBody(wallet, pool, outcome, txHash) {
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
  };
}

async function main() {
  const escrow = walletFromMnemonic(process.env.NIMIQ_ESCROW_MNEMONIC);
  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  if (cleanAddress(escrow.address) !== cleanAddress(process.env.NIMIQ_ESCROW_ADDRESS)) throw new Error("Escrow mnemonic/address mismatch.");
  if (cleanAddress(rewards.address) !== cleanAddress(process.env.NIMIQ_REWARDS_POOL_ADDRESS)) throw new Error("Rewards mnemonic/address mismatch.");

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      MAX_STAKE_PER_WALLET: String(WALLET_CAP_LUNA),
      MAX_POOL_TOTAL: String(POOL_CAP_LUNA),
      NIMIQ_SEED_NODES: SEED.join(","),
      NIMIQ_CONSENSUS_TIMEOUT_MS: "90000",
    },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  let client;
  const report = {};

  try {
    await waitForServer(server);
    client = await createClient();

    report.config = await api("/api/config");
    report.initialBalances = {
      rewardsLuna: await getBalance(client, rewards.address),
      escrowLuna: await getBalance(client, escrow.address),
    };

    const walletCapPool = await createPool("wallet-cap", escrow.address, STAKE_LUNA);
    const walletCapTx = await sendTx(client, rewards, escrow.address, STAKE_LUNA, `POOL:${walletCapPool.id}`);
    report.walletCap = {
      poolId: walletCapPool.id,
      txHash: walletCapTx,
      confirmations: await waitForConfirmations(client, walletCapTx),
      response: await api(`/api/pools/${walletCapPool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, walletCapPool, "Yes", walletCapTx)),
      }),
    };

    report.pauseBefore = await api("/api/admin/pause", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    report.pauseSet = await api("/api/admin/pause", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: JSON.stringify({ paused: true }),
    });

    const pausedPool = await createPool("paused-join", escrow.address, STAKE_LUNA);
    const pausedTx = await sendTx(client, rewards, escrow.address, STAKE_LUNA, `POOL:${pausedPool.id}`);
    report.pause = {
      poolId: pausedPool.id,
      txHash: pausedTx,
      confirmations: await waitForConfirmations(client, pausedTx),
      join: await api(`/api/pools/${pausedPool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(rewards, pausedPool, "Yes", pausedTx)),
      }),
      poolsRead: await api("/api/pools"),
      referralRead: await api(`/api/referrals?address=${encodeURIComponent(rewards.address)}`),
    };

    report.pauseUnset = await api("/api/admin/pause", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: JSON.stringify({ paused: false }),
    });
    report.pauseFinal = await api("/api/admin/pause", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
  } catch (error) {
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.log(JSON.stringify(report, null, 2));
    throw error;
  } finally {
    try {
      if (client?.disconnectNetwork) await client.disconnectNetwork();
    } catch {}
    server.kill();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
