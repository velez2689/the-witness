# Project state — read this to get up to speed

## UPDATE 2026-09-21 — read this section first; it supersedes §2 and §11 below

**Vocabulary.** Agent = the person using The Witness. Rep = the payer rep. Witness = our voice AI. (Code: `operator` / `rep` / `witness`.)

**Two modes (§Modes).** Mode A: the Witness speaks to the Rep (one Voice Agent session on the Rep's audio; verbatim AI + recording disclosure; deterministic call plan; challenges contradictions on the recorded line). Mode B, Copilot: the Agent speaks, the Witness whispers. **Take Over** moves A to B mid-call. No telephony: the demo Rep is a scripted simulator or a person speaking into the mic ("Be the Rep"). Real dialing is roadmap.

**Freeze moved to Sep 26.** Submit Sep 29.

### What is built and verified (86 tests, typecheck, lint, production build)
- Domain: extractor (rules, final turns only), five contradiction kinds + refusals, call sessions, deterministic call plan, speech assembly with an alphanumeric self-check, capture gate, Mode A runner + Rep Simulator bank, Mode B whispers + Take Over resume, claim update sheet, appeal packet model, SHA-256 hash chain.
- Console (`/`): claim timeline, the link, flag lane, live-call edit view, capture sheet, hang-up gate, close-out, claim update sheet. Scripted Mode A/B run in the browser with no network.
- Packet (`/packet`): print-ready, member ID masked, per-statement citations, integrity verify, evidence JSON.
- Live path (built, **NOT yet exercised against the real API**): `/api/token`, `session-registry`, `voice-agent-session`, `live-call`, mic/audio IO. Covered by fake-socket tests only.

### Open, in priority order
1. Put `ASSEMBLYAI_API_KEY` in `.env` (it is EMPTY; the previous key was pasted in a chat, rotate it) and run `node --env-file=.env fixtures/scripts/spike-voice-agent.mjs`. Confirm: payload field names of `transcript.user` / `transcript.agent` / `reply.audio`, and how to pin `qwen3.5-4b-fast` (no LLM field is documented; the session currently sends none, so constraint 4 is unmet until this is known).
2. Add `ELEVENLABS_API_KEY`; write `fixtures/scripts/render-corpus.mjs` (see skill witness-replay-corpus). The scripted ▶ buttons use the browser voice until real audio exists.
3. Deploy and push (needs the owner's go-ahead): Vercel project exists; nothing pushed since Sep 4.
4. Not built yet: Payer Inconsistency Index, Judge Mode (`/judge`), Contradiction Autopsy scrubber, Wrong-Claim Guard, Ask-Next bank, Deadline Guard, Denial-Letter cross-check, deck/video/cover.
5. Streaming v3 second session for Mode B on live audio (Mode B is scripted-only today).

### Gotchas
- `.env` values are never printed. The token route is public: same-origin check, 60s single-use tokens, 300s session cap, per-IP rate limit (best effort on serverless).
- The self-check caught two real bugs (digits joined across sentences; close reason lost on synchronous socket close). Keep it running in tests.
- Numbers: the header shows hold time (computed) and per-call cost (calls × the CAQH $13.80 average) as separate figures; never multiply hold minutes by the 25-minute average.

---

Last updated **2026-09-04, end of day 4**. One file, everything that matters.
`CLAUDE.md` in the repo root holds the binding constraints; this holds the context
behind them.

---

## 1 · What we are building and why

**The Witness** — a voice agent that rides along on a live payer phone call a medical
biller is already making. It captures what the payer said as timestamped, quotable
statements; detects contradictions against prior calls on the same claim in real time;
**speaks** coaching into the biller's private earpiece mid-call; and emits an appeal
packet quoting the transcript with timestamps.

**Submission title:** "The Witness — payer call memory" (31 chars).
**Event:** AssemblyAI Voice Agent Hackathon on lablab.ai, Sep 1–30 2026.
**Deadline: Sep 30, 11:00 ET. Feature freeze Sep 23. Submit Sep 29.**

### The problem, in one paragraph
A biller spends 25 minutes and $13.80 on one call asking a payer why a claim was denied.
The answer is spoken, unrecorded on the provider's side, and gone the moment they hang
up. Weeks later a different rep gives a different answer and nothing notices. Roughly
19% of in-network claims are denied; under 1% of denied claims are ever appealed. The
gap isn't merit — it's evidence. Appealing means reconstructing what the payer actually
said, and nobody can.

### The line that settles most design arguments
**We don't predict what the payer will pay. We record what the payer said.**

Every claim the product makes traces to an utterance a human can play back. Nothing is
inferred, scored, or adjudicated. This is why the scope is defensible: predicting a
claim outcome would require modelling every payer policy and every patient's specific
plan — primary/secondary, effective and term dates, benefit coverage. Recording an
utterance requires none of that.

### Why it is an AssemblyAI problem specifically
AssemblyAI's documented frontier failure is spoken alphanumerics — roughly a third of
spoken phone numbers missed even by the best models. **Reference numbers are exactly
that problem.** Two moves solve it: seed keyterms with the claim's own numbers before
the call, collapsing open-vocabulary transcription into candidate matching; and when
confidence lands low, **the agent speaks a readback prompt instead of guessing.**

**The reason the agent must speak and the reason the task is hard are the same reason.**
That is the strongest thing in the pitch.

---

## 2 · Where things stand

| Workstream | State |
|---|---|
| Research (3 passes, ~60 ideas) | **Closed.** The Witness scored 23/25. Do not reopen. |
| Planning | **Closed.** `13-project-plan.md` in the parent `files/` folder. |
| Both day-1 technical spikes | **Resolved.** Nothing blocks the architecture. |
| UI direction | **Settled** — the two-timescale audio console. |
| Account | **Live.** $150 credits. Constraints documented below. |
| Repo | **Public**, 3 commits, structure contract in place. |
| Live URL | **Deployed and publicly reachable.** |
| Demo corpus | **Scripted.** `fixtures/scripts/claim-A-4471-08.md`. Audio not yet recorded. |
| Product code | **None yet.** This is where you come in. |

**Repo:** https://github.com/velez2689/the-witness
**Live:** https://the-witness-qynnmygc0-chris-velezs-projects.vercel.app

---

## 3 · Architecture

Two channels, two AssemblyAI sessions, one claim memory.

- **Channel A — payer line.** Listen-only, never hears the agent. → **Streaming STT v3**
  (`wss://streaming.assemblyai.com/v3/ws`, `universal-3-5-pro`), keyterms seeded with
  this claim's own numbers plus CARC/RARC vocabulary.
- **Channel B — biller headset** (mic + private earpiece). The agent speaks here and
  only here. → **Voice Agent API** (`wss://agents.assemblyai.com/v1/ws`), LLM pinned to
  `qwen3.5-4b-fast`.
- **Statement extractor** — each finalized payer turn becomes zero or more typed
  statement records with verbatim span, ms offsets into retained audio, and confidence.
- **Claim memory** — append-only statement log keyed by claim. Never overwritten.
  **The history IS the product.**
- **Contradiction engine** — every new statement diffed against the claim's full
  history. **Flag within 2 s of end-of-turn or not at all.**

### Verified protocol facts (spiked, do not re-derive)
- `reply.create` — "ask the agent to generate a reply right now, optionally with
  one-shot instructions." **This is how the contradiction engine drives the agent.**
  It does not need to have heard the biller first.
- `greeting` is spoken verbatim and never runs through the LLM — that is the
  recording-consent line — but it is **immutable after `session.ready`**, so it must be
  set in the first `session.update`.
- `system_prompt` **can** be updated mid-session, so claim history can be pushed in as
  the ledger grows.
- `getDisplayMedia({audio:true})` is **Chromium only.** Firefox and Safari not at all.
  Windows/ChromeOS fine; macOS needs Chrome 141+ and macOS 14.2+. **Ship Chrome-only
  and say so on the page.**
- Streaming v2 returns HTTP 410. Live diarization is beta — **separate session per
  channel, never diarization,** for speaker identity.

### Stack — decided, do not reopen
**One Next.js app on Vercel, TypeScript, App Router.** The browser connects directly to
AssemblyAI using short-lived tokens minted by `src/app/api/token/`; the API key never
reaches the client and there is no long-lived server socket.

Rejected: a separate Node relay service, and a Python FastAPI backend. Reasoning — the
stack scores zero rubric points, two deploys means two things that can be broken when a
judge clicks, and one app is materially cheaper to build and debug.

---

## 4 · Account limits — verified on the dashboard, and they bind

- **$150 in credits** (not the $50 the plan originally assumed).
- Plan is **"Free offering."** Includes **333 hours of realtime audio**, 185 hours
  pre-recorded.
- **The LLM Gateway IS available** — an earlier plan claim that it was excluded from
  free accounts was **wrong**. No separate LLM key is needed.
- **But only `qwen3.5-4b-fast` is reachable**, and it **does not support tool calling.**
- **Max 5 new streams per minute.** We open two per call.
- **No BAA.** No PHI, ever. Demo corpus is scripted TTS.

### What those force
1. **Nothing may depend on JSON-schema tool calling through the Gateway.** The plan
   originally specified "tool calling into claim memory" — that was corrected.
2. **The agent never writes to the ledger. Our code owns every write.** The agent is a
   mouth, not a hand.
3. **Evidence-bearing speech is assembled from statement rows by our code**, not
   composed by the model. The contradiction flag, the readback prompt and the Close-Out
   all render from the record. The 4B model supplies conversational glue only. The
   reason is not distrust — it is that the entire product claim is "you can play back
   the source," and a sentence the model invented cannot be played back.
4. **Never auto-connect.** Session start is an explicit control. A hot-reload loop that
   reconnects both sockets on save will exhaust the 5/minute limit and present as a
   connection bug you will lose an afternoon to.
5. **Guaranteed `Terminate` ships in the same commit as the socket code.** Billing is on
   websocket-open duration; an abandoned session bills three hours.

---

## 5 · The domain model

Statements are **append-only**, keyed to a claim **at capture time** — that is what kills
cross-contamination, where call 3's reference number gets filed under patient 2.

Five contradiction types, plus a sixth statement type that is **not** a contradiction:

**REFUSAL / non-answer.** The payer names a *category* without a *value*:
"a diagnosis code", "a coding issue", "an eligibility problem". Recorded as a
first-class attributable row, never a blank field:

    REFUSAL · asked which diagnosis code · rep declined to specify
             · 14:32 · D. Reese 2210 · ref 8K2J-988

This came from Chris's own denial-management work and **was missing from the model
entirely.** By his account the non-answer is more common and harder to fight than the
contradiction, because there is nothing to quote. The absence becomes the evidence.

Detecting category-without-value is also the cue for the agent to prompt the biller to
ask for the specific value **while a person is still on the line** — same shape as the
reference-number readback.

**Possible legal hook, NOT YET VERIFIED:** 29 CFR 2560.503-1(g) appears to require an
adverse benefit determination to state the *specific* reason for denial. If that holds,
a recorded refusal is evidence the plan did not meet its notice obligation. **Pull the
regulation text before this goes anywhere near the deck. Nobody here is a lawyer.**

### The three real failure patterns (from Chris, who does this for a living)
1. **The reason mutates.** Denied for reason A; call again; now it's timely filing.
   Sharpest when the payer's own earlier instruction ran out the clock — call 01 says
   "in process, allow thirty days," call 05 says "denied for timely filing." The
   recording doesn't just show a contradiction, it shows the payer caused the denial.
2. **Status flips with no reason.** "It's processing" → call back → denied, and the rep
   doesn't know why or won't say.
3. **The refusal.** "It's the diagnosis code." Which one? They won't tell you.

---

## 6 · The UI — the two-timescale audio console

The product is voice and the evidence is audio, so the interface is built on the shape
of the sound. Five horizontal bands:

1. **Transport bar** — timecode, claim/payer identity, record state, flag latency,
   statement count.
2. **Claim timeline (arrangement view)** — the claim's whole life on a **date axis**.
   Each prior call a block positioned by date, sized by duration, with **hold time drawn
   to scale** along its bottom edge. This is an ATC strip bay flattened onto time.
3. **The link — this is the invention.** A dashed connector from the earlier call's
   block *down* into the flagged region of the live call, labelled `same rep · 49 days ·
   two answers`. **The contradiction drawn as a link between two timescales, which is
   literally what the product detects.** If you build one thing well, build this. It is
   the screenshot.
4. **Call timeline (edit view)** — two waveform tracks, hold regions shaded with
   durations, a marker at every capture, the contradiction as a **selected region**.
5. **Three unequal lower panels** — contradiction inspector with ▶ on every quote; the
   **CMS-1500 capture sheet inset on paper** inside the dark console with real box
   numbering; the before-you-hang-up gate as an *exit condition*.

**No other tool in this space shows a claim as a duration.** They all show it as a row
in a table. That is the design thesis; don't trade it for a dashboard.

**A working animated mock exists** — published as a Claude Artifact, "The Witness
Console." It plays the Aug 26 call in ~50 s with the link drawing, all three flags, the
readback, and the spoken Close-Out. Ask Chris for the link; use it as the visual
reference.

### Rules that survive from the design work
- **Never render a confidence percentage.** Confidence is *state*: captured & confirmed
  / captured & unconfirmed / not captured. Not-captured shows the label in flag colour
  with an empty slot — **absence as loud as presence.**
- **Spoken evidence is serif italic in quotes.** Everything the payer said is visually
  distinct from everything the system says about it.
- **Identifiers are monospace, tabular-nums.**
- **Latency on screen, permanently.** Never faked, never smoothed.
- **Primary-source rule:** for every significant visual decision, you must be able to
  name the real artifact it came from. An earlier design pass was rejected as
  AI-looking — it was the same wireframe in three palettes, with rounded cards
  everywhere, uppercase letterspaced mono micro-labels, and RAG status pills. Don't
  regenerate it.

---

## 7 · The demo corpus

`fixtures/scripts/claim-A-4471-08.md` — six calls on one claim, full dialogue ready for
TTS, with extraction targets and firing flags marked per call.

| # | Date | Rep | Ref | What matters |
|---|---|---|---|---|
| 01 | Jun 03 | M. Alvarez 4471 | 8K2J-114 | "in process, allow thirty days" |
| 02 | Jul 08 | D. Reese 2210 | 8K2J-338 | "no prior authorization" — **statement A** |
| 03 | Jul 22 | *none* | *none* | refusal ×3 + capture gap. 25 min proving nothing |
| 04 | Aug 05 | T. Okafor 5182 | 8K2J-702 | "reprocessed Jul 30" |
| 05 | Aug 14 | S. Whitfield 3390 | 8K2J-915 | "timely filing" — **statement B** |
| 06 | Aug 26 | D. Reese 2210 | 8K2J-988 | **the live call** — 3 flags |

**Jul 08 → Aug 26 is 49 days. Same rep, badge 2210, two different answers.** A large
organisation being sloppy is shruggable; one person contradicting himself is not.

Call 06 fires: value conflict against Reese's own July 8 statement; existence denial
("no record of a call on August fifth" — contradicted by the payer's own reference
number); and a refusal (names a diagnosis issue, won't specify). Then the readback under
degraded audio, then the Close-Out.

**Build the recorded-audio path first.** It is the required no-mic fallback, the test
harness, and it keeps telephony off the critical path.

---

## 8 · How this is judged

Three of the four criteria are about **packaging**, not engineering. Domain correctness
is scored nowhere.

- **Application of Technology** is largely an artifact checklist: demo video shows all
  features, demo link works, GitHub present and well thought out. Repo and live URL are
  done — that moved us from a 1 to a 3 today.
- **Presentation** needs the video **at least 3:00 and strictly under 5:00** (cut to
  ~4:40), plus market analysis, revenue model and roadmap. A **competitive-analysis
  slide is required for a 5** and is not yet drafted.
- **Business Value** is our exposed criterion. Band 2 is literally "niche market with
  limited demand," which is how "billers on hold with insurers" reads to a generalist
  judge. Frame the market as the full denial-chasing spend, never as the phone call.
- **Originality** is our strongest. Cross-call payer memory sits at a 4, arguably 5.

**There are no tracks.** They were removed from the event page entirely.

---

## 9 · Numbers — verified against primary sources 2026-09-04

**Never claim a transcription accuracy percentage.**

- **25 min / $13.80** per manual phone claim-status inquiry — 2024 CAQH Index, **2023
  data year**. Cite it with that vintage. CAQH is now **DataSpring**; the current
  figure sits behind free registration at index.dataspring.com and should be pulled
  before the deck ships.
- **TAM trap:** of 2.82B annual claim-status inquiries only **2% are fully manual** (18%
  is *partially* electronic, not phone). Use CAQH's published **$2.4B** medical savings
  opportunity, never a reconstructed volume × price.
- **$25.7B** provider claims-adjudication cost, +23% YoY; **$57.23** admin cost per
  denied claim; ~15% initial denial rate — Premier, Feb 2025.
- **19%** of in-network claims denied, range 3%–36% by issuer; ~85M denied claims;
  **under 1% appealed**; insurers **upheld 66%** of internal appeals — KFF, Mar 2026.
- **73% of providers cite unclear denial reasons or underpayments** — HFMA/Guidehouse,
  Apr 2026. Closest current quantification of our exact problem.
- **90% of denied claims require human review before resubmission** — Experian State of
  Claims 2025.
- **No modern measurement of payer rep accuracy exists.** Eight search angles, nothing
  in five years on provider lines. CMS still runs an annual CSR accuracy study —
  beneficiary lines only, results unpublished, provider lines untested. **That absence
  is a checkable claim and it is stronger than the stale statistic it replaces.**
- Closest modern proxy: **JAMA Network Open, Apr 2025** mystery-shopper study — 40.0%
  accurate and complete, **26.1% on verifying physician network participation**. SHIP
  counsellors, not payers — cite as adjacent only.
- **Legal framing: US DOL/EBSA Information Letter, June 14 2021** — under 29 CFR
  2560.503-1(h)(2)(iii), audio recordings and transcripts of conversations with plan
  representatives are relevant documents a plan must produce. The regulation assumed
  such records exist; for providers they mostly do not. **This creates them.** Lead with
  this. Never frame as litigation — it is leverage inside the payer's own internal
  appeal.

**Retired, do not let them creep back:** $19.7B/AHA · $181 per claim · "60% never
resubmitted" · a blanket "75% overturned" · AKASA's 2023 survey.

---

## 10 · Ethics line — decided, and it goes in the roadmap slide

The console names the representative repeatedly, and it must: a statement without an
attributable speaker is not citable, and "the same representative said both things" is
the demo's strongest fact.

**But rep-level reputation scoring must not be built.** Ranking individual call-centre
workers by contradiction rate is trivially easy from the same data, is a surveillance
product wearing an evidence product's clothes, and hands the payer a clean
counterargument.

**Attribute at the individual level because evidence requires it; aggregate only at the
payer level.**

---

## 11 · What's next

**Immediate (Week A, Sep 5–10):**
1. Domain types — statement record, claim ledger, contradiction types, **the refusal
   type**. Pure, tested, no I/O.
2. Both sessions wired against **recorded audio**, models pinned, keyterms seeded.
3. **Hard timeout + guaranteed `Terminate`, same commit as the sockets.**
4. Replay harness — full path with no microphone.
5. Latency instrumented and displayed.

**Week B (Sep 11–16):** claim memory, contradiction engine (types 1–2 first), the
two-timescale console, readback loop, hold detection, commitment clock.

**Week C (Sep 17–23):** the Close-Out, appeal packet + audio snippet, demo corpus audio,
no-mic path, before-you-hang-up gate. **Freeze Sep 23.**

**Sep 24–28:** polish, deck, cover image, record video (three practice runs on the
clock), submission copy, license audit, live URL tested in fresh incognito.
**Sep 29: submit.**

### Open, non-code
- Discord not yet connected to the lablab profile.
- API key rotation — the original was pasted into a chat.
- Hold durations filled in for calls 03 and 06 only; must sum to the 1 h 41 m header.
- 29 CFR 2560.503-1(g) unverified.
- DataSpring registration for the current claim-status figure.
- TAM inputs · competitive-analysis slide · rep-identity sign-off · Outbound.ai (the one
  competitor gap three research passes didn't close).

---

## 12 · Working agreements
- **One meaningful commit every day** through Sep 30. Commit spread is explicitly
  evaluated and the log already has an unfixable four-day hole at the front (Sep 1–4).
- Conventional commits. Read `.repo-layout.yml` before creating any file; if nothing
  fits, **stop and ask** rather than inventing a directory.
- Straight build, not multi-agent orchestration. Token efficiency is a stated priority.
- Verify by actually running it. **Never report a check that was not run.**
- Git note: the folder bridge from the Cowork side cannot run git — it can't delete lock
  files. Chris runs git himself in PowerShell.
