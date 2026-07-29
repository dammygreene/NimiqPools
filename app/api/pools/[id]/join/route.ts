import { apiError, json } from "@/lib/http";
import { ConflictError, InputError, PausedError, createVerifiedParticipant, getPool, isPaused, transactionHashUsed } from "@/lib/db";
import { canonicalAddress, canonicalTransactionHash, nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isPaused()) throw new PausedError("The service is temporarily paused.");

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const pool = getPool(id);
    if (!pool) throw new InputError("Pool not found.");

    const txHash = canonicalTransactionHash(String(body.stakeTxHash || "").trim());
    const sender = canonicalAddress(body.address, "Wallet address");
    if (transactionHashUsed(txHash)) {
      throw new ConflictError("This transaction hash has already been used by another join or claim.");
    }

    const balance = await nimiqService.getBalance(sender);
    const requiredAmountLuna = Number(pool.stake_amount_luna);
    if (balance < requiredAmountLuna) {
      throw new ConflictError(
        `Insufficient NIM balance - you need at least ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(requiredAmountLuna / 100_000)} NIM to join this pool. Your wallet has ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(balance / 100_000)} NIM.`,
      );
    }

    const verification = await nimiqService.verifyStake(id, txHash, requiredAmountLuna, sender);
    if (!verification.ok) throw new InputError(`${verification.code}: ${verification.reason}`);

    const result = createVerifiedParticipant(id, { ...body, stakeAmountLuna: requiredAmountLuna, stakeTxHash: txHash });
    return json({ ok: true, verification: { confirmations: verification.confirmations, transactionHash: verification.transaction.hash }, ...result }, 201);
  } catch (error) {
    return apiError(error);
  }
}
