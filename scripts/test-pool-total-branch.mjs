import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Nimiq from "@nimiq/core";
import { deriveSigningWalletFromMnemonic } from "../lib/nimiq-keys.ts";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.POOL_TOTAL_TEST_PORT || 3238);
const BASE = `http://127.0.0.1:${PORT}`;
const SEEDS = (process.env.NIMIQ_SEED_NODES || "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss")
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);
const TEST_ADMIN_TOKEN = "pool-total-test-token";
const MAX_STAKE_PER_WALLET_LUNA = 1_000_000;
const MAX_POOL_TOTAL_LUNA = 250_000;
const STAKE_LUNA = 100_000;
const FUNDING_LUNA = 150_000;
const STAKE_GAP_MS = Number(process.env.STAKE_GAP_MS || 30_000);
let currentStage = "starting";
let runningPoolTotal = 0;

function setStage(stage) {
  currentStage = stage;
  process.stderr.write(`[stage] ${stage}\n`);
}

function logMath(message) {
  process.stderr.write(`[math] ${message}\n`);
}

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

function tempWallet() {
  const keyPair = Nimiq.KeyPair.generate();
  return {
    keyPair,
    address: keyPair.publicKey.toAddress().toUserFriendlyAddress(),
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
  setStage("peer found");
  await client.waitForConsensusEstablished();
  setStage("consensus established");
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
  return { result, hash: String(result?.transactionHash ?? result?.hash ?? tx.hash()) };
}

async function waitForConfirmations(client, txHash, min = 2, timeoutMs = 240_000, label = "tx") {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  let tick = 0;
  process.stderr.write(`[confirm] waiting for ${label} ${txHash} to reach ${min} confirmation(s)\n`);
  while (Date.now() < deadline) {
    try {
      tick += 1;
      process.stderr.write(`[confirm] ${label} ${txHash} poll ${tick}: fetching transaction proof\n`);
      const tx = await Promise.race([
        client.getTransaction(txHash),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`getTransaction timed out for ${label} ${txHash}`)), 10_000)),
      ]);
      const blockHeight = numberValue(tx?.blockHeight);
      if (Number.isFinite(blockHeight) && blockHeight > 0) {
        process.stderr.write(`[confirm] ${label} ${txHash} poll ${tick}: fetching head height\n`);
        const head = await Promise.race([
          client.getHeadHeight(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`getHeadHeight timed out for ${label} ${txHash}`)), 10_000)),
        ]);
        last = Math.max(0, head - blockHeight + 1);
      }
      process.stderr.write(`[confirm] ${label} ${txHash}: ${last}/${min}\n`);
      if (last >= min) return last;
    } catch (error) {
      process.stderr.write(`[confirm] ${label} ${txHash} poll ${tick} error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await delay(2000);
  }
  throw new Error(`Timed out waiting for confirmations for ${txHash}; last=${last}`);
}

async function createPool(creatorAddress) {
  const now = Date.now();
  const result = await api("/api/pools", {
    method: "POST",
    body: JSON.stringify({
      question: `Pool total branch ${new Date().toISOString()}`,
      category: "manual",
      resolverType: "MANUAL",
      resolverConfig: {},
      outcomes: ["Yes", "No"],
      stakeAmountLuna: STAKE_LUNA,
      creatorAddress,
      predictionClosesAt: new Date(now + 30 * 60_000).toISOString(),
      eventResolvesAt: new Date(now + 60 * 60_000).toISOString(),
      resolutionDeadline: new Date(now + 90 * 60_000).toISOString(),
      settlementRule: "Pool total branch verification.",
      refundRule: "Refund if no manual majority by deadline.",
      evidenceRequirements: "Pool total branch verification.",
    }),
  });
  if (result.status !== 201) {
    throw new Error(`Pool creation failed: ${JSON.stringify(result)}`);
  }
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
  const hardTimeout = setTimeout(() => {
    console.error(JSON.stringify({ error: "hard timeout after 120000ms", stage: currentStage }));
    process.exit(124);
  }, 120_000);

  const escrow = walletFromMnemonic(process.env.NIMIQ_ESCROW_MNEMONIC);
  const rewards = walletFromMnemonic(process.env.NIMIQ_REWARDS_POOL_MNEMONIC);
  if (cleanAddress(escrow.address) !== cleanAddress(process.env.NIMIQ_ESCROW_ADDRESS)) throw new Error("Escrow mnemonic/address mismatch.");
  if (cleanAddress(rewards.address) !== cleanAddress(process.env.NIMIQ_REWARDS_POOL_ADDRESS)) throw new Error("Rewards mnemonic/address mismatch.");

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      MAX_STAKE_PER_WALLET: String(MAX_STAKE_PER_WALLET_LUNA),
      MAX_POOL_TOTAL: String(MAX_POOL_TOTAL_LUNA),
      NIMIQ_CONFIRMATIONS_REQUIRED: "1",
      NIMIQ_SEED_NODES: SEEDS.join(","),
      NIMIQ_CONSENSUS_TIMEOUT_MS: "90000",
    },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  const report = {};
  let client;
  try {
    setStage("connecting");
    await waitForServer(server);
    setStage("creating client");
    client = await createClient();

    const wallets = [rewards, tempWallet(), tempWallet()];
    report.wallets = wallets.map((wallet) => ({ address: wallet.address }));

    setStage("funding wallets");
    const [fundingTx1, fundingTx2] = await Promise.all([
      sendTx(client, rewards, wallets[1].address, FUNDING_LUNA, "POOL_TOTAL_TEST:fund"),
      sendTx(client, rewards, wallets[2].address, FUNDING_LUNA, "POOL_TOTAL_TEST:fund"),
    ]);
    await Promise.all([
      waitForConfirmations(client, fundingTx1.hash, 1, 120_000, "funding-1"),
      waitForConfirmations(client, fundingTx2.hash, 1, 120_000, "funding-2"),
    ]);
    await delay(5000);
    report.funding = { txHashes: [fundingTx1.hash, fundingTx2.hash], rawBroadcastResults: [fundingTx1.result, fundingTx2.result] };
    logMath(`pool total after funding = ${runningPoolTotal} Luna`);

    setStage("pool created");
    const pool = await createPool(escrow.address);
    report.pool = { id: pool.id, stakeAmountLuna: pool.stakeAmountLuna };

    setStage("stake 1 sent");
    const joins = [];
    for (let i = 0; i < 2; i += 1) {
      const wallet = wallets[i];
      const broadcast = await sendTx(client, wallet, escrow.address, STAKE_LUNA, `POOL:${pool.id}`);
      process.stderr.write(`[broadcast] stake ${i + 1} raw result: ${JSON.stringify(broadcast.result)}\n`);
      process.stderr.write(`[broadcast] stake ${i + 1} hash: ${broadcast.hash}\n`);
      process.stderr.write(`[broadcast] stake ${i + 1} waiting for confirmation polling before join route\n`);
      const confirmations = await waitForConfirmations(client, broadcast.hash, 1, 120_000, `stake-${i + 1}`);
      logMath(`running pool total before join ${i + 1} = ${runningPoolTotal + STAKE_LUNA} Luna if accepted`);
      process.stderr.write(`[route] posting join ${i + 1} for pool ${pool.id}\n`);
      const response = await api(`/api/pools/${pool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(wallet, pool, i === 0 ? "Yes" : "No", broadcast.hash)),
      });
      process.stderr.write(`[route] join ${i + 1} response: ${JSON.stringify(response)}\n`);
      runningPoolTotal += STAKE_LUNA;
      logMath(`running pool total after stake ${i + 1} = ${runningPoolTotal} Luna`);
      joins.push({ wallet: wallet.address, txHash: broadcast.hash, confirmations, response });
      if (i === 0) {
        setStage("stake 2 sent");
        logMath(`spacing before stake 2 = ${STAKE_GAP_MS} ms`);
        await delay(STAKE_GAP_MS);
      }
    }

    setStage("over-cap stake attempted");
    const overWallet = wallets[2];
    logMath(`planned stake 3 amount = ${STAKE_LUNA} Luna; projected total = ${runningPoolTotal + STAKE_LUNA} Luna; cap = ${MAX_POOL_TOTAL_LUNA} Luna`);
    let overTxHash = "";
    let overConfirmations = 0;
    let overResponse;
    try {
      const overBroadcast = await sendTx(client, overWallet, escrow.address, STAKE_LUNA, `POOL:${pool.id}`);
      process.stderr.write(`[broadcast] stake 3 raw result: ${JSON.stringify(overBroadcast.result)}\n`);
      process.stderr.write(`[broadcast] stake 3 hash: ${overBroadcast.hash}\n`);
      process.stderr.write(`[broadcast] stake 3 waiting for confirmation polling before join route\n`);
      overTxHash = overBroadcast.hash;
      overConfirmations = await waitForConfirmations(client, overBroadcast.hash, 1, 120_000, "stake-3");
      process.stderr.write(`[route] posting over-cap join for pool ${pool.id}\n`);
      overResponse = await api(`/api/pools/${pool.id}/join`, {
        method: "POST",
        body: JSON.stringify(predictionBody(overWallet, pool, "Yes", overBroadcast.hash)),
      });
      process.stderr.write(`[route] over-cap join response: ${JSON.stringify(overResponse)}\n`);
    } catch (error) {
      process.stderr.write(`[error] stake 3 construction/broadcast failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      throw error;
    }
    setStage("response received");

    report.joins = joins;
    report.overCap = {
      wallet: overWallet.address,
      txHash: overTxHash,
      confirmations: overConfirmations,
      response: overResponse,
    };

    report.poolState = await api("/api/pools");
  } catch (error) {
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.log(JSON.stringify(report, null, 2));
    throw error;
  } finally {
    clearTimeout(hardTimeout);
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
