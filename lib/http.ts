import { NextResponse } from "next/server";
import { AppError } from "./db";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function apiError(error: unknown) {
  if (error instanceof AppError) {
    return json({ error: error.message }, error.status);
  }
  if (error instanceof Error && /waiting for Nimiq .* consensus/i.test(error.message)) {
    console.error("API error", error);
    return json({ error: "Nimiq network is temporarily unavailable. Please try again once wallet balance verification reconnects." }, 503);
  }
  console.error("API error", error);
  return json({ error: "The pool service could not complete this request." }, 500);
}
