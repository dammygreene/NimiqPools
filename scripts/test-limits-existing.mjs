import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

process.loadEnvFile(".env.local");

const PORT = Number(process.env.LIMITS_TEST_PORT || 3233);
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_ADMIN_TOKEN = "limits-test-token";
const WALLET_CAP_LUNA = 150_000;
const POOL_CAP_LUNA = 1_000_000;
const REWARDS_ADDRESS = process.env.NIMIQ_REWARDS_POOL_ADDRESS;
const ESCROW_ADDRESS = process.env.NIMIQ_ESCROW_ADDRESS;
const REWARDS_STAKE_HASH = "463245861f571aa60880c3694d667e99ee847c6dce2276988f23d72ae83dbe33";
const REWARDS_POOL_ID = "3DE14A0C";

function dbPath() {
  return process.env.DATABASE_PATH || "data/nimiq-pools.db";
}

function ensurePoolFixture() {
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      category TEXT NOT NULL,
      resolver_type TEXT NOT NULL,
      resolver_config TEXT NOT NULL,
      outcomes TEXT NOT NULL,
      stake_amount_luna INTEGER NOT NULL CHECK(stake_amount_luna > 0),
      creator_address TEXT NOT NULL,
      escrow_address TEXT NOT NULL,
      prediction_closes_at TEXT NOT NULL,
      event_resolves_at TEXT NOT NULL,
      resolution_deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      resolved_outcome TEXT,
      observed_value TEXT,
      resolution_proof TEXT,
      created_at TEXT NOT NULL,
      settlement_rule TEXT NOT NULL,
      refund_rule TEXT NOT NULL,
      evidence_requirements TEXT NOT NULL
    );
  `);
  const now = new Date();
  const later = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();
  db.prepare(`
    INSERT INTO pools (
      id, share_id, question, category, resolver_type, resolver_config,
      outcomes, stake_amount_luna, creator_address, escrow_address,
      prediction_closes_at, event_resolves_at, resolution_deadline, status,
      resolved_outcome, observed_value, resolution_proof, created_at,
      settlement_rule, refund_rule, evidence_requirements
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      stake_amount_luna = excluded.stake_amount_luna,
      creator_address = excluded.creator_address,
      escrow_address = excluded.escrow_address,
      prediction_closes_at = excluded.prediction_closes_at,
      event_resolves_at = excluded.event_resolves_at,
      resolution_deadline = excluded.resolution_deadline,
      status = excluded.status,
      outcomes = excluded.outcomes,
      question = excluded.question,
      category = excluded.category,
      resolver_type = excluded.resolver_type,
      resolver_config = excluded.resolver_config,
      settlement_rule = excluded.settlement_rule,
      refund_rule = excluded.refund_rule,
      evidence_requirements = excluded.evidence_requirements
  `).run(
    REWARDS_POOL_ID,
    `limits-${REWARDS_POOL_ID.toLowerCase()}`,
    "Limits verification pool fixture",
    "manual",
    "MANUAL",
    "{}",
    JSON.stringify(["Yes", "No"]),
    90_000,
    REWARDS_ADDRESS,
    ESCROW_ADDRESS,
    later(30),
    later(60),
    later(90),
    "OPEN",
    now.toISOString(),
    "Fixture for live limit verification.",
    "Fixture for live limit verification.",
    "Fixture for live limit verification.",
  );
}

function cleaned(value) {
  return String(value).replace(/\s+/g, "").toUpperCase();
}

function api(path, options = {}) {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }));
}

async function waitForServer(child) {
  let lastError;
  for (let i = 0; i < 90; i += 1) {
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

function joinBody(address) {
  return {
    address,
    predictedOutcome: "Yes",
    predictionPayload: JSON.stringify({
      domain: "nimiq-pools",
      version: 1,
      poolId: REWARDS_POOL_ID,
      participantAddress: address,
      selectedOutcome: "Yes",
      stakeAmountLuna: 90_000,
      predictionClosesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      nonce: crypto.randomUUID(),
    }),
    predictionPublicKey: "test-public-key",
    predictionSignature: "test-signature",
    stakeTxHash: REWARDS_STAKE_HASH,
    stakeAmountLuna: 90_000,
  };
}

async function main() {
  if (!REWARDS_ADDRESS || !ESCROW_ADDRESS) throw new Error("Wallet addresses are not configured.");

  ensurePoolFixture();

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      MAX_STAKE_PER_WALLET: String(WALLET_CAP_LUNA),
      MAX_POOL_TOTAL: String(POOL_CAP_LUNA),
      NIMIQ_CONSENSUS_TIMEOUT_MS: "90000",
    },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  const report = {};
  let db;
  try {
    await waitForServer(server);

    db = new DatabaseSync(dbPath());
    const participantCount = db.prepare("SELECT COUNT(*) AS count FROM participants WHERE address = ?").get(REWARDS_ADDRESS);
    report.participantCount = participantCount;

    report.config = await api("/api/config");
    report.capAttempt = await api(`/api/pools/${REWARDS_POOL_ID}/join`, {
      method: "POST",
      body: JSON.stringify(joinBody(REWARDS_ADDRESS)),
    });

    report.pauseBefore = await api("/api/admin/pause", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    report.pauseSet = await api("/api/admin/pause", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: JSON.stringify({ paused: true }),
    });
    report.pauseAttempt = await api(`/api/pools/${REWARDS_POOL_ID}/join`, {
      method: "POST",
      body: JSON.stringify(joinBody(REWARDS_ADDRESS)),
    });
    report.poolsRead = await api("/api/pools");
    report.referralsRead = await api(`/api/referrals?address=${encodeURIComponent(REWARDS_ADDRESS)}`);
    report.pauseUnset = await api("/api/admin/pause", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      body: JSON.stringify({ paused: false }),
    });
    report.pauseFinal = await api("/api/admin/pause", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
  } catch (error) {
    report.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    console.log(JSON.stringify(report, null, 2));
    throw error;
  } finally {
    try {
      db?.close?.();
    } catch {}
    server.kill();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
