# Testnet blockchain verification

This build is hard-locked to `NIMIQ_NETWORK=testnet`. It will throw during blockchain-service construction for any other network value.

## Required setup

1. Install dependencies with `npm install`.
2. Create two funded TestAlbatross accounts: prediction escrow and rewards.
3. Add their addresses and **testnet-only** private keys to `.env.local`.
4. Set `NIMIQ_CONFIRMATIONS_REQUIRED` after deciding the finality policy.
5. Start with `SEED_DEMO_DATA=false` and reset the database.

## Verification cases

Run these with real Nimiq Pay/TestAlbatross transfers and record the explorer links:

- Fabricated hash: POST `/api/pools/{id}/join` with a nonexistent hash. Expected `TX_NOT_FOUND`.
- Wrong amount: send a real transfer to escrow with the correct pool data but a different Luna value. Expected `AMOUNT_MISMATCH`.
- Reuse: submit one valid transaction twice. First succeeds; second returns the transaction-reuse conflict.
- Valid stake: exact sender, escrow recipient, amount, pool-ID data, and required confirmations. Participant and rewards are created only after verification.
- Reward claim: claim an unlocked event. It remains `broadcast`/pending until the outgoing reward transaction reaches the threshold, then becomes `claimed` with the real hash.
- Winner payout: resolve a pool and claim from a winning wallet. It remains retryable until the real escrow payout confirms.

## Admin endpoints

- `POST /api/admin/resolve-due` with `Authorization: Bearer $ADMIN_TOKEN`
- `GET /api/admin/reconciliation` with the same header

The reconciliation response compares database liabilities with real on-chain balances and exposes warnings.
