import {
  Address,
  Client,
  ClientConfiguration,
  KeyPair,
  MnemonicUtils,
  PublicKey,
  Signature,
  Transaction,
  TransactionBuilder,
} from "@nimiq/core";
import { createHash } from "node:crypto";
import { InputError } from "@/lib/db";
import { deriveSigningWalletFromMnemonic } from "@/lib/nimiq-keys";

export type ChainTransaction = {
  hash: string;
  sender: string;
  recipient: string;
  value: number;
  data: string;
  blockHeight: number | null;
  raw: unknown;
};

export type VerifyResult =
  | { ok: true; transaction: ChainTransaction; confirmations: number }
  | { ok: false; code: string; reason: string };

export type TxResult = { hash: string; transaction: unknown };

type NimiqClient = any;

type SigningWallet = {
  address: string;
  keyPair: InstanceType<typeof KeyPair>;
};

export const DEFAULT_TESTALBATROSS_SEED_NODES = ["/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss"];
export const DEFAULT_MAINALBATROSS_SEED_NODES = [
  "/dns4/aurora.seed.nimiq.com/tcp/443/wss",
  "/dns4/catalyst.seed.nimiq.network/tcp/443/wss",
  "/dns4/cipher.seed.nimiq-network.com/tcp/443/wss",
  "/dns4/eclipse.seed.nimiq.cloud/tcp/443/wss",
  "/dns4/lumina.seed.nimiq.systems/tcp/443/wss",
  "/dns4/nebula.seed.nimiq.com/tcp/443/wss",
  "/dns4/nexus.seed.nimiq.network/tcp/443/wss",
  "/dns4/polaris.seed.nimiq-network.com/tcp/443/wss",
  "/dns4/photon.seed.nimiq.cloud/tcp/443/wss",
  "/dns4/pulsar.seed.nimiq.systems/tcp/443/wss",
  "/dns4/quasar.seed.nimiq.com/tcp/443/wss",
  "/dns4/solstice.seed.nimiq.network/tcp/443/wss",
  "/dns4/vortex.seed.nimiq.cloud/tcp/443/wss",
  "/dns4/zenith.seed.nimiq.systems/tcp/443/wss",
];

function runtimeNetwork() {
  return (process.env.NIMIQ_NETWORK || "testnet").trim().toLowerCase();
}

function clientNetworkName(network: string) {
  if (network === "mainnet") return "MainAlbatross";
  if (network === "testnet") return "TestAlbatross";
  throw new Error(`Unsupported NIMIQ_NETWORK value: ${network}. Expected mainnet or testnet.`);
}

export type SignedClaimPayload = {
  domain: string;
  version: number;
  address: string;
  nonce: string;
  rewardEventId?: string;
  poolId?: string;
  amount?: number;
};

function normalizeAddress(value: unknown): string {
  if (!value) return "";
  const candidate = value as any;
  if (typeof candidate === "string") {
    const text = candidate.trim();
    const compact = text.replace(/\s+/g, "");
    try {
      return Address.fromString(text).toUserFriendlyAddress().replace(/\s+/g, "").toUpperCase();
    } catch {
      try {
        return Address.fromString(compact.toUpperCase()).toUserFriendlyAddress().replace(/\s+/g, "").toUpperCase();
      } catch {
        return compact.toUpperCase();
      }
    }
  }
  if (typeof candidate.toUserFriendlyAddress === "function") {
    return String(candidate.toUserFriendlyAddress()).replace(/\s+/g, "").toUpperCase();
  }
  return String(candidate).replace(/\s+/g, "").toUpperCase();
}

function parseAddress(value: unknown, label: string): Address {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!text) throw new InputError(`${label} is required.`);
  try {
    return Address.fromString(text);
  } catch {
    const compact = text.replace(/\s+/g, "").toUpperCase();
    if (compact !== text) {
      try {
        return Address.fromString(compact);
      } catch {
        // Fall through to the shared error message below.
      }
    }
    console.warn("Nimiq address validation failed", { label, value: text });
    throw new InputError(`${label} must be a valid Nimiq address. Received "${text}".`);
  }
}

export function canonicalAddress(value: unknown, label = "Address"): string {
  return parseAddress(value, label).toUserFriendlyAddress();
}

function normalizeHex(value: unknown, label: string, byteLength: number): string {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!text) throw new InputError(`${label} is required.`);
  const compact = stripHexPrefix(text).replace(/\s+/g, "");
  if (!/^[0-9a-f]+$/i.test(compact)) {
    console.warn("Nimiq hex validation failed", { label, value: text, expectedHexCharacters: byteLength * 2 });
    throw new InputError(`${label} must be hex. Received "${text}".`);
  }
  if (compact.length !== byteLength * 2) {
    console.warn("Nimiq hex length validation failed", { label, value: text, actualLength: compact.length, expectedLength: byteLength * 2 });
    throw new InputError(`${label} must be ${byteLength * 2} hex characters long. Received "${text}".`);
  }
  return compact;
}

export function canonicalTransactionHash(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!text) throw new InputError("Stake transaction hash is required.");
  const compact = stripHexPrefix(text).replace(/\s+/g, "");
  if (/^[0-9a-f]{64}$/i.test(compact)) return compact;
  const embeddedHash = text.match(/[0-9a-f]{64}/i)?.[0];
  if (embeddedHash && /transactionHash|hash/i.test(text)) return embeddedHash;
  try {
    return Transaction.fromAny(compact).hash();
  } catch (error) {
    console.warn("Stake transaction hash validation failed", { value: text, error });
    throw new InputError(`Stake transaction hash must be a real transaction hash or serialized transaction. Received "${text}".`);
  }
}

function bytesToText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
      try { return new TextDecoder().decode(Uint8Array.from(Buffer.from(value, "hex"))); } catch {}
    }
    return value;
  }
  const candidate = value as any;
  if (candidate && typeof candidate.raw === "string") return bytesToText(candidate.raw);
  try {
    const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value as ArrayLike<number>);
    return new TextDecoder().decode(bytes).replace(/\0+$/g, "");
  } catch { return ""; }
}

function numberValue(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  const candidate = value as any;
  if (candidate && typeof candidate.toString === "function") return Number(candidate.toString());
  return NaN;
}

function stripHexPrefix(value: string) {
  return value.replace(/^0x/i, "");
}

const NIMIQ_SIGNED_MESSAGE_PREFIX = "\x16Nimiq Signed Message:\n";

function utf8Bytes(text: string) {
  return Buffer.from(text, "utf8");
}

function toHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

function nimiqSignedMessageInput(message: string) {
  return `${NIMIQ_SIGNED_MESSAGE_PREFIX}${message.length}${message}`;
}

function nimiqSignedMessageHash(message: string) {
  return createHash("sha256").update(utf8Bytes(nimiqSignedMessageInput(message))).digest();
}

function diffStrings(actual: string, expected: string) {
  const max = Math.max(actual.length, expected.length);
  const diffs: Array<{ index: number; actual: string; expected: string }> = [];
  for (let index = 0; index < max; index += 1) {
    const left = actual[index] ?? "<EOF>";
    const right = expected[index] ?? "<EOF>";
    if (left !== right) diffs.push({ index, actual: left, expected: right });
  }
  return diffs;
}

export function verifySignedClaimPayload(options: {
  payload: string;
  signature: string;
  publicKey: string;
  expectedAddress: string;
  expectedDomain: "nimiq-pools-reward" | "nimiq-pools-payout";
  claimIdField: "rewardEventId" | "poolId";
  claimId: string;
  expectedAmount?: number;
  requestBodyPreview?: string;
  frontendPayload?: string;
  frontendPayloadUtf8Hex?: string;
}): SignedClaimPayload {
  const {
    payload,
    signature,
    publicKey,
    expectedAddress,
    expectedDomain,
    claimIdField,
    claimId,
    expectedAmount,
    requestBodyPreview,
    frontendPayload,
    frontendPayloadUtf8Hex,
  } = options;
  if (typeof payload !== "string" || !payload.trim()) throw new InputError("Signed claim payload is required.");
  if (typeof signature !== "string" || !signature.trim()) throw new InputError("Signed claim signature is required.");
  if (typeof publicKey !== "string" || !publicKey.trim()) throw new InputError("Signed claim public key is required.");

  let parsed: SignedClaimPayload;
  try {
    parsed = JSON.parse(payload) as SignedClaimPayload;
  } catch {
    throw new InputError("Signed claim payload must be valid JSON.");
  }

  if (parsed.domain !== expectedDomain) throw new InputError("Signed claim domain mismatch.");
  if (parsed.version !== 1) throw new InputError("Signed claim version mismatch.");
  const payloadAddress = parseAddress(parsed.address, "Signed claim address");
  const requestAddress = parseAddress(expectedAddress, "Requesting wallet address");
  if (normalizeAddress(payloadAddress) !== normalizeAddress(requestAddress)) throw new InputError("Signed claim address does not match the requesting wallet.");
  if (parsed[claimIdField] !== claimId) throw new InputError("Signed claim payload does not match the target claim.");
  if (typeof parsed.nonce !== "string" || !parsed.nonce.trim()) throw new InputError("Signed claim nonce is required.");
  if (expectedAmount != null && numberValue(parsed.amount) !== expectedAmount) throw new InputError("Signed claim amount does not match the claim amount.");

  const claimPublicKey = PublicKey.fromHex(normalizeHex(publicKey, "Signed claim public key", 32));
  if (normalizeAddress(claimPublicKey.toAddress()) !== normalizeAddress(requestAddress)) {
    throw new InputError("Signed claim public key does not match the wallet address.");
  }
  const claimSignature = Signature.fromHex(normalizeHex(signature, "Signed claim signature", 64));
  const rawPayloadBytes = utf8Bytes(payload);
  const signedMessageInput = nimiqSignedMessageInput(payload);
  const signedMessageInputBytes = utf8Bytes(signedMessageInput);
  const signedMessageHash = nimiqSignedMessageHash(payload);
  const frontendPayloadDiff = typeof frontendPayload === "string" ? diffStrings(frontendPayload, payload) : [];
  const signedMessageVerified = claimPublicKey.verify(claimSignature, signedMessageHash);
  const rawPayloadVerified = claimPublicKey.verify(claimSignature, rawPayloadBytes);

  console.info("[claim-signature-debug]", {
    expectedDomain,
    claimIdField,
    claimId,
    expectedAddress: requestAddress.toUserFriendlyAddress(),
    parsedPayload: parsed,
    frontendPayload,
    frontendPayloadUtf8Hex,
    backendPayload: payload,
    backendPayloadUtf8Hex: toHex(rawPayloadBytes),
    frontendPayloadDiff,
    frontendMatchesBackend:
      typeof frontendPayload === "string"
        ? frontendPayload === payload && frontendPayloadUtf8Hex === toHex(rawPayloadBytes)
        : null,
    signedMessageInput,
    signedMessageInputUtf8Hex: toHex(signedMessageInputBytes),
    signedMessageHashHex: toHex(signedMessageHash),
    verification: {
      signedMessageVerified,
      rawPayloadVerified,
    },
    requestBodyPreview,
  });

  if (!signedMessageVerified && !rawPayloadVerified) {
    throw new InputError("Signed claim signature is invalid.");
  }

  return parsed;
}

export class NimiqService {
  private static instance: NimiqService | undefined;
  private clientPromise: Promise<NimiqClient> | undefined;
  private readonly escrowWallet: SigningWallet;
  private readonly rewardsWallet: SigningWallet;
  private readonly consensusTimeoutMs: number;
  readonly confirmationsRequired: number;

  private constructor() {
    this.confirmationsRequired = Math.max(1, Number(process.env.NIMIQ_CONFIRMATIONS_REQUIRED || 2));
    this.consensusTimeoutMs = Math.max(90_000, Number(process.env.NIMIQ_CONSENSUS_TIMEOUT_MS || 90_000));
    this.escrowWallet = this.loadSigningWallet(
      "NIMIQ_ESCROW_MNEMONIC",
      "NIMIQ_ESCROW_ADDRESS",
      "escrow",
    );
    this.rewardsWallet = this.loadSigningWallet(
      "NIMIQ_REWARDS_POOL_MNEMONIC",
      "NIMIQ_REWARDS_POOL_ADDRESS",
      "rewards pool",
    );
  }

  static getInstance() {
    return (this.instance ??= new NimiqService());
  }

  private loadSigningWallet(mnemonicEnv: string, addressEnv: string, label: string): SigningWallet {
    const mnemonic = process.env[mnemonicEnv]?.trim();
    if (!mnemonic) throw new Error(`${mnemonicEnv} is not configured.`);
    const expectedAddress = process.env[addressEnv]?.trim();
    if (!expectedAddress) throw new Error(`${addressEnv} is not configured.`);
    const derived = deriveSigningWalletFromMnemonic(mnemonic);
    const keyPair = derived.keyPair;
    const derivedAddress = normalizeAddress(derived.address);
    const configuredAddress = normalizeAddress(expectedAddress);
    if (derivedAddress !== configuredAddress) {
      throw new Error(
        `The ${label} mnemonic does not derive to ${addressEnv}. Derived ${derivedAddress}, expected ${configuredAddress}.`,
      );
    }
    return { address: configuredAddress, keyPair };
  }

  private async getClient(): Promise<NimiqClient> {
    this.clientPromise ??= (async () => {
      const config = new ClientConfiguration();
      const network = runtimeNetwork();
      config.network(clientNetworkName(network));
      const configuredSeedNodes = (process.env.NIMIQ_SEED_NODES || "")
        .split(",")
        .map((seed) => seed.trim())
        .filter(Boolean);
      if (configuredSeedNodes.length > 0) {
        config.seedNodes(configuredSeedNodes);
      } else if (network === "testnet") {
        config.seedNodes(DEFAULT_TESTALBATROSS_SEED_NODES);
      } else if (network === "mainnet") {
        config.seedNodes(DEFAULT_MAINALBATROSS_SEED_NODES);
      }
      const client = await Client.create(config.build());
      await Promise.race([
        client.waitForConsensusEstablished(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Timed out after ${this.consensusTimeoutMs}ms waiting for Nimiq ${clientNetworkName(network)} consensus.`,
              ),
            );
          }, this.consensusTimeoutMs);
        }),
      ]);
      return client;
    })();
    return this.clientPromise;
  }

  async getBalance(address: string): Promise<number> {
    const client = await this.getClient();
    const parsed = parseAddress(address, "Wallet address");
    const account = await client.getAccount(parsed);
    const balance = account?.balance ?? account?.value ?? account;
    const result = numberValue(balance);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid balance returned by Nimiq client.");
    return result;
  }

  async getTransaction(hash: string): Promise<ChainTransaction | null> {
    const client = await this.getClient();
    const txHash = canonicalTransactionHash(hash);
    let details: any = null;
    try {
      details = await client.getTransaction(txHash);
    } catch {
      try {
        const receipt = await client.getTransactionReceipt(txHash);
        if (!receipt) return null;
        details = await client.getTransaction(txHash, receipt.blockHash, receipt.blockHeight);
      } catch { return null; }
    }
    if (!details) return null;
    const tx = details.transaction ?? details;
    const resolvedHash = String(details.transactionHash ?? details.hash ?? tx.hash ?? txHash);
    return {
      hash: resolvedHash,
      sender: normalizeAddress(tx.sender ?? details.sender),
      recipient: normalizeAddress(tx.recipient ?? details.recipient),
      value: numberValue(tx.value ?? details.value),
      data: bytesToText(tx.data ?? details.data),
      blockHeight: Number.isFinite(numberValue(details.blockHeight ?? tx.blockHeight))
        ? numberValue(details.blockHeight ?? tx.blockHeight) : null,
      raw: details,
    };
  }

  async getTransactionConfirmations(hash: string): Promise<number> {
    const tx = await this.getTransaction(hash);
    if (!tx?.blockHeight) return 0;
    const client = await this.getClient();
    const head = numberValue(await client.getHeadHeight());
    return Math.max(0, head - tx.blockHeight + 1);
  }

  async verifyStake(poolId: string, txHash: string, expectedAmount: number, expectedSender: string): Promise<VerifyResult> {
    const transaction = await this.getTransaction(txHash);
    if (!transaction) {
      const network = clientNetworkName(runtimeNetwork());
      return { ok: false, code: "TX_NOT_FOUND", reason: `The transaction does not exist on Nimiq ${network}.` };
    }
    const confirmations = await this.getTransactionConfirmations(txHash);
    if (confirmations < this.confirmationsRequired) return { ok: false, code: "INSUFFICIENT_CONFIRMATIONS", reason: `The stake has ${confirmations} confirmation(s); ${this.confirmationsRequired} required.` };
    const parsedExpectedSender = parseAddress(expectedSender, "Joining wallet address");
    if (transaction.sender !== normalizeAddress(parsedExpectedSender)) return { ok: false, code: "SENDER_MISMATCH", reason: "The transaction sender does not match the joining wallet." };
    const escrow = process.env.NIMIQ_ESCROW_ADDRESS;
    if (!escrow) return { ok: false, code: "ESCROW_NOT_CONFIGURED", reason: "NIMIQ_ESCROW_ADDRESS is not configured." };
    const parsedEscrow = parseAddress(escrow, "Prediction escrow address");
    if (transaction.recipient !== normalizeAddress(parsedEscrow)) return { ok: false, code: "RECIPIENT_MISMATCH", reason: "The transaction recipient is not the configured prediction escrow." };
    if (transaction.value !== expectedAmount) return { ok: false, code: "AMOUNT_MISMATCH", reason: `The transaction value is ${transaction.value} Luna; exactly ${expectedAmount} Luna is required.` };
    if (!transaction.data.includes(poolId)) return { ok: false, code: "POOL_DATA_MISMATCH", reason: "The transaction data does not contain the expected pool ID." };
    return { ok: true, transaction, confirmations };
  }

  async verifyRewardClaim(txHash: string): Promise<VerifyResult> {
    const transaction = await this.getTransaction(txHash);
    if (!transaction) return { ok: false, code: "TX_NOT_FOUND", reason: "Reward transaction was not found on-chain." };
    const confirmations = await this.getTransactionConfirmations(txHash);
    if (confirmations < this.confirmationsRequired) return { ok: false, code: "INSUFFICIENT_CONFIRMATIONS", reason: "Reward transaction has not reached the confirmation threshold." };
    return { ok: true, transaction, confirmations };
  }

  private async send(fromAddress: string, toAddress: string, amount: number, keyPair: SigningWallet["keyPair"], data: string): Promise<TxResult> {
    const client = await this.getClient();
    const sender = parseAddress(fromAddress, "Source wallet address");
    const recipient = parseAddress(toAddress, "Destination wallet address");
    if (normalizeAddress(keyPair.publicKey.toAddress()) !== normalizeAddress(sender)) throw new Error("Configured signing wallet does not match payout address.");
    const height = await client.getHeadHeight();
    const networkId = await client.getNetworkId();
    let transaction: any;
    if ((TransactionBuilder as any).newBasicWithData) {
      transaction = (TransactionBuilder as any).newBasicWithData(sender, recipient, new TextEncoder().encode(data), BigInt(amount), BigInt(0), height, networkId);
      transaction.sign(keyPair);
    } else if ((TransactionBuilder as any).newBasic) {
      transaction = (TransactionBuilder as any).newBasic(sender, recipient, BigInt(amount), BigInt(0), height, networkId);
      transaction.sign(keyPair);
    } else {
      transaction = (Transaction as any).fromPlain({ sender: fromAddress, recipient: toAddress, value: amount, fee: 0, validityStartHeight: height, data });
      transaction.sign(keyPair);
    }
    const result = await client.sendTransaction(transaction);
    const hash = String(result?.transactionHash ?? result?.hash ?? transaction.hash?.() ?? "");
    if (!hash) throw new Error("Nimiq client broadcast did not return a transaction hash.");
    return { hash, transaction: result ?? transaction };
  }

  sendPayout(fromAddress: string, toAddress: string, amount: number) {
    return this.send(fromAddress, toAddress, amount, this.escrowWallet.keyPair, "NIMIQ-POOLS:PAYOUT");
  }

  sendReward(fromAddress: string, toAddress: string, amount: number) {
    return this.send(fromAddress, toAddress, amount, this.rewardsWallet.keyPair, "NIMIQ-POOLS:REWARD");
  }

  async waitForConfirmation(hash: string): Promise<number> {
    const timeout = Number(process.env.NIMIQ_PAYOUT_CONFIRM_TIMEOUT_MS || 120000);
    const interval = Number(process.env.NIMIQ_PAYOUT_POLL_INTERVAL_MS || 2000);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const confirmations = await this.getTransactionConfirmations(hash);
      if (confirmations >= this.confirmationsRequired) return confirmations;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return 0;
  }
}

export const nimiqService = {
  get confirmationsRequired() {
    return NimiqService.getInstance().confirmationsRequired;
  },
  getBalance(address: string) {
    return NimiqService.getInstance().getBalance(address);
  },
  getTransaction(hash: string) {
    return NimiqService.getInstance().getTransaction(hash);
  },
  getTransactionConfirmations(hash: string) {
    return NimiqService.getInstance().getTransactionConfirmations(hash);
  },
  verifyStake(poolId: string, txHash: string, expectedAmount: number, expectedSender: string) {
    return NimiqService.getInstance().verifyStake(poolId, txHash, expectedAmount, expectedSender);
  },
  verifyRewardClaim(txHash: string) {
    return NimiqService.getInstance().verifyRewardClaim(txHash);
  },
  sendPayout(fromAddress: string, toAddress: string, amount: number) {
    return NimiqService.getInstance().sendPayout(fromAddress, toAddress, amount);
  },
  sendReward(fromAddress: string, toAddress: string, amount: number) {
    return NimiqService.getInstance().sendReward(fromAddress, toAddress, amount);
  },
  waitForConfirmation(hash: string) {
    return NimiqService.getInstance().waitForConfirmation(hash);
  },
} as const;
