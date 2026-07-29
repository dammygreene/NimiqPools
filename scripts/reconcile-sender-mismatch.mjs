import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import {
  Address,
  Client,
  ClientConfiguration,
  PublicKey,
  Signature,
} from "@nimiq/core";

const DEFAULT_MAINALBATROSS_SEED_NODES = [
  "/dns4/aurora.seed.nimiq.com/tcp/443/wss",
  "/dns4/nexus.seed.nimiq.network/tcp/443/wss",
];
const DEFAULT_TESTALBATROSS_SEED_NODES = ["/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss"];
const LUNA_PER_NIM = 100_000;
const NIMIQ_SIGNED_MESSAGE_PREFIX = "\x16Nimiq Signed Message:\n";

loadEnvFiles();

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      console.log(`Loaded ${file}`);
    } catch (error) {
      console.warn(`Could not load ${file}:`, error instanceof Error ? error.message : String(error));
    }
  }
}

function normalizeAddress(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    try {
      return Address.fromString(trimmed).toUserFriendlyAddress().replace(/\s+/g, "").toUpperCase();
    } catch {
      return trimmed.replace(/\s+/g, "").toUpperCase();
    }
  }
  if (typeof value.toUserFriendlyAddress === "function") {
    return String(value.toUserFriendlyAddress()).replace(/\s+/g, "").toUpperCase();
  }
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function canonicalAddress(value) {
  return Address.fromString(String(value).trim()).toUserFriendlyAddress();
}

function normalizeHex(value, bytes) {
  const compact = String(value ?? "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-f]+$/i.test(compact) || compact.length !== bytes * 2) {
    throw new Error(`Expected ${bytes * 2} hex characters, received "${value}".`);
  }
  return compact;
}

function utf8Bytes(text) {
  return Buffer.from(text, "utf8");
}

function nimiqSignedMessageHash(message) {
  return crypto
    .createHash("sha256")
    .update(utf8Bytes(`${NIMIQ_SIGNED_MESSAGE_PREFIX}${message.length}${message}`))
    .digest();
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const dbArg = argv.slice(2).find((arg) => arg.startsWith("--db="));
  return {
    apply: flags.has("--apply"),
    dbPath: dbArg ? dbArg.slice("--db=".length) : null,
  };
}

function networkName(network) {
  return network === "mainnet" ? "MainAlbatross" : "TestAlbatross";
}

async function createClient() {
  const network = (process.env.NIMIQ_NETWORK || "testnet").trim().toLowerCase();
  const config = new ClientConfiguration();
  config.network(networkName(network));
  const configuredSeedNodes = (process.env.NIMIQ_SEED_NODES || "")
    .split(",")
    .map((seed) => seed.trim())
    .filter(Boolean);
  config.seedNodes(
    configuredSeedNodes.length > 0
      ? configuredSeedNodes
      : network === "mainnet"
        ? DEFAULT_MAINALBATROSS_SEED_NODES
        : DEFAULT_TESTALBATROSS_SEED_NODES,
  );
  const client = await Client.create(config.build());
  await client.waitForConsensusEstablished();
  return client;
}

async function getTransaction(client, hash) {
  let details = null;
  try {
    details = await client.getTransaction(hash);
  } catch {
    const receipt = await client.getTransactionReceipt(hash).catch(() => null);
    if (!receipt) return null;
    details = await client.getTransaction(hash, receipt.blockHash, receipt.blockHeight).catch(() => null);
  }
  if (!details) return null;
  const tx = details.transaction ?? details;
  return {
    hash: String(details.transactionHash ?? details.hash ?? tx.hash ?? hash),
    sender: normalizeAddress(tx.sender ?? details.sender),
    senderDisplay: typeof (tx.sender ?? details.sender)?.toUserFriendlyAddress === "function"
      ? (tx.sender ?? details.sender).toUserFriendlyAddress()
      : String(tx.sender ?? details.sender ?? ""),
    recipient: normalizeAddress(tx.recipient ?? details.recipient),
    recipientDisplay: typeof (tx.recipient ?? details.recipient)?.toUserFriendlyAddress === "function"
      ? (tx.recipient ?? details.recipient).toUserFriendlyAddress()
      : String(tx.recipient ?? details.recipient ?? ""),
    value: Number(tx.value ?? details.value),
    blockHeight: Number(details.blockHeight ?? tx.blockHeight ?? 0) || null,
  };
}

async function getConfirmations(client, tx) {
  if (!tx?.blockHeight) return 0;
  const head = Number(await client.getHeadHeight());
  return Math.max(0, head - tx.blockHeight + 1);
}

function verifyPrediction(requestBody, poolId, stakeAmountLuna) {
  const payloadText = String(requestBody.predictionPayload || "");
  const payload = JSON.parse(payloadText);
  if (payload.domain !== "nimiq-pools") throw new Error("Prediction payload domain mismatch.");
  if (payload.version !== 1) throw new Error("Prediction payload version mismatch.");
  if (payload.poolId !== poolId) throw new Error("Prediction payload pool mismatch.");
  if (Number(payload.stakeAmountLuna) !== stakeAmountLuna) throw new Error("Prediction payload amount mismatch.");
  const payloadAddress = canonicalAddress(payload.participantAddress);
  const publicKey = PublicKey.fromHex(normalizeHex(requestBody.predictionPublicKey, 32));
  const signature = Signature.fromHex(normalizeHex(requestBody.predictionSignature, 64));
  const publicKeyAddress = publicKey.toAddress().toUserFriendlyAddress();
  const signedMessageVerified = publicKey.verify(signature, nimiqSignedMessageHash(payloadText));
  const rawPayloadVerified = publicKey.verify(signature, utf8Bytes(payloadText));
  if (!signedMessageVerified && !rawPayloadVerified) throw new Error("Prediction signature is invalid.");
  if (normalizeAddress(payloadAddress) !== normalizeAddress(publicKeyAddress)) {
    throw new Error("Prediction public key address does not match payload participant address.");
  }
  return {
    payload,
    authoritativeAddress: payloadAddress,
    publicKeyAddress,
  };
}

function dbHasTable(db, table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) != null;
}

function countFailedSenderMismatch(db) {
  if (!dbHasTable(db, "join_attempts")) return 0;
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM join_attempts
    WHERE failure_code = 'SENDER_MISMATCH'
      AND status = 'failed'
  `).get().count || 0);
}

function candidateDbPaths(explicitPath) {
  if (explicitPath) return [resolve(process.cwd(), explicitPath)];
  const configured = process.env.DATABASE_PATH ? resolve(process.cwd(), process.env.DATABASE_PATH) : null;
  const dataDir = resolve(process.cwd(), "data");
  const discovered = existsSync(dataDir)
    ? readdirSync(dataDir)
      .filter((name) => /\.(db|sqlite|sqlite3)$/i.test(name))
      .map((name) => resolve(dataDir, name))
    : [];
  return [...new Set([configured, resolve(process.cwd(), "data/nimiq-pools-mainnet.db"), ...discovered, resolve(process.cwd(), "data/nimiq-pools.db")].filter(Boolean))];
}

function selectDbPath(explicitPath) {
  const paths = candidateDbPaths(explicitPath);
  let fallback = paths[0];
  let best = null;

  for (const path of paths) {
    if (!existsSync(path)) {
      if (!fallback) fallback = path;
      continue;
    }
    const db = new DatabaseSync(path);
    const failedSenderMismatch = countFailedSenderMismatch(db);
    const hasJoinAttempts = dbHasTable(db, "join_attempts");
    db.close();
    console.log(JSON.stringify({ candidateDb: path, joinAttempts: hasJoinAttempts, failedSenderMismatch }));
    if (failedSenderMismatch > 0) {
      best = path;
      break;
    }
    if (hasJoinAttempts && !best) best = path;
  }

  return best || fallback;
}

function loadDb(explicitPath) {
  const path = selectDbPath(explicitPath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  ensureJoinAttemptsTable(db);
  console.log(`Using database: ${path}`);
  return db;
}

function ensureJoinAttemptsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS join_attempts (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      request_address TEXT,
      authoritative_address TEXT,
      predicted_outcome TEXT,
      stake_tx_hash_submitted TEXT,
      stake_tx_hash_verified TEXT,
      stake_amount_luna INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'failed', 'reconciled', 'refund_required')),
      failure_code TEXT,
      failure_reason TEXT,
      debug_json TEXT,
      request_body TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getAttempts(db) {
  return db.prepare(`
    SELECT *
    FROM join_attempts
    WHERE failure_code = 'SENDER_MISMATCH'
      AND status = 'failed'
    ORDER BY created_at ASC
  `).all();
}

function transactionHashUsed(db, txHash) {
  const participant = db.prepare("SELECT 1 FROM participants WHERE stake_tx_hash = ? LIMIT 1").get(txHash);
  const reward = db.prepare("SELECT 1 FROM reward_events WHERE trigger_tx_hash = ? OR claim_tx_hash = ? LIMIT 1").get(txHash, txHash);
  const payout = db.prepare("SELECT 1 FROM payouts WHERE trigger_tx_hash = ? OR payout_tx_hash = ? LIMIT 1").get(txHash, txHash);
  return Boolean(participant || reward || payout);
}

function backfillParticipant(db, attempt, requestBody, authoritativeAddress, verifiedHash) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO participants (
    id, pool_id, address, predicted_outcome, prediction_payload,
    prediction_public_key, prediction_signature, stake_tx_hash,
    stake_amount_luna, joined_at, is_demo
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
    crypto.randomUUID(),
    attempt.pool_id,
    authoritativeAddress,
    String(requestBody.predictedOutcome),
    String(requestBody.predictionPayload || ""),
    String(requestBody.predictionPublicKey || ""),
    String(requestBody.predictionSignature || ""),
    verifiedHash,
    Number(attempt.stake_amount_luna),
    now,
  );
  db.prepare(`
    UPDATE join_attempts
    SET status = 'reconciled',
        authoritative_address = ?,
        stake_tx_hash_verified = ?,
        updated_at = ?
    WHERE id = ?
  `).run(authoritativeAddress, verifiedHash, now, attempt.id);
}

async function main() {
  const args = parseArgs(process.argv);
  const db = loadDb(args.dbPath);
  const attempts = getAttempts(db);
  console.log(`Found ${attempts.length} failed SENDER_MISMATCH join attempt(s).`);
  if (attempts.length === 0) return;

  const escrowAddress = canonicalAddress(process.env.NIMIQ_ESCROW_ADDRESS);
  const confirmationsRequired = Math.max(1, Number(process.env.NIMIQ_CONFIRMATIONS_REQUIRED || 1));
  const client = await createClient();

  for (const attempt of attempts) {
    const report = {
      joinAttemptId: attempt.id,
      poolId: attempt.pool_id,
      submittedTxHash: attempt.stake_tx_hash_submitted,
      status: "refund_required",
      reason: "",
    };
    try {
      if (!attempt.request_body) throw new Error("Missing request_body; cannot reconstruct the participant safely.");
      const requestBody = JSON.parse(String(attempt.request_body));
      const verified = verifyPrediction(requestBody, String(attempt.pool_id), Number(attempt.stake_amount_luna));
      const tx = await getTransaction(client, String(attempt.stake_tx_hash_submitted));
      if (!tx) throw new Error("Transaction not found on-chain.");
      const confirmations = await getConfirmations(client, tx);
      if (confirmations < confirmationsRequired) throw new Error(`Transaction has ${confirmations} confirmation(s); ${confirmationsRequired} required.`);
      if (tx.recipient !== normalizeAddress(escrowAddress)) {
        throw new Error(`Recipient mismatch. actual=${tx.recipientDisplay} expected=${escrowAddress}`);
      }
      if (tx.value !== Number(attempt.stake_amount_luna)) {
        throw new Error(`Amount mismatch. actual=${tx.value} expected=${attempt.stake_amount_luna}`);
      }
      if (transactionHashUsed(db, tx.hash)) {
        throw new Error("Transaction hash is already used elsewhere.");
      }

      const participantAddress = canonicalAddress(tx.senderDisplay || tx.sender);
      const signerMatchesPayer = tx.sender === normalizeAddress(verified.authoritativeAddress);
      report.status = args.apply ? "reconciled" : "eligible";
      report.reason = signerMatchesPayer
        ? "Confirmed sender, recipient, amount, and signed participant address all match."
        : "Confirmed recipient, amount, and on-chain payer. Signed participant differs, so this will backfill the participant as the actual on-chain sender.";
      report.authoritativeAddress = participantAddress;
      report.signedAuthoritativeAddress = verified.authoritativeAddress;
      report.signerMatchesPayer = signerMatchesPayer;
      report.tx = {
        hash: tx.hash,
        sender: tx.senderDisplay,
        recipient: tx.recipientDisplay,
        amountLuna: tx.value,
        amountNim: tx.value / LUNA_PER_NIM,
        confirmations,
      };

      if (args.apply) {
        backfillParticipant(db, attempt, requestBody, participantAddress, tx.hash);
      }
    } catch (error) {
      report.reason = error instanceof Error ? error.message : String(error);
      if (args.apply) {
        db.prepare(`
          UPDATE join_attempts
          SET status = 'refund_required',
              failure_reason = ?,
              updated_at = ?
          WHERE id = ?
        `).run(report.reason, new Date().toISOString(), attempt.id);
      }
    }

    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
