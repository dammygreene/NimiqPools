# Unverified Testnet Build Notice

This package contains the in-progress Nimiq Pools testnet verification-layer changes.

It is **not verified, not mainnet-ready, and must not be used with real funds**.

Known blockers at packaging time:

- `@nimiq/core` could not be installed in the build environment because npm registry requests returned network/registry errors.
- The production build was not completed.
- Transaction-builder, signing, lookup, and broadcast APIs were not confirmed against the installed package because installation did not complete.
- Cryptographic claim-signature verification still requires implementation and passing tests.
- No live TestAlbatross transactions were executed.
- No explorer-confirmed stake, reward, or pool-payout transaction hashes are included.
- `/api/admin/resolve-due` has not been exercised against a running build.

Before testnet use:

1. Install dependencies in an environment with working npm access.
2. Pin and inspect the installed `@nimiq/core` version.
3. Run `npm run build` and resolve all errors.
4. Add cryptographic nonce/challenge signature verification to reward and payout claims.
5. Configure disposable funded TestAlbatross escrow and rewards wallets.
6. Complete all real-chain verification cases documented in the project.

Do not remove this notice until those checks have passed and the evidence has been recorded.
