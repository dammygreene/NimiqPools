import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

process.loadEnvFile(".env.local");

const PORT = 3225;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) throw new Error(`Next exited ${child.exitCode}`);
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return;
    } catch {}
    await delay(1000);
  }
  throw new Error("Timed out waiting for server");
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NIMIQ_SEED_NODES: "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss" },
});
server.stdout.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

try {
  await waitForServer(server);
  const response = await fetch(`${BASE}/api/admin/reconciliation`, {
    headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  });
  console.log(await response.text());
} finally {
  server.kill();
}
