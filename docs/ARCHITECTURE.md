# Architecture

The prose companion to [`.repo-layout.yml`](../.repo-layout.yml). That file is the contract; this one explains why.

## The shape

Four tiers, one direction of dependency:

```
app  ->  services  ->  domain
 |
 v
 ui  <-  (data as props)
```

`domain` is the bottom and knows about nothing else. `app` is the top and is allowed to know about everything. Anything that reaches sideways or upward is a bug.

## What each directory is for

**`src/domain`** — the statement record, the claim ledger, the five contradiction types, and the rules that decide whether two statements conflict. Pure functions over plain data. No `fetch`, no React, no websockets, no environment variables. This is the part that must be trivially testable, because it is the part a judge's question will land on.

**`src/services`** — everything that touches the outside world. AssemblyAI clients, browser audio capture, storage. Services import from `domain`; `domain` never imports from services.

**`src/ui`** — React components. They receive data as props and render it. A component that fetches its own data is a component that cannot be tested or storyboarded, and the console is the thing judges look at longest.

**`src/app`** — routes and API handlers. Thin. If a route handler grows logic, that logic belongs in `domain` or `services`.

**`fixtures`** — the scripted demo corpus. Six to ten calls on one claim with a planted value conflict between calls 02 and 05, an existence denial on 06, and degraded variants of each. This doubles as the replay harness: the whole pipeline must be runnable from recorded audio with no microphone attached.

## Three decisions that are easy to get wrong

**1. The API key lives in exactly one place.**
`src/app/api/token/` reads `ASSEMBLYAI_API_KEY`. Nowhere else. The browser opens its own socket to AssemblyAI using a short-lived token minted there. Any client component that touches the key is a leaked key — a public repo and a public demo URL mean there is no "just for now."

**2. The agent never writes to the ledger.**
The Voice Agent LLM available on this account cannot call tools, and even if it could, we would not give it write access. The contradiction engine detects, our code writes, and the agent is handed a line to say via `reply.create` with one-shot instructions. Every evidence-bearing utterance — the contradiction flag, the readback prompt, the Close-Out — is **assembled from the statement record**, not composed by the model. The model supplies conversational glue only.

The reason is not distrust of the model. It is that the entire product claim is "you can play back the source." A sentence the model invented cannot be played back.

**3. Sessions are expensive and must be able to die.**
Billing is on websocket-open duration and an abandoned session bills three hours. Every session carries a hard timeout, and `Terminate` fires on every exit path — normal close, error, crash, page unload, tab close. This ships in the same commit as the socket code, never after.

Related: the account allows **5 new streams per minute** and one call opens two. Never auto-connect on page load or hot reload. Session start is an explicit user action.

## Standing prohibitions

These are not style preferences. Each one has a specific cost.

- **No CPT code descriptors anywhere in the repo.** CPT is AMA-proprietary. Codes may appear as opaque strings; the text that explains what a code means may not ship.
- **No protected health information.** The demo corpus is scripted TTS. The account has no BAA.
- **No accuracy percentage claims about transcription.** Not in the UI, not in the README, not in the video. The product's honesty argument collapses the moment it asserts a number it cannot defend.
- **The agent's audio never reaches the payer's line.** If agent TTS plays through the same headset whose mic feeds the call, the payer hears the coaching — a product-ending failure on a recorded line. Output routing to a separate device is a day-one requirement, not a polish item.

## Adding a file

1. Read `.repo-layout.yml`.
2. Ask what the file *is* — a rule, an adapter, a view, a test, a fixture — not which feature it serves.
3. Put it in the matching directory and mirror the path under `tests/`.
4. If nothing fits, stop and ask. A new top-level directory is an architecture decision and gets a line in this file first.

## Additions 2026-09-21

- `fixtures/scripts/` also holds the corpus tooling (`render-corpus.mjs`, `spike-voice-agent.mjs`). Tooling that only serves the fixtures lives with them; no new top-level directory.
- `src/app/console-host.tsx` is the ONE place the UI is bound to services. `src/ui` never imports `src/services`: it receives a `LiveDriver` as a prop.
- Two modes share one pipeline: `final Rep turn -> extractor -> ledger -> engine -> call plan -> speech assembly -> speak (Mode A) or whisper (Mode B)`.
- Vocabulary: Agent = the human user, Rep = the payer rep, Witness = the voice AI.

## Additions 2026-09-22

- `public/` — Next.js static assets, served at the site root. It holds exactly one file:
  `sample-ar-worklist.xlsx`, the synthetic AR export a judge downloads to try the import
  without owning a billing system. Generated by `fixtures/scripts/make-worklist.mjs`; that
  script is the source of truth, the .xlsx is its build output.
- `src/services/workbook-reader.ts` reads `.xlsx` and `.csv` **in the page, with no network
  call and no dependency**. An .xlsx is a ZIP of XML and the platform supplies both halves
  (`DecompressionStream('deflate-raw')` plus entity decoding), so the app still has three
  runtime dependencies. Two reasons, in order: a worklist is full of PHI and this project has
  no BAA, so the file must not leave the browser; and a public demo should not carry a large
  third-party parser through a licence audit.
- `src/domain/claim-import.ts` owns column mapping and `MAX_CLAIMS_PER_CALL`. The three-claim
  cap is an industry rule — payers allow three claim-status inquiries per representative on
  one call — so it lives in the domain where the UI cannot quietly exceed it.

## Decisions 2026-09-22: what we verified, and one API we refuse

Every field below was checked against the live Voice Agent server, not against the docs. That
distinction earned its keep: the published `voices` page describes `voice.voice_id`, the server
rejects it with `session.error: invalid_format`, and a rejected `session.update` does not fail
loudly - it silently runs the whole call on defaults. An empty system prompt, the stock voice,
and NO GREETING, which is where the AI disclosure lives. The real field is `output.voice`.

Verified accepted: `system_prompt`, `greeting`, `input.keyterms`, `input.transcription_prompt`,
`input.turn_detection`, `input.voice_focus`, `input.voice_focus_threshold`,
`input.continuous_partials`, `output.voice`. Audio both ways is base64 PCM16 mono at 24 kHz,
and `reply.audio` carries it in `data` (not `audio`).

`turn_detection.min_silence` is 1800 ms rather than the 1000 ms default for one reason: a rep
reading an identifier off a screen pauses inside it - "Eight-K-two-J... nine-eight-eight" - and
at the default that lands as two turns. The extractor would see `8K2J` and `988` as separate
alphanumeric runs and could file a reference number nobody spoke.

**LLM pinning is not possible inline.** The server answers "BYO LLM config is not allowed on
session.update; define it on a stored agent via POST /v1/agents". We send no `llm` key and take
the default, because no evidence-bearing sentence comes from the model: our code assembles those
from statement rows and the agent reads them verbatim.

### Why the Dictation API is not used on the Rep channel

AssemblyAI's Dictation API removes filler words, resolves self-corrections and reshapes output
through an `llm_instruction`. Their own example is "ship it tuesday no wait wednesday" becoming
"Ship it Wednesday."

Applied to a payer call, that is a defect rather than a feature. When a rep says

    "It denied for timely fil- sorry, no prior auth."

the Dictation API returns "It denied for no prior authorization" and silently discards the fact
that the rep first said timely filing. That discarded half IS the contradiction - the thing this
product exists to catch - and nothing would report that an edit had occurred.

The same holds for filler removal. Once a quote is cleaned up it is no longer a quote, and an
appeal packet that says "the representative stated" has to match audio a human can play back.

So the Rep's channel stays verbatim, deliberately. The Dictation API is a good fit for one place
we may use it later: the Agent's own spoken annotations ("Witness, flag that"), which are the
biller's notes and explicitly not payer statements.
