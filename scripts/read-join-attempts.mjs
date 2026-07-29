import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const candidateRoots = [
  resolve(process.cwd(), "data"),
  resolve(scriptDir, "..", "data"),
];
const roots = [...new Set(candidateRoots)];

for (const root of roots) {
  if (!existsSync(root)) continue;

  for (const file of readdirSync(root).filter((name) => /\.(db|sqlite|sqlite3)$/i.test(name))) {
    const full = join(root, file);
    const db = new DatabaseSync(full, { readOnly: true });
    const hasJoinAttempts = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'join_attempts'")
      .all().length > 0;

    if (!hasJoinAttempts) {
      console.log(JSON.stringify({ db: full, joinAttempts: false }));
      db.close();
      continue;
    }

    const rows = db
      .prepare(`SELECT
        id, pool_id, request_address, authoritative_address, predicted_outcome,
        stake_tx_hash_submitted, stake_tx_hash_verified, stake_amount_luna,
        status, failure_code, failure_reason, debug_json, request_body,
        created_at, updated_at
      FROM join_attempts
      ORDER BY created_at DESC
      LIMIT 20`)
      .all();

    console.log(JSON.stringify({ db: full, joinAttempts: true, rows }, null, 2));
    db.close();
  }
}
