import { NextResponse } from "next/server";

/**
 * Mints a SHORT-LIVED AssemblyAI token for the browser.
 *
 * Why this exists: the API key must never reach the client. The browser opens
 * its own websocket to AssemblyAI using a temporary token issued here.
 *
 * TODO(week A): call the AssemblyAI temporary-token endpoint and return the
 * token. Verify the exact endpoint and expiry parameter against current docs
 * before wiring - do not guess the shape.
 */
export async function POST() {
  const key = process.env.ASSEMBLYAI_API_KEY;

  if (!key) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: "not_implemented", detail: "Token minting lands in Week A." },
    { status: 501 },
  );
}
