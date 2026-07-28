# Nimiq Pools

Nimiq Pools is a mobile-first social prediction Mini App designed to run inside Nimiq Pay. Users connect the Nimiq account already managed by Nimiq Pay, lock one prediction, contribute a fixed amount of native NIM, and see the declared resolution and refund rules before joining.

## Native-NIM-only architecture

This repository intentionally contains no Solidity, Hardhat, Sepolia, mock ERC-20, pool factory, or EVM rewards contracts. Native NIM is handled through the Nimiq Mini App SDK and two separate platform-controlled Nimiq basic accounts:

- **Prediction escrow account** — participant stakes, winner payouts, and refunds.
- **Rewards account** — signup and referral rewards only.

User private keys remain inside Nimiq Pay. The app receives an approved account address and requests signatures or NIM transactions through the Mini App provider.

See [`NATIVE_NIM_SETUP.md`](./NATIVE_NIM_SETUP.md) for wallet counts, testnet configuration, and launch prerequisites.

## Local development

Requirements:

- Node.js 22.13 or newer
- npm 10 or newer

Create the environment file and start Next.js:

```bash
cp .env.example .env.local
npm install
npm run dev
```

PowerShell:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Wrangler, Cloudflare Workers, D1, and the EVM toolchain are not required.

The production wallet flow is available inside Nimiq Pay. To preview the interface in a normal local browser without moving funds, set `NEXT_PUBLIC_ENABLE_DEMO_WALLET=true`. Keep it `false` in deployed builds.

## Production hosting

This repo is now set up to run as a production Next.js app with `server.js` as the start file. That is the version you can push to GitHub and deploy on a Node-capable host like Namecheap cPanel or a VPS.

Build locally first:

```bash
npm install
npm run build
```

Then run the production server:

```bash
npm start
```

## Commands

```bash
npm run dev       # local development
npm run build     # production build
npm start         # serve the production build
npm run lint      # ESLint
npm run db:reset  # delete local SQLite data and reseed on next request
```

## Project structure

- `app/` — Next.js interface and API route handlers.
- `lib/db.ts` — local SQLite schema, validation, referral accounting, and data access.
- `data/` — ignored local SQLite files.
- `public/` — light/dark logos, favicon, and social preview.
- `scripts/reset-db.mjs` — local database reset utility.
- `NATIVE_NIM_SETUP.md` — native testnet wallet and deployment notes.

## Referral rewards v1

Referral and signup rewards remain separate from prediction-pool balances. Attribution occurs only after a new wallet completes its first recorded stake into a pool created by another wallet. Self-referrals and repeat attribution are rejected.

A wallet can still qualify through a small real stake in another user's pool. This sybil-farming surface remains an explicit v1 limitation.

## Current launch blockers

The UI and local database flow are not yet a production custody service. Before real NIM is accepted, connect:

- Nimiq RPC verification for every submitted stake transaction;
- server-side verification of prediction and reward signatures;
- real native-NIM payout/refund execution;
- balance/liability reconciliation for both platform accounts;
- automatic resolution workers and retry handling;
- managed secret storage and operational monitoring.

Do not treat simulated local reward hashes as real payouts.

## Real TestAlbatross verification layer

All chain access is centralized in `lib/nimiq-service.ts`. Routes do not import `@nimiq/core` directly. Pool joins now require a real, sufficiently confirmed transaction matching sender, escrow recipient, exact Luna amount and pool ID data. Reward and winner payouts use real testnet broadcasts, remain retryable while pending, and are marked complete only after confirmation. See `TESTNET_BLOCKCHAIN_VERIFICATION.md`.

This build does not enable mainnet. It refuses any `NIMIQ_NETWORK` other than `testnet`.

The payout signer env vars are `NIMIQ_ESCROW_MNEMONIC` and `NIMIQ_REWARDS_POOL_MNEMONIC`. Each one must contain a quoted 24-word recovery phrase, not a raw hex private key. The app derives the signing key pair at startup and fails immediately if either mnemonic does not resolve to the configured wallet address.

## GitHub-safe checklist

- Keep `.env.local` out of Git.
- Commit `.env.example` only with placeholders.
- Exclude `node_modules`, `.next`, and `data/*.db`.
- Run `npm run build` before pushing.
