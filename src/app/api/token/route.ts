import { NextResponse, type NextRequest } from 'next/server';

/**
 * Mints a SHORT-LIVED, SINGLE-USE AssemblyAI token for the browser. This is the ONLY place the API
 * key is read. The demo URL is public, so the endpoint is guarded: same-origin only, a hard cap on
 * session length, and a per-client rate limit (best effort; serverless instances do not share memory).
 *
 * GET /api/token?kind=agent  -> Voice Agent API   (https://agents.assemblyai.com/v1/token)
 * GET /api/token?kind=stt    -> Streaming STT v3  (https://streaming.assemblyai.com/v3/token)
 */
const ENDPOINTS = {
  agent: 'https://agents.assemblyai.com/v1/token',
  stt: 'https://streaming.assemblyai.com/v3/token',
} as const;

const TOKEN_TTL_SECONDS = 60;
const WINDOW_MS = 10 * 60_000;
const MAX_TOKENS_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function sessionCapSeconds(): number {
  const n = Number(process.env.SESSION_MAX_SECONDS ?? 300);
  return Math.min(Math.max(Number.isFinite(n) ? n : 300, 60), 600);
}

function rateLimited(client: string): boolean {
  const now = Date.now();
  const recent = (hits.get(client) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_TOKENS_PER_WINDOW) {
    hits.set(client, recent);
    return true;
  }
  hits.set(client, [...recent, now]);
  return false;
}

export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'not_configured', detail: 'ASSEMBLYAI_API_KEY is not set on the server. Copy .env.example to .env.' },
      { status: 503, headers },
    );
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  }

  const kind = req.nextUrl.searchParams.get('kind') === 'stt' ? 'stt' : 'agent';
  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(client)) {
    return NextResponse.json({ error: 'rate_limited', detail: 'Too many sessions started. Try again in a few minutes.' }, { status: 429, headers });
  }

  const url = new URL(ENDPOINTS[kind]);
  url.searchParams.set('expires_in_seconds', String(TOKEN_TTL_SECONDS));
  url.searchParams.set('max_session_duration_seconds', String(sessionCapSeconds()));

  const upstream = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'upstream', status: upstream.status }, { status: 502, headers });
  }
  const { token } = (await upstream.json()) as { token: string };
  return NextResponse.json({ token, maxSessionSeconds: sessionCapSeconds() }, { headers });
}
