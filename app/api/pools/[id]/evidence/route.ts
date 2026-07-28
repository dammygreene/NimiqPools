import { apiError, json } from "@/lib/http";
import { addEvidence, listEvidence } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return json({ evidence: listEvidence(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const evidence = addEvidence(
      id,
      (await request.json()) as Record<string, unknown>,
    );
    return json({ evidence }, 201);
  } catch (error) {
    return apiError(error);
  }
}
