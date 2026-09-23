# CLAUDE.md — The Witness

Read this before writing any code. It is short on purpose; every line is here because
getting it wrong costs days.

## What this is
A voice agent that rides along on a live payer phone call a medical biller is already
making. It captures what the payer said as timestamped, quotable statements; detects
contradictions against prior calls on the same claim in real time; **speaks** coaching
into the biller's private earpiece mid-call; and emits an appeal packet quoting the
transcript with timestamps.

Deadline: **Sep 30 2026, 11:00 ET.** Feature freeze moved to **Sep 26** (re-baselined Sep 21).

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

**1 · The agent never calls tools — by choice, not by limitation.**
The Voice Agent API *does* support tools: the session config carries a `tools` array and
the server emits `tool.call` / `tool.result` (verified live, Sep 22). We do not use them.
A tool is a hand, and a hand can write to the ledger. Everything the agent says is driven
from our contradiction engine via `reply.create` with one-shot instructions, so the model
can never decide what is true. State this as a deliberate refusal, never as "we couldn't" —
a judge who knows the API will know the difference.

**2 · The agent never writes to the claim ledger.**
Our code owns every write. The agent is a mouth, not a hand.

**3 · Evidence-bearing speech is assembled, not generated.**
The contradiction flag, the readback prompt and the Close-Out are built by our code
from statement rows. The model supplies conversational glue only. A 4B model will
occasionally phrase things oddly; that must never touch a quoted fact.

**4 · Send NO `llm` key on `session.update`.**
Verified live Sep 22: the server answers *"BYO LLM config is not allowed on session.update;
define it on a stored agent via POST /v1/agents"*, and any `llm` key — even a well-formed
one — gets the whole `session.update` rejected. A rejected update does not fail loudly: the
call proceeds on defaults, **greeting included**, so the AI disclosure silently goes unsaid.
Taking the default model is safe here precisely because constraint 3 holds — no
evidence-bearing sentence comes from the model. Never add a field to `session.update`
without spiking it first; the failure mode is silence, not an error.

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

**8 · Speaker identity is structural, never diarization.**
Live diarization is beta. Two modes (see `docs/PROJECT-STATE.md` §Modes):
- **Mode A — Witness speaks:** ONE Voice Agent session whose input is the Rep's audio
  only; transcript.user is always the Rep, transcript.agent is always the Witness.
- **Mode B — Copilot:** Rep audio -> Streaming v3 (listen-only, keyterms seeded);
  Agent mic -> Voice Agent session. One session per channel.

**9 · Audio routing is explicit per mode.**
Mode B: the Witness's audio must never reach the Rep's line — route to a separate
output (`setSinkId`); product-ending on a recorded line otherwise. Mode A: the Witness
speaks to the Rep by design, so its greeting is verbatim, discloses that it is an AI
assistant calling for the provider's billing office, and states the call is recorded.
It never claims to be human and only shares facts in the Call Brief.

**Vocabulary.** *Agent* = the human using The Witness. *Rep* = the payer rep.
In code: `operator` / `rep` / `witness` (avoids clashing with AssemblyAI "agent").

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
