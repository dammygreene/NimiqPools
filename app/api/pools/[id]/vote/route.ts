import { apiError, json } from "@/lib/http";
import { addResolutionVote, InputError } from "@/lib/db";
import { canonicalAddress } from "@/lib/nimiq-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.address || !body.outcome) throw new InputError("Address and outcome required.");
    addResolutionVote(id, canonicalAddress(body.address, "Address"), String(body.outcome), String(body.evidenceNote || ""));
    return json({ ok: true }, 201);
  } catch (error) {
    return apiError(error);
  }
}
