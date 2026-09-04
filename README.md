# The Witness

**Payer call memory.** A voice agent that rides along on the insurance call a medical biller is already making, captures what the payer said as a timestamped record, and speaks up mid-call the moment the payer contradicts something it said on an earlier call about the same claim.

> We don't predict what the payer will pay. We record what the payer said.

**Live demo:** _coming Week A_ · **Built on:** AssemblyAI Streaming STT v3 + Voice Agent API · **Submission:** AssemblyAI Voice Agent Hackathon, Sep 2026

---

## The problem

A biller spends **25 minutes and $13.80** on one phone call asking a payer why a claim was denied.<sup>[1]</sup> The answer is spoken, unrecorded on the provider's side, and gone the moment they hang up — compressed into a line of shorthand in a claim note. Three weeks later a different representative gives a different answer, and nothing in the revenue cycle notices.

The last federal measurement of payer call-center accuracy found representatives giving *inconsistent responses within the same call center*.<sup>[2]</sup> It was published in 2006. No modern measurement exists, because no instrument exists.

Meanwhile roughly 15% of claims are denied, **under 1%** of denied in-network ACA claims are ever appealed, and most appeals that are filed get overturned.<sup>[3]</sup> The gap between those numbers isn't merit. It's evidence: appealing means reconstructing what the payer actually said, and nobody can.

**The Witness creates that record while the call is happening.**

---

## Why this is an AssemblyAI problem specifically

The hardest thing in this product and the reason the agent has to *speak* are the same thing.

Spoken alphanumerics are a documented frontier failure — roughly a third of spoken phone numbers are missed even by the best models. Reference numbers *are* that problem. Two moves solve it, and both are AssemblyAI-shaped:

1. **Seed keyterms with the claim's own numbers** before the call starts, collapsing open-vocabulary transcription into candidate matching.
2. **When confidence lands below threshold, the agent speaks a readback prompt** instead of guessing — *"I heard eight-K-two-J-nine-one-five. Ask them to repeat it."*

Nothing else in the stack can be swapped out for this. The transcription difficulty is what creates the need for a voice agent.

---

## How it works

Two audio channels, two AssemblyAI sessions, one claim memory. The agent speaks **only** into the biller's private earpiece — never onto the payer's line.

```mermaid
flowchart LR
    subgraph Audio["Tier 1 · Audio in"]
        A["Channel A<br/>payer line<br/><i>listen-only</i>"]
        B["Channel B<br/>biller headset<br/><i>mic + private earpiece</i>"]
    end

    subgraph AAI["Tier 2 · AssemblyAI"]
        STT["Streaming STT v3<br/>universal-3-5-pro<br/><i>keyterms seeded from the claim</i>"]
        VA["Voice Agent API<br/><i>the coach — speaks here only</i>"]
    end

    subgraph Reason["Tier 3 · Reasoning (our code)"]
        EX["Statement extractor<br/><i>turn → typed record</i>"]
        LED[("Claim ledger<br/><i>append-only</i>")]
        CE{"Contradiction<br/>engine"}
    end

    subgraph Out["Tier 4 · Out"]
        UI["Evidence console"]
        PKT["Appeal packet<br/><i>quotes + timestamps + audio</i>"]
    end

    A --> STT --> EX --> LED
    LED --> CE
    EX --> CE
    CE -->|"reply.create"| VA --> B
    CE --> UI
    LED --> UI
    LED --> PKT

    style CE fill:#7a2d1e,stroke:#c6613f,color:#fff
    style LED fill:#1e3a5f,stroke:#4a7ab5,color:#fff
```

### The moment the product exists for

Same claim. Same representative. Forty-nine days apart.

```mermaid
sequenceDiagram
    participant P as Payer rep<br/>(D. Reese, 2210)
    participant W as The Witness
    participant L as Claim ledger
    participant B as Biller

    Note over L: Jul 08 — "Denied. No prior authorization on file."<br/>ref 8K2J-338, rep 2210

    P->>W: "This was denied for timely filing."
    W->>W: extract typed statement (~600ms)
    W->>L: diff against claim history (~50ms)
    L-->>W: conflict — denial reason changed
    W->>B: 🔊 "That contradicts July eighth.<br/>Same rep said no prior auth. Ask which one."
    Note over W,B: under 2 seconds from end of payer turn
    B->>P: "Which is it — timely filing or prior auth?"
    Note over W: both statements retained, both quotable,<br/>both with audio offsets
```

A large organisation being sloppy is shruggable. One person contradicting himself is not.

### What the agent is, and is not

The agent is a **mouth, not a hand.** Contradiction detection is deterministic and runs in our own code. The agent never writes to the ledger and never decides what is true — it is triggered by the engine and speaks a line assembled from the statement record.

This is a deliberate constraint, not a limitation we backed into: every evidence-bearing utterance can be traced to a row a human can play back.

---

## Quickstart

**Prerequisites:** Node 20+, an AssemblyAI API key, and Chrome (dual-channel browser audio capture is Chromium-only).

```bash
git clone https://github.com/<your-user>/the-witness.git
cd the-witness
npm install

cp .env.example .env      # then paste your key into .env
npm run dev
```

Open <http://localhost:3000>. You should see the holding console reading **SYSTEM READY · NO SESSION**.

> **Never auto-connect.** Sessions start on an explicit click. The account allows 5 new streams per minute and this app opens two per call — a hot-reload loop that reconnects on save will trip the limit and present as a connection bug.

### Configuration

| Variable | What it is | Required | Default |
|---|---|:--:|---|
| `ASSEMBLYAI_API_KEY` | Server-side only. Never sent to the browser — the client gets a short-lived token from `/api/token`. | ✅ | — |
| `ASSEMBLYAI_STT_MODEL` | Speech model, pinned explicitly. | ✅ | `universal-3-5-pro` |
| `ASSEMBLYAI_AGENT_LLM` | Agent LLM, pinned explicitly. Never rely on default resolution — the default may resolve to a model the account cannot reach, and it fails looking like a connection error. | ✅ | `qwen3.5-4b-fast` |
| `SESSION_MAX_SECONDS` | Hard ceiling per session. Billing is on socket-open duration, so every session must be able to kill itself. | ✅ | `900` |

---

## Project structure

```
src/app/          Next.js routes. Pages and API handlers only — no business logic.
  api/token/      Mints short-lived tokens. The only place the API key is read.
src/domain/       Pure rules: statements, claim ledger, contradiction types. No I/O.
src/services/     The outside world: AssemblyAI clients, audio capture, storage.
src/ui/           React components. Props in, pixels out. Never calls an API.
src/lib/          Small shared helpers with no domain meaning.
fixtures/         Scripted demo corpus — call scripts, audio, expected records.
docs/             Architecture, decisions, compliance notes.
tests/            Mirrors src/ path for path.
```

The rules are machine-readable in [`.repo-layout.yml`](.repo-layout.yml) and explained in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). **Read them before adding a file.**

---

## Status

| Area | State |
|---|---|
| Research and planning | ✅ Complete |
| Technical spikes | ✅ Both resolved — agent-initiated speech confirmed, audio capture path decided |
| Repo + deploy shell | 🔨 In progress |
| Dual AssemblyAI sessions | ⬜ Week A |
| Claim ledger + contradiction engine | ⬜ Week B |
| Two-timescale evidence console | ⬜ Week B |
| Close-Out + appeal packet | ⬜ Week C |

**Known constraints, stated up front:** Chrome-only (dual-channel capture is Chromium-only, and macOS needs 14.2+ with Chrome 141+). The demo corpus is scripted text-to-speech — **no protected health information touches this project.** No accuracy percentage is claimed anywhere, by policy.

---

## Sources

1. CAQH Index, 2024 — time and cost per phone claim-status transaction.
2. GAO-06-710 — 900 test calls; representatives gave inconsistent responses.
3. KFF analysis of ACA and Medicare Advantage appeal and overturn rates.

Legal framing for the appeal packet rests on the **US Department of Labor / EBSA Information Letter of June 14, 2021**, which holds that under 29 CFR 2560.503-1(h)(2)(iii) audio recordings and transcripts of conversations with plan representatives are relevant documents a plan must produce. The regulation assumed such records exist. For providers, they mostly do not. This creates them.

The Witness is leverage inside a payer's own internal appeal. It is not a litigation instrument.

## License

MIT — see [LICENSE](LICENSE).
