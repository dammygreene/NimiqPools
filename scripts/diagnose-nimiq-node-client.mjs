import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import Comlink from "comlink";
import nodeEndpoint from "comlink/dist/esm/node-adapter.min.mjs";
import * as Nimiq from "@nimiq/core";

const startedAt = Date.now();
const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreRoot = dirname(dirname(require.resolve("@nimiq/core")));
const workerPath = resolve(coreRoot, "nodejs/worker.mjs");
const corePackagePath = resolve(coreRoot, "package.json");
const coreReadmePath = resolve(coreRoot, "README.md");
const coreTypesPath = resolve(coreRoot, "types/wasm/bundler.d.ts");

let lastStage = "starting";
let lastWorkerLog = "";
let firstPeerMs = null;
let firstSyncMs = null;
let firstHeadMs = null;

loadEnvFiles();

const DEFAULT_MAINNET_SEEDS = [
  "/dns4/aurora.seed.nimiq.com/tcp/443/wss",
  "/dns4/nexus.seed.nimiq.network/tcp/443/wss",
];
const DEFAULT_TESTNET_SEEDS = ["/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss"];
const NETWORK = (process.env.NIMIQ_NETWORK || "mainnet").trim().toLowerCase();
const SEEDS = (process.env.NIMIQ_SEED_NODES || (NETWORK === "mainnet" ? DEFAULT_MAINNET_SEEDS : DEFAULT_TESTNET_SEEDS).join(","))
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.NIMIQ_DIAG_TIMEOUT_MS || 90_000);
const HEARTBEAT_MS = Number(process.env.NIMIQ_DIAG_HEARTBEAT_MS || 5_000);

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      log("env-loaded", { file });
    } catch (error) {
      log("env-load-failed", { file, error: messageOf(error) });
    }
  }
}

function atMs() {
  return Date.now() - startedAt;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function log(stage, extra = {}) {
  lastStage = stage;
  console.log(JSON.stringify({ at: new Date().toISOString(), atMs: atMs(), stage, ...extra }));
}

function memorySnapshot() {
  return {
    osFreeMb: Math.round(os.freemem() / 1024 / 1024),
    osTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    process: process.memoryUsage(),
    loadavg: os.loadavg(),
  };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function inspectPackage() {
  const pkg = JSON.parse(readText(corePackagePath) || "{}");
  const readme = readText(coreReadmePath);
  const types = readText(coreTypesPath);
  const workerSource = readText(workerPath);
  log("package-inspection", {
    coreVersion: pkg.version ?? null,
    coreDescription: pkg.description ?? null,
    packageEngines: pkg.engines ?? null,
    readmeMentionsNodejs: /NodeJS/i.test(readme),
    workerImportsFakeIndexedDb: /fake-indexeddb\/auto/.test(workerSource),
    plainClientConfigurationHasStorage: /storage/i.test(types.match(/export interface PlainClientConfiguration[\s\S]*?}\n/)?.[0] || ""),
    plainClientConfiguration: (types.match(/export interface PlainClientConfiguration[\s\S]*?}\n/)?.[0] || "").trim(),
  });
}

function classifyWorkerLine(line) {
  lastWorkerLog = line;
  if (/Client WASM worker ready/i.test(line)) log("worker-ready", { line });
  else if (/Initializing client WASM worker/i.test(line)) log("worker-initializing", { line });
  else if (/idb|indexed db|indexeddb/i.test(line)) log("storage-backend-warning", { line });
  else if (/Web config/i.test(line)) log("storage-backend-selected", { line });
  else if (/Final configuration/i.test(line)) log("final-configuration", { line });
  else if (/Initializing light client/i.test(line)) log("network-stack-starting", { line });
  else if (/Spawning consensus/i.test(line)) log("peer-discovery-starting", { line });
  else if (/Peer joined/i.test(line)) {
    if (firstPeerMs == null) firstPeerMs = atMs();
    log("peer-found", { line, firstPeerMs });
  } else if (/Catching up|PicoSync|MacroSync|sync/i.test(line)) {
    if (firstSyncMs == null) firstSyncMs = atMs();
    log("syncing", { line, firstSyncMs });
  } else if (/Consensus established/i.test(line)) {
    log("consensus-established-log", { line });
  } else {
    log("worker-log", { line });
  }
}

function attachStream(stream, label) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) classifyWorkerLine(`${label}: ${trimmed}`);
    }
  });
}

function buildConfig() {
  const config = new Nimiq.ClientConfiguration();
  config.network(NETWORK === "mainnet" ? "MainAlbatross" : "TestAlbatross");
  config.seedNodes(SEEDS);
  config.logLevel(process.env.NIMIQ_DIAG_LOG_LEVEL || "info");
  const built = config.build();
  log("config-built", { network: NETWORK, seeds: SEEDS, config: built });
  return built;
}

async function waitForMessage(worker, predicate, timeoutMs, stageOnTimeout) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms at ${stageOnTimeout}.`));
    }, timeoutMs);
    const onMessage = (event) => {
      const data = typeof event === "object" && event && "data" in event ? event.data : event;
      if (!predicate(data)) return;
      clearTimeout(timeout);
      worker.off("message", onMessage);
      resolve(data);
    };
    worker.on("message", onMessage);
  });
}

async function main() {
  log("environment", {
    nodeVersion: process.version,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    scriptDir,
    memory: memorySnapshot(),
    globalIndexedDbPresent: typeof globalThis.indexedDB !== "undefined",
    globalWebSocketPresent: typeof globalThis.WebSocket !== "undefined",
  });
  inspectPackage();

  if (!existsSync(workerPath)) {
    throw new Error(`Nimiq worker not found at ${workerPath}`);
  }

  const config = buildConfig();
  log("worker-spawning", { workerPath });
  const worker = new Worker(pathToFileURL(workerPath), { stdout: true, stderr: true });
  attachStream(worker.stdout, "stdout");
  attachStream(worker.stderr, "stderr");
  worker.on("error", (error) => log("worker-error", { error: messageOf(error), stack: error.stack }));
  worker.on("exit", (code) => log("worker-exit", { code }));

  const heartbeat = setInterval(() => {
    log("heartbeat", {
      lastStage,
      lastWorkerLog,
      firstPeerMs,
      firstSyncMs,
      firstHeadMs,
      memory: memorySnapshot(),
    });
  }, HEARTBEAT_MS);

  try {
    log("worker-ready-check-starting");
    const readyCheck = setInterval(() => worker.postMessage("NIMIQ_CHECKREADY"), 20);
    await waitForMessage(worker, (data) => data === "NIMIQ_READY", TIMEOUT_MS, "worker ready check");
    clearInterval(readyCheck);
    log("worker-loaded");

    const client = Comlink.wrap(nodeEndpoint(worker));
    log("nimiq-init-sending");
    worker.postMessage({ type: "NIMIQ_INIT", config });
    await waitForMessage(worker, (data) => typeof data === "object" && data && "ok" in data, TIMEOUT_MS, "NIMIQ_INIT response");
    log("remote-client-ready");

    const consensusHandle = await client.addConsensusChangedListener((state) => {
      if (state === "syncing" && firstSyncMs == null) firstSyncMs = atMs();
      log("consensus-change", { state });
    });
    const peerHandle = await client.addPeerChangedListener((peerId, reason, peerCount, peerInfo) => {
      if (firstPeerMs == null) firstPeerMs = atMs();
      log("peer-change", {
        peerId,
        reason,
        peerCount,
        peerAddress: peerInfo?.address || null,
      });
    });
    const headHandle = await client.addHeadChangedListener((hash, reason) => {
      if (firstHeadMs == null) firstHeadMs = atMs();
      log("head-changed", { hash, reason, firstHeadMs });
    });

    log("consensus-wait-starting");
    await Promise.race([
      client.waitForConsensusEstablished(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS}ms waiting for consensus.`)), TIMEOUT_MS)),
    ]);
    log("consensus-established", { firstPeerMs, firstSyncMs, firstHeadMs, memory: memorySnapshot() });

    await client.removeListener(consensusHandle).catch(() => {});
    await client.removeListener(peerHandle).catch(() => {});
    await client.removeListener(headHandle).catch(() => {});
    await client.disconnectNetwork().catch(() => {});
  } finally {
    clearInterval(heartbeat);
    await worker.terminate().catch(() => {});
  }
}

main().catch((error) => {
  log("failed", {
    error: messageOf(error),
    stack: error instanceof Error ? error.stack : null,
    lastStage,
    lastWorkerLog,
    firstPeerMs,
    firstSyncMs,
    firstHeadMs,
    memory: memorySnapshot(),
  });
  process.exit(1);
});
