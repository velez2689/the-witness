# CLAUDE.md — The Witness

Read this before writing any code. It is short on purpose; every line is here because
getting it wrong costs days.

## What this is
A voice agent that rides along on a live payer phone call a medical biller is already
making. It captures what the payer said as timestamped, quotable statements; detects
contradictions against prior calls on the same claim in real time; **speaks** coaching
into the biller's private earpiece mid-call; and emits an appeal packet quoting the
transcript with timestamps.

Deadline: **Sep 30 2026, 11:00 ET.** Feature freeze Sep 23.

## The one sentence that settles most design arguments
**We don't predict what the payer will pay. We record what the payer said.**

Every claim the product makes must trace to an utterance a human can play back.
Nothing is inferred, scored, or adjudicated.

## Read before starting
- **`docs/PROJECT-STATE.md` — read this first.** Everything we have decided and why,
  where things stand, what is built, what is next. One file, no archaeology needed.
- `.repo-layout.yml` — the structure contract. Machine-readable. **Run its placement
  procedure before creating any file.**
- `docs/ARCHITECTURE.md` — why the layout is what it is, and the three decisions that
  are easy to get wrong.
- `fixtures/scripts/claim-A-4471-08.md` — the demo corpus. Six calls on one claim, with
  extraction targets and firing flags marked per call. **This is the test data. Build
  against it.**

## HARD CONSTRAINTS — do not violate these

**1 · The agent cannot call tools.**
The only LLM this account can reach is `qwen3.5-4b-fast`, and it does **not** support
tool calling. Nothing may depend on JSON-schema tool calls through the LLM Gateway.
The agent is driven from our contradiction engine via `reply.create` with one-shot
instructions.

**2 · The agent never writes to the claim ledger.**
Our code owns every write. The agent is a mouth, not a hand.

**3 · Evidence-bearing speech is assembled, not generated.**
The contradiction flag, the readback prompt and the Close-Out are built by our code
from statement rows. The model supplies conversational glue only. A 4B model will
occasionally phrase things oddly; that must never touch a quoted fact.

**4 · Pin both models explicitly.**
`universal-3-5-pro` for STT, `qwen3.5-4b-fast` for the agent. Never rely on default
resolution — the default may resolve to a model this account cannot reach, and it
fails looking like a connection error.

**5 · Guaranteed `Terminate`, in the same commit as the socket code.**
Billing is on websocket-open duration; an abandoned session bills three hours. Hard
session timeout plus `Terminate` on every exit path — normal close, error, crash,
page unload, tab close. Not a follow-up task.

**6 · Never auto-connect.**
The account allows **5 new streams per minute** and one call opens two. Session start
is an explicit user action. No connect on page load, no reconnect on hot reload, no
retry loop. A dev loop that reconnects on save will exhaust the limit and present as
a connection bug.

**7 · The API key lives in exactly one place.**
`src/app/api/token/` only. The browser gets a short-lived token. The repo is public
and the demo URL is public — there is no "just for now."

**8 · Separate session per channel. Never diarization.**
Live diarization is beta. Channel A (payer) → Streaming STT v3, listen-only, keyterms
seeded with the claim's own numbers. Channel B (biller) → Voice Agent API.

**9 · The agent's audio must never reach the payer's line.**
If agent TTS plays through the same headset whose mic feeds the call, the payer hears
the coaching. Product-ending on a recorded line. Output routing to a separate device
(`setSinkId`) is day-one, not polish.

## Standing prohibitions
- **No CPT code descriptors anywhere.** CPT is AMA-proprietary. Codes render as opaque
  strings; descriptor text never ships.
- **No PHI.** The demo corpus is scripted TTS. This account has no BAA.
- **No transcription accuracy percentage** — not in the UI, the README, a tooltip, or
  the deck. Confidence renders as *state*: confirmed / unconfirmed / not captured.
- **No rep reputation scoring.** Attribute individuals because evidence requires it;
  aggregate only at the payer level.

## Domain model — the part most likely to be built wrong
Statements are append-only, keyed to a claim at capture time. The history *is* the
product; nothing is ever overwritten.

Five contradiction types, plus a sixth statement type that is **not** a contradiction:

**REFUSAL / non-answer.** The payer names a *category* without a *value* — "a diagnosis
code", "a coding issue", "an eligibility problem". This is recorded as a first-class
attributable row, never a blank field:

    REFUSAL · asked which diagnosis code · rep declined to specify
             · 14:32 · D. Reese 2210 · ref 8K2J-988

The absence is the evidence. Detecting category-without-value is also the cue for the
agent to prompt the biller to ask for the specific value while a person is still on
the line.

## Latency
Flag must land **under 2 s** from end of the payer's turn. Instrument it on day one and
display it on screen. Never fake it, never smooth it.

## Working style
- **One meaningful commit every day** through Sep 30. Commit spread is an explicitly
  evaluated item, and the log already has an unfixable four-day hole at the front.
- Conventional commits: `feat:` `fix:` `docs:` `chore:` `refactor:` `test:`.
- Build the **recorded-audio path first**. It is the required no-mic fallback, the test
  harness, and it keeps telephony off the critical path.
- Straight build, not multi-agent orchestration. Token efficiency is a stated priority.
- Verify before claiming done: typecheck, lint, tests, build, then actually run it and
  look at it. Never report a check that was not run.
