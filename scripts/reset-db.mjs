import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.cwd(), process.env.DATABASE_PATH || "data/nimiq-pools.db");
await rm(path, { force: true });
await rm(`${path}-shm`, { force: true });
await rm(`${path}-wal`, { force: true });
console.log(`Reset local database: ${path}`);
