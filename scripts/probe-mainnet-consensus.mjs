import { performance } from "node:perf_hooks";
import * as Nimiq from "@nimiq/core";

const MAINNET_SEEDS = [
  "/dns4/aurora.seed.nimiq.com/tcp/443/wss",
  "/dns4/catalyst.seed.nimiq.network/tcp/443/wss",
  "/dns4/nexus.seed.nimiq.network/tcp/443/wss",
  "/dns4/quasar.seed.nimiq.com/tcp/443/wss",
];

const ATTEMPTS = Number(process.env.NIMIQ_SEED_PROBE_ATTEMPTS || 3);
const TIMEOUT_MS = Number(process.env.NIMIQ_SEED_PROBE_TIMEOUT_MS || 45_000);

function ms(start) {
  return Math.round(performance.now() - start);
}

function delay(msValue) {
  return new Promise((resolve) => setTimeout(resolve, msValue));
}

async function probeSeed(seed, attempt) {
  const config = new Nimiq.ClientConfiguration();
  config.network("MainAlbatross");
  config.seedNodes([seed]);
  config.logLevel("warn");

  const startedAt = performance.now();
  const timeline = [];
  let client;
  let consensusHandle;
  let peerHandle;
  let headHandle;
  let firstPeer = null;
  let firstPeerJoinMs = null;
  let firstSyncMs = null;
  let firstHeadMs = null;
  let establishedMs = null;
  let lastConsensusState = "connecting";

  const record = (stage, extra = {}) => {
    const entry = { atMs: ms(startedAt), stage, ...extra };
    timeline.push(entry);
    console.log(JSON.stringify({ seed, attempt, ...entry }));
  };

  try {
    record("connecting");
    client = await Nimiq.Client.create(config.build());
    record("client-created");

    consensusHandle = await client.addConsensusChangedListener((state) => {
      lastConsensusState = state;
      if (state === "syncing" && firstSyncMs == null) firstSyncMs = ms(startedAt);
      if (state === "established" && establishedMs == null) establishedMs = ms(startedAt);
      record("consensus-change", { state });
    });

    peerHandle = await client.addPeerChangedListener((peerId, reason, peerCount, peerInfo) => {
      if (reason === "joined" && firstPeerJoinMs == null) {
        firstPeerJoinMs = ms(startedAt);
        firstPeer = peerInfo?.address || peerId;
        record("peer-found", {
          peerId,
          peerCount,
          peerAddress: peerInfo?.address || null,
          peerType: peerInfo?.type || null,
          peerServices: peerInfo?.services?.map((service) => service.type || service) || null,
        });
      } else {
        record("peer-change", {
          peerId,
          reason,
          peerCount,
          peerAddress: peerInfo?.address || null,
        });
      }
    });

    headHandle = await client.addHeadChangedListener((hash, reason) => {
      if (firstHeadMs == null) {
        firstHeadMs = ms(startedAt);
        record("head-changed", { hash, reason });
      }
    });

    const alreadyEstablished = await client.isConsensusEstablished();
    record("consensus-check", { established: alreadyEstablished });
    if (alreadyEstablished) {
      establishedMs = ms(startedAt);
      return {
        ok: true,
        seed,
        attempt,
        timeline,
        firstPeerJoinMs,
        firstSyncMs,
        firstHeadMs,
        establishedMs,
        stuckStage: null,
      };
    }

    await Promise.race([
      client.waitForConsensusEstablished(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS}ms waiting for consensus.`)), TIMEOUT_MS),
      ),
    ]);

    if (establishedMs == null) establishedMs = ms(startedAt);
    record("consensus-established");
    return {
      ok: true,
      seed,
      attempt,
      timeline,
      firstPeerJoinMs,
      firstSyncMs,
      firstHeadMs,
      establishedMs,
      stuckStage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let stuckStage = "connecting";
    if (firstPeerJoinMs != null && firstSyncMs == null) stuckStage = "peer-found->syncing";
    else if (firstSyncMs != null && establishedMs == null) stuckStage = "syncing->established";
    else if (firstPeerJoinMs == null) stuckStage = "connecting->peer-found";

    record("failed", { message, stuckStage, lastConsensusState, firstPeer, firstPeerJoinMs, firstSyncMs, firstHeadMs });
    return {
      ok: false,
      seed,
      attempt,
      timeline,
      error: message,
      firstPeerJoinMs,
      firstSyncMs,
      firstHeadMs,
      establishedMs,
      stuckStage,
    };
  } finally {
    try {
      if (consensusHandle != null && client) await client.removeListener(consensusHandle);
      if (peerHandle != null && client) await client.removeListener(peerHandle);
      if (headHandle != null && client) await client.removeListener(headHandle);
    } catch {}

    try {
      if (client) await client.disconnectNetwork();
    } catch {}

    await delay(1_500);
  }
}

function summarize(results) {
  const grouped = new Map();
  for (const result of results) {
    const bucket = grouped.get(result.seed) || [];
    bucket.push(result);
    grouped.set(result.seed, bucket);
  }

  const summary = [];
  for (const [seed, items] of grouped.entries()) {
    const successes = items.filter((item) => item.ok);
    const failures = items.filter((item) => !item.ok);
    const establishedTimes = successes.map((item) => item.establishedMs).filter((value) => value != null);
    const avgEstablishedMs = establishedTimes.length > 0
      ? Math.round(establishedTimes.reduce((sum, value) => sum + value, 0) / establishedTimes.length)
      : null;

    summary.push({
      seed,
      attempts: items.length,
      successes: successes.length,
      failures: failures.length,
      fastestEstablishedMs: establishedTimes.length > 0 ? Math.min(...establishedTimes) : null,
      avgEstablishedMs,
      slowestEstablishedMs: establishedTimes.length > 0 ? Math.max(...establishedTimes) : null,
      failureStages: failures.map((item) => item.stuckStage),
    });
  }

  return summary;
}

async function main() {
  const seeds = (process.env.NIMIQ_PROBE_SEEDS || MAINNET_SEEDS.join(","))
    .split(",")
    .map((seed) => seed.trim())
    .filter(Boolean);

  const results = [];
  for (const seed of seeds) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      console.log(`\n[probe] seed=${seed} attempt=${attempt}/${ATTEMPTS}`);
      results.push(await probeSeed(seed, attempt));
    }
  }

  console.log("\n[summary]");
  console.log(JSON.stringify(summarize(results), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
