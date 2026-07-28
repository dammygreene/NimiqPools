import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_ESCROW_ADDRESS =
  "NQ74 POOL ESCROW DEMO ONLY 0000 0000 0000 0000";
const DEFAULT_REWARDS_POOL_ADDRESS =
  "NQ18 REWARDS POOL DEMO 0000 0000 0000 0000";
const SIGNUP_REWARD_NIM = 100;
const REFERRAL_REWARD_NIM = 20;
const LUNA_PER_NIM = 100_000;
const DEFAULT_MAX_STAKE_PER_WALLET_LUNA = 150_000;
const DEFAULT_MAX_POOL_TOTAL_LUNA = 250_000;

type Sqlite = DatabaseSync;
type Row = Record<string, unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __nimiqPoolsDb: Sqlite | undefined;
}

function databasePath() {
  return resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATABASE_PATH || "data/nimiq-pools.db");
}

function runtimeNetwork() {
  return (process.env.NIMIQ_NETWORK || "testnet").trim().toLowerCase();
}

function isMainnet() {
  return runtimeNetwork() === "mainnet";
}

function configuredAddress(envName: string, fallback: string) {
  const value = process.env[envName]?.trim();
  if (value) return value;
  if (isMainnet()) {
    throw new Error(`${envName} must be configured when NIMIQ_NETWORK=mainnet.`);
  }
  return fallback;
}

function openDatabase(): Sqlite {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  initializeSchema(db);
  return db;
}

export function getDb(): Sqlite {
  globalThis.__nimiqPoolsDb ??= openDatabase();
  return globalThis.__nimiqPoolsDb;
}

function inTransaction<T>(db: Sqlite, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initializeSchema(db: Sqlite) {
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

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      predicted_outcome TEXT NOT NULL,
      prediction_payload TEXT NOT NULL,
      prediction_public_key TEXT NOT NULL,
      prediction_signature TEXT NOT NULL,
      stake_tx_hash TEXT NOT NULL UNIQUE,
      stake_amount_luna INTEGER NOT NULL CHECK(stake_amount_luna > 0),
      joined_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      UNIQUE(pool_id, address)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      submitted_by TEXT NOT NULL,
      proposed_outcome TEXT NOT NULL,
      evidence_url TEXT,
      description TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referral_codes (
      address TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      share_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referrals (
      referred_address TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      referrer_address TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'verified')),
      first_stake_tx_hash TEXT,
      created_at TEXT NOT NULL,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rewards_pool (
      address TEXT PRIMARY KEY,
      total_funded INTEGER NOT NULL CHECK(total_funded >= 0),
      total_funded_luna INTEGER NOT NULL DEFAULT 0 CHECK(total_funded_luna >= 0),
      total_distributed INTEGER NOT NULL CHECK(total_distributed >= 0),
      CHECK(total_distributed <= total_funded)
    );

    CREATE TABLE IF NOT EXISTS reward_events (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('signup', 'referral')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      trigger_tx_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'broadcast', 'claimed', 'failed')),
      claim_tx_hash TEXT,
      created_at TEXT NOT NULL,
      claimed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS participants_pool_idx ON participants(pool_id);
    CREATE INDEX IF NOT EXISTS participants_address_idx ON participants(address);
    CREATE INDEX IF NOT EXISTS evidence_pool_idx ON evidence(pool_id);
    CREATE INDEX IF NOT EXISTS reward_events_address_idx ON reward_events(address);
    CREATE UNIQUE INDEX IF NOT EXISTS reward_signup_once_idx
      ON reward_events(address) WHERE type = 'signup';
    CREATE UNIQUE INDEX IF NOT EXISTS reward_referral_trigger_idx
      ON reward_events(address, type, trigger_tx_hash);

    CREATE TABLE IF NOT EXISTS resolution_votes (
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      outcome TEXT NOT NULL,
      evidence_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY(pool_id,address)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      amount_luna INTEGER NOT NULL CHECK(amount_luna > 0),
      status TEXT NOT NULL CHECK(status IN ('pending','broadcast','completed','failed')),
      trigger_tx_hash TEXT NOT NULL,
      payout_tx_hash TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      UNIQUE(pool_id,address),
      UNIQUE(payout_tx_hash)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE reward_events ADD COLUMN broadcast_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE rewards_pool ADD COLUMN total_funded_luna INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("DROP TABLE IF EXISTS reward_events_new"); } catch {}
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('paused', '0')").run();


  const rewardsAddress = configuredAddress("NIMIQ_REWARDS_POOL_ADDRESS", DEFAULT_REWARDS_POOL_ADDRESS);
  const funded = positiveInteger(
    process.env.NIMIQ_REWARDS_POOL_FUNDED_NIM,
    100_000,
  );
  db.prepare(
    `INSERT OR IGNORE INTO rewards_pool
      (address, total_funded, total_funded_luna, total_distributed) VALUES (?, ?, ?, 0)`,
  ).run(rewardsAddress, funded, funded * LUNA_PER_NIM);

  db.prepare(
    `UPDATE rewards_pool
        SET total_funded_luna = CASE
              WHEN total_funded_luna > 0 THEN total_funded_luna
              ELSE total_funded * ?
            END
      WHERE address = ?`,
  ).run(LUNA_PER_NIM, rewardsAddress);

  if (!isMainnet() && process.env.SEED_DEMO_DATA !== "false") seedIfEmpty(db);
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isoFromNow(hours: number) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function getRewardsPoolRow(db: Sqlite): Row | undefined {
  const configuredAddress = process.env.NIMIQ_REWARDS_POOL_ADDRESS?.trim();
  if (configuredAddress) {
    const configured = db.prepare("SELECT * FROM rewards_pool WHERE address = ? LIMIT 1").get(configuredAddress) as Row | undefined;
    if (configured) return configured;
  }
  return db.prepare("SELECT * FROM rewards_pool ORDER BY rowid DESC LIMIT 1").get() as Row | undefined;
}

function seedIfEmpty(db: Sqlite) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM pools").get() as {
    count: number;
  };
  if (row.count > 0) return;

  const createdAt = new Date().toISOString();
  const creator = "NQ18 CREATOR DEMO ADDRESS 0000 0000 0000 0000";
  const escrow = configuredAddress("NIMIQ_ESCROW_ADDRESS", DEFAULT_ESCROW_ADDRESS);
  const seeds = [
    {
      id: "BTC120",
      shareId: "btc-120k-utc",
      question: "Will Bitcoin close above $120,000 at 20:00 UTC?",
      category: "major_crypto",
      resolverType: "BINANCE",
      resolverConfig: {
        symbol: "BTCUSDT",
        interval: "1m",
        settlementField: "close",
        operator: ">",
        target: 120000,
      },
      outcomes: ["Yes", "No"],
      stake: 500_000,
      close: isoFromNow(2.3),
      event: isoFromNow(3),
      deadline: isoFromNow(8),
      status: "OPEN",
      resolvedOutcome: null,
      observedValue: null,
      proof: null,
      settlementRule:
        "Resolution: Binance Spot BTC/USDT. The market uses the closing price of the one-minute candle ending at 20:00 UTC and resolves Yes only when that close is above $120,000.",
      refundRule:
        "Refund every confirmed stake if Binance remains unavailable beyond the displayed fallback deadline or if nobody predicts correctly.",
    },
    {
      id: "NIM25",
      shareId: "nim-0025",
      question: "Will NIM trade above $0.0025 at the snapshot time?",
      category: "other_crypto",
      resolverType: "COINGECKO",
      resolverConfig: {
        coinId: "nimiq",
        versusCurrency: "usd",
        metric: "price",
        operator: ">",
        target: 0.0025,
      },
      outcomes: ["Above", "At or below"],
      stake: 100_000,
      close: isoFromNow(5.1),
      event: isoFromNow(6),
      deadline: isoFromNow(12),
      status: "OPEN",
      resolvedOutcome: null,
      observedValue: null,
      proof: null,
      settlementRule:
        "Resolution: CoinGecko coin ID nimiq in USD. The backend records the requested settlement time and nearest acceptable provider observation, then compares price with $0.0025.",
      refundRule:
        "Refund every confirmed stake if no acceptable observation is available by the fallback deadline or if nobody predicts correctly.",
    },
    {
      id: "WPGRAIN",
      shareId: "wpg-rain-sat",
      question: "Will Winnipeg record more than 4 mm of rain on Saturday?",
      category: "weather",
      resolverType: "OPEN_METEO",
      resolverConfig: {
        latitude: 49.8951,
        longitude: -97.1384,
        timezone: "America/Winnipeg",
        metric: "precipitation",
        aggregation: "sum",
        unit: "mm",
      },
      outcomes: ["Over 4 mm", "4 mm or less"],
      stake: 200_000,
      close: isoFromNow(18),
      event: isoFromNow(48),
      deadline: isoFromNow(60),
      status: "OPEN",
      resolvedOutcome: null,
      observedValue: null,
      proof: null,
      settlementRule:
        "Resolution: Open-Meteo observed precipitation summed from 00:00 to 23:59 in America/Winnipeg at 49.8951, -97.1384. Forecast values do not settle the pool.",
      refundRule:
        "Refund every confirmed stake if observed data is unavailable beyond the displayed fallback deadline or if nobody predicts correctly.",
    },
    {
      id: "SHIPFRI",
      shareId: "ship-by-friday",
      question: "Will the community demo ship publicly by Friday at 17:00 UTC?",
      category: "manual",
      resolverType: "MANUAL",
      resolverConfig: {
        acceptedEvidence: "Public release URL or signed project announcement",
        preferredSources: "Official project repository and release page",
      },
      outcomes: ["Shipped", "Not shipped"],
      stake: 500_000,
      close: isoFromNow(-26),
      event: isoFromNow(-2),
      deadline: isoFromNow(22),
      status: "EVIDENCE_WINDOW",
      resolvedOutcome: null,
      observedValue: null,
      proof: null,
      settlementRule:
        "Resolution: Creator-reviewed evidence. Participants may submit evidence after the event. The creator selects Shipped or Not shipped, attaches proof, and signs the final result.",
      refundRule:
        "All confirmed stakes become refundable if the creator misses the displayed deadline, the event is cancelled, or nobody predicts correctly.",
    },
    {
      id: "ETH42",
      shareId: "eth-closed-4200",
      question: "Did ETH close above $4,200 at 18:30 UTC?",
      category: "major_crypto",
      resolverType: "BINANCE",
      resolverConfig: {
        symbol: "ETHUSDT",
        interval: "1m",
        settlementField: "close",
        operator: ">",
        target: 4200,
      },
      outcomes: ["Yes", "No"],
      stake: 300_000,
      close: isoFromNow(-8),
      event: isoFromNow(-7),
      deadline: isoFromNow(-3),
      status: "PAID",
      resolvedOutcome: "Yes",
      observedValue: "4,247.81 USDT",
      proof: {
        provider: "Binance",
        providerReference: "ETHUSDT · 1m close",
        requestedSettlementAt: isoFromNow(-7),
        providerTimestamp: isoFromNow(-7),
        observedValue: "4,247.81 USDT",
        explanation:
          "The configured closed candle finished above $4,200. Two matching predictions split the confirmed pot equally.",
      },
      settlementRule:
        "Resolution: Binance Spot ETH/USDT using the closing value of the configured one-minute candle ending at 18:30 UTC.",
      refundRule:
        "A source timeout beyond the fallback deadline or no correct predictions would have refunded every confirmed stake.",
    },
  ];

  const insertPool = db.prepare(`INSERT INTO pools (
    id, share_id, question, category, resolver_type, resolver_config,
    outcomes, stake_amount_luna, creator_address, escrow_address,
    prediction_closes_at, event_resolves_at, resolution_deadline, status,
    resolved_outcome, observed_value, resolution_proof, created_at,
    settlement_rule, refund_rule, evidence_requirements
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const insertParticipant = db.prepare(`INSERT INTO participants (
    id, pool_id, address, predicted_outcome, prediction_payload,
    prediction_public_key, prediction_signature, stake_tx_hash,
    stake_amount_luna, joined_at, is_demo
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

  const insertEvidence = db.prepare(`INSERT INTO evidence (
    id, pool_id, submitted_by, proposed_outcome, evidence_url,
    description, submitted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  inTransaction(db, () => {
    for (const seed of seeds) {
      insertPool.run(
        seed.id,
        seed.shareId,
        seed.question,
        seed.category,
        seed.resolverType,
        JSON.stringify(seed.resolverConfig),
        JSON.stringify(seed.outcomes),
        seed.stake,
        creator,
        escrow,
        seed.close,
        seed.event,
        seed.deadline,
        seed.status,
        seed.resolvedOutcome,
        seed.observedValue,
        seed.proof ? JSON.stringify(seed.proof) : null,
        createdAt,
        seed.settlementRule,
        seed.refundRule,
        seed.resolverType === "MANUAL"
          ? "Submit a public release link, repository tag, or a factual note identifying the primary source."
          : "Provider response and timestamps are recorded automatically.",
      );
    }

    const sampleParticipants = [
      ["p1", "BTC120", "NQ10 SAMPLE 0000", "Yes", 500_000],
      ["p2", "BTC120", "NQ11 SAMPLE 0000", "No", 500_000],
      ["p3", "NIM25", "NQ12 SAMPLE 0000", "Above", 100_000],
      ["p4", "WPGRAIN", "NQ13 SAMPLE 0000", "Over 4 mm", 200_000],
      ["p5", "WPGRAIN", "NQ14 SAMPLE 0000", "4 mm or less", 200_000],
      ["p6", "WPGRAIN", "NQ15 SAMPLE 0000", "Over 4 mm", 200_000],
      ["p7", "SHIPFRI", "NQ16 SAMPLE 0000", "Shipped", 500_000],
      ["p8", "SHIPFRI", "NQ17 SAMPLE 0000", "Not shipped", 500_000],
      ["p9", "ETH42", "NQ18 SAMPLE 0000", "Yes", 300_000],
      ["p10", "ETH42", "NQ19 SAMPLE 0000", "Yes", 300_000],
    ] as const;

    for (const [id, poolId, address, outcome, stake] of sampleParticipants) {
      insertParticipant.run(
        id,
        poolId,
        address,
        outcome,
        "{}",
        "demo",
        "demo",
        `demo_seed_${id}`,
        stake,
        createdAt,
      );
    }

    insertEvidence.run(
      "e1",
      "SHIPFRI",
      "NQ16 SAMPLE 0000",
      "Shipped",
      "https://github.com/nimiq",
      "The public repository shows a tagged release and deployment instructions.",
      isoFromNow(-1),
    );
  });
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getAppSetting(db: Sqlite, key: string) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1").get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

function setAppSetting(db: Sqlite, key: string, value: string) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function envLimit(...names: string[]) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return null;
}

function mapPool(row: Row, outcomeCounts: Record<string, number> = {}) {
  const outcomes = parseJson<string[]>(row.outcomes, []);
  const totalParticipants = Number(row.participant_count ?? 0);
  const outcomeBreakdown = outcomes.map((outcome) => {
    const count = Number(outcomeCounts[outcome] ?? 0);
    return {
      outcome,
      count,
      percentage: totalParticipants > 0 ? Math.round((count / totalParticipants) * 100) : 0,
    };
  });

  return {
    id: row.id,
    shareId: row.share_id,
    question: row.question,
    category: row.category,
    resolverType: row.resolver_type,
    resolverConfig: parseJson(row.resolver_config, {}),
    outcomes,
    stakeAmountLuna: Number(row.stake_amount_luna),
    creatorAddress: row.creator_address,
    escrowAddress: row.escrow_address,
    predictionClosesAt: row.prediction_closes_at,
    eventResolvesAt: row.event_resolves_at,
    resolutionDeadline: row.resolution_deadline,
    status: row.status,
    resolvedOutcome: row.resolved_outcome,
    observedValue: row.observed_value,
    resolutionProof: parseJson(row.resolution_proof, null),
    participantCount: totalParticipants,
    potLuna: Number(row.pot_luna ?? 0),
    outcomeBreakdown,
    createdAt: row.created_at,
    settlementRule: row.settlement_rule,
    refundRule: row.refund_rule,
    evidenceRequirements: row.evidence_requirements,
  };
}

function normalized(value: unknown) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function serviceWalletAddresses() {
  return new Set(
    [process.env.NIMIQ_ESCROW_ADDRESS, process.env.NIMIQ_REWARDS_POOL_ADDRESS]
      .map((value) => normalized(value))
      .filter(Boolean),
  );
}

export function isDiscoverablePool(pool: any) {
  if (String(pool.status) !== "OPEN") return false;
  if (new Date(String(pool.predictionClosesAt)).getTime() <= Date.now()) return false;
  if (/pool total branch|mainnet smoke cycle/i.test(String(pool.question))) return false;
  if (serviceWalletAddresses().has(normalized(pool.creatorAddress))) return false;
  return true;
}

export function listPools() {
  const outcomeRows = getDb()
    .prepare(`SELECT
      pool_id,
      predicted_outcome,
      COUNT(*) AS count
    FROM participants
    GROUP BY pool_id, predicted_outcome`)
    .all() as Row[];
  const countsByPool = new Map<string, Record<string, number>>();
  for (const row of outcomeRows) {
    const poolId = String(row.pool_id);
    const outcome = String(row.predicted_outcome);
    const count = Number(row.count ?? 0);
    const current = countsByPool.get(poolId) ?? {};
    current[outcome] = count;
    countsByPool.set(poolId, current);
  }

  const rows = getDb()
    .prepare(`SELECT
      pools.*,
      COUNT(participants.id) AS participant_count,
      COALESCE(SUM(participants.stake_amount_luna), 0) AS pot_luna
    FROM pools
    LEFT JOIN participants ON participants.pool_id = pools.id
    GROUP BY pools.id
    ORDER BY pools.created_at DESC`)
    .all() as Row[];
  return rows.map((row) => mapPool(row, countsByPool.get(String(row.id)) ?? {}));
}

export function getPool(id: string) {
  return getDb().prepare("SELECT * FROM pools WHERE id = ?").get(id) as
    | Row
    | undefined;
}

export function createPool(body: Row) {
  const outcomes = Array.isArray(body.outcomes)
    ? body.outcomes.filter((value): value is string => typeof value === "string")
    : [];
  if (
    typeof body.question !== "string" ||
    !body.question.trim() ||
    outcomes.length < 2 ||
    typeof body.creatorAddress !== "string"
  ) {
    throw new InputError("Question, creator, and two outcomes are required.");
  }

  const stakeAmountLuna = positiveInteger(body.stakeAmountLuna, 0);
  if (stakeAmountLuna <= 0) throw new InputError("Stake amount must be positive.");

  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const now = new Date().toISOString();
  getDb()
    .prepare(`INSERT INTO pools (
      id, share_id, question, category, resolver_type, resolver_config,
      outcomes, stake_amount_luna, creator_address, escrow_address,
      prediction_closes_at, event_resolves_at, resolution_deadline, status,
      resolved_outcome, observed_value, resolution_proof, created_at,
      settlement_rule, refund_rule, evidence_requirements
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, NULL, NULL, ?, ?, ?, ?)`)
    .run(
      id,
      id.toLowerCase(),
      body.question.trim(),
      String(body.category || "manual"),
      String(body.resolverType || "MANUAL"),
      JSON.stringify(body.resolverConfig ?? {}),
      JSON.stringify(outcomes),
      stakeAmountLuna,
      body.creatorAddress,
      configuredAddress("NIMIQ_ESCROW_ADDRESS", DEFAULT_ESCROW_ADDRESS),
      String(body.predictionClosesAt),
      String(body.eventResolvesAt),
      String(body.resolutionDeadline),
      now,
      String(body.settlementRule || ""),
      String(body.refundRule || ""),
      String(body.evidenceRequirements || ""),
    );

  return listPools().find((pool) => pool.id === id);
}

export function joinPool() {
  throw new ConflictError("Unverified joins are disabled. Use the blockchain-verified join route.");
}

export function listEvidence(poolId: string) {
  return getDb()
    .prepare(`SELECT
      id, pool_id AS poolId, submitted_by AS submittedBy,
      proposed_outcome AS proposedOutcome, evidence_url AS evidenceUrl,
      description, submitted_at AS submittedAt
    FROM evidence WHERE pool_id = ? ORDER BY submitted_at DESC`)
    .all(poolId);
}

export function addEvidence(poolId: string, body: Row) {
  if (
    typeof body.submittedBy !== "string" ||
    typeof body.description !== "string" ||
    !body.description.trim()
  ) {
    throw new InputError("A wallet and evidence description are required.");
  }
  if (!getPool(poolId)) throw new NotFoundError("Pool not found.");

  const item = {
    id: crypto.randomUUID(),
    poolId,
    submittedBy: body.submittedBy,
    proposedOutcome: String(body.proposedOutcome ?? ""),
    evidenceUrl:
      typeof body.evidenceUrl === "string" && body.evidenceUrl
        ? body.evidenceUrl
        : null,
    description: body.description.trim(),
    submittedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(`INSERT INTO evidence (
      id, pool_id, submitted_by, proposed_outcome, evidence_url,
      description, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      item.id,
      item.poolId,
      item.submittedBy,
      item.proposedOutcome,
      item.evidenceUrl,
      item.description,
      item.submittedAt,
    );
  return item;
}

function makeReferralCode(address: string) {
  const clean = address.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${clean.slice(0, 4)}${crypto.randomUUID().replaceAll("-", "").slice(0, 4)}`;
}

function ensureReferralCode(db: Sqlite, address: string, origin: string) {
  let row = db
    .prepare("SELECT * FROM referral_codes WHERE address = ?")
    .get(address) as Row | undefined;
  if (!row) {
    const code = makeReferralCode(address);
    const shareUrl = `${origin}?ref=${code}`;
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO referral_codes (address, code, share_url, created_at) VALUES (?, ?, ?, ?)",
    ).run(address, code, shareUrl, createdAt);
    row = { address, code, share_url: shareUrl, created_at: createdAt };
  }
  return {
    address: row.address,
    code: row.code,
    shareUrl: row.share_url,
    createdAt: row.created_at,
  };
}

function createRewardIfFunded(
  db: Sqlite,
  address: string,
  type: "signup" | "referral",
  amount: number,
  triggerTxHash: string,
) {
  if (type === "signup") {
    const existing = db
      .prepare(
        "SELECT id FROM reward_events WHERE address = ? AND type = 'signup' LIMIT 1",
      )
      .get(address);
    if (existing) return false;
  }

  const pool = getRewardsPoolRow(db);
  const fundedLuna = Number(pool?.total_funded_luna ?? Number(pool?.total_funded ?? 0) * LUNA_PER_NIM);
  const distributedLuna = Number(pool?.total_distributed ?? 0) * LUNA_PER_NIM;
  const reserved = Number(
    (
      db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS amount FROM reward_events WHERE status = 'pending'",
        )
        .get() as { amount: number }
    ).amount,
  );
  if (fundedLuna - distributedLuna - reserved * LUNA_PER_NIM < amount * LUNA_PER_NIM) return false;

  db.prepare(`INSERT INTO reward_events (
    id, address, type, amount, trigger_tx_hash, status,
    claim_tx_hash, created_at, claimed_at
  ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`)
    .run(
      crypto.randomUUID(),
      address,
      type,
      amount,
      triggerTxHash,
      new Date().toISOString(),
    );
  return true;
}

function processFirstStakeRewards(
  db: Sqlite,
  pool: Row,
  address: string,
  stakeTxHash: string,
  referralCode?: string,
) {
  if (String(pool.creator_address) === address) return;
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM participants WHERE address = ?")
    .get(address) as { count: number };
  if (Number(count.count) !== 1) return;

  createRewardIfFunded(db, address, "signup", SIGNUP_REWARD_NIM, stakeTxHash);
  if (!referralCode) return;

  const codeOwner = db
    .prepare("SELECT address FROM referral_codes WHERE code = ?")
    .get(referralCode) as { address: string } | undefined;
  if (!codeOwner || codeOwner.address === address) return;
  if (
    db
      .prepare("SELECT referred_address FROM referrals WHERE referred_address = ?")
      .get(address)
  ) {
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO referrals (
    referred_address, code, referrer_address, status,
    first_stake_tx_hash, created_at, verified_at
  ) VALUES (?, ?, ?, 'verified', ?, ?, ?)`)
    .run(address, referralCode, codeOwner.address, stakeTxHash, now, now);
  createRewardIfFunded(
    db,
    codeOwner.address,
    "referral",
    REFERRAL_REWARD_NIM,
    stakeTxHash,
  );
}

export function referralDashboard(address: string, origin: string) {
  const db = getDb();
  const referralCode = ensureReferralCode(db, address, origin);
  const verified = db
    .prepare(
      "SELECT COUNT(*) AS count FROM referrals WHERE referrer_address = ? AND status = 'verified'",
    )
    .get(address) as { count: number };
  const earned = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS amount FROM reward_events WHERE address = ? AND type = 'referral'",
    )
    .get(address) as { amount: number };
  const rewards = db
    .prepare(`SELECT
      id, address, type, amount, trigger_tx_hash AS triggerTxHash,
      status, claim_tx_hash AS claimTxHash, created_at AS createdAt,
      claimed_at AS claimedAt
    FROM reward_events WHERE address = ? ORDER BY created_at DESC`)
    .all(address) as Row[];
  const pool = getRewardsPoolRow(db);
  const leaders = db
    .prepare(`SELECT
      rc.address AS address,
      COUNT(r.referred_address) AS verified_count,
      COALESCE(SUM(CASE WHEN re.type = 'referral' THEN re.amount ELSE 0 END), 0) AS total_earned
    FROM referral_codes rc
    LEFT JOIN referrals r
      ON r.referrer_address = rc.address AND r.status = 'verified'
    LEFT JOIN reward_events re ON re.address = rc.address
    GROUP BY rc.address
    ORDER BY verified_count DESC, rc.created_at ASC
    LIMIT 20`)
    .all() as Row[];
  const allRanks = db
    .prepare(`SELECT
      rc.address AS address,
      COUNT(r.referred_address) AS verified_count
    FROM referral_codes rc
    LEFT JOIN referrals r
      ON r.referrer_address = rc.address AND r.status = 'verified'
    GROUP BY rc.address
    ORDER BY verified_count DESC, rc.created_at ASC`)
    .all() as Row[];

  const leaderboard = leaders.map((entry, index) => ({
    rank: index + 1,
    address: entry.address,
    verifiedCount: Number(entry.verified_count),
    totalEarned: Number(entry.total_earned),
  }));
  const ownIndex = allRanks.findIndex((entry) => entry.address === address);
  const own = allRanks[ownIndex] ?? { address, verified_count: 0 };
  const totalFundedLuna = Number(pool?.total_funded_luna ?? Number(pool?.total_funded ?? 0) * LUNA_PER_NIM);
  const totalDistributed = Number(pool?.total_distributed ?? 0);
  const reserved = Number(
    (
      db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS amount FROM reward_events WHERE status = 'pending'",
        )
        .get() as { amount: number }
    ).amount,
  );
  const remainingLuna = Math.max(0, totalFundedLuna - totalDistributed * LUNA_PER_NIM - reserved * LUNA_PER_NIM);

  return {
    referralCode,
    verifiedReferralCount: Number(verified.count),
    referralEarned: Number(earned.amount),
    signupReward: rewards.find((event) => event.type === "signup") ?? null,
    claimableRewards: rewards.filter((event) => event.status === "pending"),
    rewardsPool: {
      address: pool?.address,
      totalFunded: totalFundedLuna / LUNA_PER_NIM,
      totalDistributed,
      remaining: remainingLuna / LUNA_PER_NIM,
    },
    leaderboard,
    ownRank: {
      rank: ownIndex >= 0 ? ownIndex + 1 : allRanks.length + 1,
      address: own.address,
      verifiedCount: Number(own.verified_count),
      totalEarned: Number(earned.amount),
    },
    rewardsPoolDepleted: remainingLuna < REFERRAL_REWARD_NIM * LUNA_PER_NIM,
  };
}

export function claimReward() {
  throw new ConflictError("Legacy simulated reward claims are disabled. Use the blockchain-backed claim route.");
}

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export class InputError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}
export class PausedError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}

export function isPaused() {
  return getAppSetting(getDb(), "paused") === "1";
}

export function setPaused(paused: boolean) {
  setAppSetting(getDb(), "paused", paused ? "1" : "0");
  return { paused };
}

export function getJoinLimits() {
  return {
    paused: isPaused(),
    maxStakePerWalletLuna: envLimit("NIMIQ_MAX_STAKE_PER_WALLET_LUNA", "MAX_STAKE_PER_WALLET") ?? DEFAULT_MAX_STAKE_PER_WALLET_LUNA,
    maxPoolTotalLuna: envLimit("NIMIQ_MAX_POOL_TOTAL_LUNA", "MAX_POOL_TOTAL") ?? DEFAULT_MAX_POOL_TOTAL_LUNA,
  };
}

// --- Verified-chain persistence helpers ---
export function transactionHashUsed(txHash: string) {
  const db = getDb();
  const participant = db.prepare("SELECT 1 FROM participants WHERE stake_tx_hash = ? LIMIT 1").get(txHash);
  const reward = db.prepare("SELECT 1 FROM reward_events WHERE trigger_tx_hash = ? OR claim_tx_hash = ? LIMIT 1").get(txHash, txHash);
  const payout = db.prepare("SELECT 1 FROM payouts WHERE trigger_tx_hash = ? OR payout_tx_hash = ? LIMIT 1").get(txHash, txHash);
  return Boolean(participant || reward || payout);
}

export function createVerifiedParticipant(poolId: string, body: Row) {
  const db = getDb();
  const pool = getPool(poolId);
  if (!pool) throw new NotFoundError("Pool not found.");
  if (pool.status !== "OPEN" || new Date(String(pool.prediction_closes_at)).getTime() <= Date.now()) {
    throw new ConflictError("Predictions are closed for this pool.");
  }
  const outcomes = parseJson<string[]>(pool.outcomes, []);
  if (typeof body.address !== "string" || typeof body.predictedOutcome !== "string" || !outcomes.includes(body.predictedOutcome)) {
    throw new InputError("Wallet and a valid outcome are required.");
  }
  const address = body.address;
  const predictedOutcome = body.predictedOutcome;
  const txHash = String(body.stakeTxHash || "").trim();
  if (!txHash) throw new InputError("A verified transaction hash is required.");
  const limits = getJoinLimits();
  const stakeAmountLuna = Number(pool.stake_amount_luna);
  return inTransaction(db, () => {
    if (transactionHashUsed(txHash)) throw new ConflictError("This transaction hash has already been used.");
    if (limits.maxStakePerWalletLuna != null) {
      const walletTotal = Number(
        (db
          .prepare("SELECT COALESCE(SUM(stake_amount_luna), 0) AS amount FROM participants WHERE address = ?")
          .get(address) as { amount: number }).amount,
      );
      const projectedWalletTotal = walletTotal + stakeAmountLuna;
      if (projectedWalletTotal > limits.maxStakePerWalletLuna) {
        throw new ConflictError(
          `MAX_STAKE_PER_WALLET exceeded: wallet would reach ${projectedWalletTotal} Luna, but the cap is ${limits.maxStakePerWalletLuna} Luna.`,
        );
      }
    }
    if (limits.maxPoolTotalLuna != null) {
      const poolTotal = Number(
        (db
          .prepare("SELECT COALESCE(SUM(stake_amount_luna), 0) AS amount FROM participants WHERE pool_id = ?")
          .get(poolId) as { amount: number }).amount,
      );
      const projectedPoolTotal = poolTotal + stakeAmountLuna;
      if (projectedPoolTotal > limits.maxPoolTotalLuna) {
        throw new ConflictError(
          `MAX_POOL_TOTAL exceeded: pool would reach ${projectedPoolTotal} Luna, but the cap is ${limits.maxPoolTotalLuna} Luna.`,
        );
      }
    }
    db.prepare(`INSERT INTO participants (
      id, pool_id, address, predicted_outcome, prediction_payload,
      prediction_public_key, prediction_signature, stake_tx_hash,
      stake_amount_luna, joined_at, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(crypto.randomUUID(), poolId, address, predictedOutcome,
        String(body.predictionPayload || ""), String(body.predictionPublicKey || ""),
        String(body.predictionSignature || ""), txHash, stakeAmountLuna,
        new Date().toISOString());
    processFirstStakeRewards(db, pool, address, txHash,
      typeof body.referralCode === "string" ? body.referralCode : undefined);
    return { participantCreated: true };
  });
}

export function getRewardEvent(id: string, address: string) {
  return getDb().prepare("SELECT * FROM reward_events WHERE id = ? AND address = ?").get(id, address) as Row | undefined;
}

export function markRewardBroadcast(id: string, txHash: string) {
  const db = getDb();
  db.prepare(`UPDATE reward_events SET status = 'broadcast', claim_tx_hash = ? WHERE id = ? AND status IN ('pending','broadcast')`).run(txHash, id);
}

export function markRewardConfirmed(id: string, txHash: string) {
  const db = getDb();
  return inTransaction(db, () => {
    const reward = db.prepare("SELECT * FROM reward_events WHERE id = ? AND status IN ('pending','broadcast')").get(id) as Row | undefined;
    if (!reward) throw new ConflictError("Reward is unavailable or already claimed.");
    const amount = Number(reward.amount);
  const pool = getRewardsPoolRow(db) as Row;
    db.prepare(
      "UPDATE rewards_pool SET total_distributed = total_distributed + ? WHERE address = ? AND (COALESCE(total_funded_luna, total_funded * ?) - (total_distributed + ?) * ?) >= 0",
    ).run(amount, String(pool.address), LUNA_PER_NIM, amount, LUNA_PER_NIM);
    db.prepare("UPDATE reward_events SET status='claimed', claim_tx_hash=?, claimed_at=? WHERE id=?").run(txHash, new Date().toISOString(), id);
    return { amount };
  });
}

export function listParticipants(poolId: string) {
  return getDb().prepare("SELECT * FROM participants WHERE pool_id = ? ORDER BY joined_at").all(poolId) as Row[];
}

export function addResolutionVote(poolId: string, address: string, outcome: string, evidenceNote = "") {
  const db = getDb();
  const participant = db.prepare("SELECT 1 FROM participants WHERE pool_id=? AND address=?").get(poolId, address);
  if (!participant) throw new ConflictError("Only pool participants can submit a resolution vote.");
  db.prepare(`INSERT INTO resolution_votes (pool_id,address,outcome,evidence_note,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(pool_id,address) DO UPDATE SET outcome=excluded.outcome,evidence_note=excluded.evidence_note,created_at=excluded.created_at`)
    .run(poolId,address,outcome,evidenceNote,new Date().toISOString());
}

export function listResolutionVotes(poolId: string) {
  return getDb().prepare("SELECT * FROM resolution_votes WHERE pool_id=?").all(poolId) as Row[];
}

export function setPoolResolution(poolId: string, outcome: string | null, proof: unknown, status: string, observedValue?: string | number | null) {
  getDb().prepare("UPDATE pools SET resolved_outcome=?, resolution_proof=?, observed_value=?, status=? WHERE id=?")
    .run(outcome, JSON.stringify(proof), observedValue == null ? null : String(observedValue), status, poolId);
}

export function getOrCreatePayout(poolId: string, address: string) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM payouts WHERE pool_id=? AND address=?").get(poolId,address) as Row|undefined;
  if (existing) return existing;
  const pool = getPool(poolId);
  if (!pool || pool.status !== 'RESOLVED' || !pool.resolved_outcome) throw new ConflictError("Pool is not resolved.");
  const participants = listParticipants(poolId);
  const winners = participants.filter((p)=>p.predicted_outcome===pool.resolved_outcome);
  const winner = winners.find((p)=>p.address===address);
  if (!winner) throw new ConflictError("This wallet is not eligible for a payout.");
  const pot = participants.reduce((sum,p)=>sum+Number(p.stake_amount_luna),0);
  const amount = Math.floor(pot / winners.length);
  const id=crypto.randomUUID();
  db.prepare(`INSERT INTO payouts (id,pool_id,address,amount_luna,status,trigger_tx_hash,payout_tx_hash,created_at,confirmed_at)
    VALUES (?,?,?,?, 'pending', ?, NULL, ?, NULL)`).run(id,poolId,address,amount,String(winner.stake_tx_hash),new Date().toISOString());
  return db.prepare("SELECT * FROM payouts WHERE id=?").get(id) as Row;
}

export function markPayoutBroadcast(id:string,hash:string){
  getDb().prepare("UPDATE payouts SET status='broadcast', payout_tx_hash=? WHERE id=? AND status IN ('pending','broadcast')").run(hash,id);
}
export function markPayoutConfirmed(id:string,hash:string){
  getDb().prepare("UPDATE payouts SET status='completed', payout_tx_hash=?, confirmed_at=? WHERE id=? AND status IN ('pending','broadcast')").run(hash,new Date().toISOString(),id);
}

export function accountingSnapshot() {
  const db = getDb();
  const rewards = getRewardsPoolRow(db) as Row;
  const pendingRewards = (db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM reward_events WHERE status IN ('pending','broadcast')").get() as Row).amount;
  const outstandingEscrow = (db.prepare(`SELECT COALESCE(SUM(p.stake_amount_luna),0) amount FROM participants p
    JOIN pools x ON x.id=p.pool_id WHERE x.status NOT IN ('PAID','REFUNDED')`).get() as Row).amount;
  return { rewards, pendingRewards: Number(pendingRewards), outstandingEscrow: Number(outstandingEscrow), lunaPerNim: LUNA_PER_NIM };
}
