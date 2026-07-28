import { apiError, json } from "@/lib/http";
import { ConflictError, InputError, PausedError, createVerifiedParticipant, getPool, isPaused, transactionHashUsed } from "@/lib/db";
import { nimiqService } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isPaused()) throw new PausedError("The service is temporarily paused.");

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const pool = getPool(id);
    if (!pool) throw new InputError("Pool not found.");

    const txHash = String(body.stakeTxHash || "").trim();
    const sender = String(body.address || "");
    if (!txHash || !sender) throw new InputError("Wallet and stake transaction hash are required.");
    if (transactionHashUsed(txHash)) {
      throw new ConflictError("This transaction hash has already been used by another join or claim.");
    }

    const verification = await nimiqService.verifyStake(id, txHash, Number(pool.stake_amount_luna), sender);
    if (!verification.ok) throw new InputError(`${verification.code}: ${verification.reason}`);

    const result = createVerifiedParticipant(id, { ...body, stakeAmountLuna: Number(pool.stake_amount_luna) });
    return json({ ok: true, verification: { confirmations: verification.confirmations, transactionHash: verification.transaction.hash }, ...result }, 201);
  } catch (error) {
    return apiError(error);
  }
}
