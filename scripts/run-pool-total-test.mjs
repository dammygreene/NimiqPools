process.env.POOL_TOTAL_TEST_PORT = process.env.POOL_TOTAL_TEST_PORT || "3242";
process.env.NIMIQ_SEED_NODES =
  process.env.NIMIQ_SEED_NODES || "/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss";
await import("./test-pool-total-branch.mjs");
