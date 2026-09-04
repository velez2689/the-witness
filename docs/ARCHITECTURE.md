# Architecture

The prose companion to [`.repo-layout.yml`](../.repo-layout.yml). That file is the contract; this one explains why.

## The shape

Four tiers, one direction of dependency:

```
app  →  services  →  domain
 ↓
 ui  ←  (data as props)
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
