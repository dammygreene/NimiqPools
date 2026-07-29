import { apiError, json } from "@/lib/http";
import { ConflictError, InputError, PausedError, createVerifiedParticipant, getPool, isPaused, recordJoinAttempt, transactionHashUsed, updateJoinAttempt } from "@/lib/db";
import { canonicalAddress, canonicalTransactionHash, nimiqService, verifySignedPredictionPayload } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let joinAttemptId: string | null = null;
  try {
    if (isPaused()) throw new PausedError("The service is temporarily paused.");

    const { id } = await context.params;
    const rawBody = await request.text();
    const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
    const pool = getPool(id);
    if (!pool) throw new InputError("Pool not found.");

    const txHash = canonicalTransactionHash(String(body.stakeTxHash || "").trim());
    const requiredAmountLuna = Number(pool.stake_amount_luna);
    const requestAddress = canonicalAddress(body.address, "Wallet address");
    joinAttemptId = recordJoinAttempt({
      poolId: id,
      requestAddress,
      predictedOutcome: typeof body.predictedOutcome === "string" ? body.predictedOutcome : null,
      stakeTxHashSubmitted: txHash,
      stakeAmountLuna: requiredAmountLuna,
      requestBody: rawBody,
    });

    const signedPrediction = await verifySignedPredictionPayload({
      payload: String(body.predictionPayload || ""),
      signature: String(body.predictionSignature || ""),
      publicKey: String(body.predictionPublicKey || ""),
      expectedPoolId: id,
      expectedOutcome: typeof body.predictedOutcome === "string" ? body.predictedOutcome : undefined,
      expectedAmount: requiredAmountLuna,
      expectedPredictionClosesAt: String(pool.prediction_closes_at),
      requestAddress,
      requestBodyPreview: rawBody.slice(0, 4000),
    });
    const sender = signedPrediction.authoritativeAddress;
    updateJoinAttempt(joinAttemptId, {
      authoritativeAddress: sender,
      debug: {
        requestAddress,
        payloadAddress: signedPrediction.payloadAddress,
        publicKeyAddress: signedPrediction.publicKeyAddress,
      },
    });

    const verification = await nimiqService.waitForStakeVerification(id, txHash, requiredAmountLuna, sender);
    if (!verification.ok) {
      updateJoinAttempt(joinAttemptId, {
        authoritativeAddress: sender,
        status: "failed",
        failureCode: verification.code,
        failureReason: verification.reason,
        debug: verification.debug ?? null,
      });
      throw new InputError(`${verification.code}: ${verification.reason}`);
    }
    const verifiedTxHash = verification.transaction.hash;
    if (transactionHashUsed(verifiedTxHash)) {
      throw new ConflictError("This transaction hash has already been used by another join or claim.");
    }

    const result = createVerifiedParticipant(id, { ...body, address: sender, stakeAmountLuna: requiredAmountLuna, stakeTxHash: verifiedTxHash });
    updateJoinAttempt(joinAttemptId, {
      authoritativeAddress: sender,
      stakeTxHashVerified: verifiedTxHash,
      status: "verified",
      failureCode: null,
      failureReason: null,
      debug: {
        requestAddress,
        payloadAddress: signedPrediction.payloadAddress,
        publicKeyAddress: signedPrediction.publicKeyAddress,
        verifiedTransactionHash: verifiedTxHash,
        actualSenderAsReturnedByGetTransaction: verification.transaction.senderDisplay || verification.transaction.sender,
      },
    });
    return json({ ok: true, verification: { confirmations: verification.confirmations, transactionHash: verifiedTxHash }, ...result }, 201);
  } catch (error) {
    if (joinAttemptId) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCodeMatch = message.match(/^([A-Z_]+):\s/);
      updateJoinAttempt(joinAttemptId, {
        status: "failed",
        failureCode: failureCodeMatch?.[1] ?? null,
        failureReason: message,
      });
    }
    return apiError(error);
  }
}
