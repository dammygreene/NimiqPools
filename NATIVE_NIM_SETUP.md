# Native NIM testnet setup

Nimiq Pools is designed to run inside Nimiq Pay. Nimiq Pay exposes each user's existing Nimiq account to the Mini App after approval; the application does not create or hold user private keys.

## Platform accounts

Create two separate native NIM basic accounts for testnet:

1. **Prediction escrow account** — receives participant stakes and sends winner payouts or refunds.
2. **Rewards account** — holds only signup and referral rewards.

Set their public addresses in `.env.local`:

```dotenv
NIMIQ_NETWORK=testnet
NIMIQ_ESCROW_ADDRESS=NQ...
NIMIQ_REWARDS_POOL_ADDRESS=NQ...
NIMIQ_RPC_URL=...
```

A third offline treasury account is recommended before mainnet so operational accounts can be refilled without exposing treasury funds to the application server.

## User accounts for testing

A practical end-to-end test uses three Nimiq Pay user accounts:

- one pool creator;
- two participants, including at least one referred participant.

Together with the two platform accounts, that is five testnet addresses. Only the two platform accounts are configured by the application.

## Local browser preview

The real wallet connection works inside Nimiq Pay. For a UI-only browser preview on localhost, explicitly enable the non-paying demo wallet:

```dotenv
NEXT_PUBLIC_ENABLE_DEMO_WALLET=true
```

Keep this disabled in every deployed build.

## No Solidity contracts

Native NIM is not an ERC-20 token and the native Nimiq chain does not deploy arbitrary Solidity pool contracts. This repository therefore contains no Hardhat, Sepolia, mock-token, factory, or EVM escrow package. Stakes and rewards use two native NIM basic accounts plus backend accounting.

## Required work before real-value testing

The current repository still uses simulated reward claim transaction hashes and records submitted stake hashes without full chain verification. Before enabling real NIM:

- verify every stake transaction against the Nimiq RPC before recording participation;
- verify signed prediction and claim payloads server-side;
- add an idempotent payout/refund service that signs from the correct operational account;
- reconcile each account balance against unpaid liabilities;
- add the scheduled resolver worker for Binance, CoinGecko, football-data.org, Open-Meteo, and manual outcomes;
- store payout signing keys in a managed secrets system, never in the repository or frontend.
