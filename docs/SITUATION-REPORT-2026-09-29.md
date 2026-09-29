# The Witness — Situation Report (for a second model to plan from)

Written 2026-09-29 by Claude (Sonnet 5.5) at the owner's request. Purpose: give another model enough detail to understand exactly where the project stands, what has been tried, what is proven, what is NOT proven, and to plan a way out.

> **Reading this from the repo (e.g. a cloud session)?** Everything needed is in this repo except three things kept outside it: the saved call recordings and timelines (`Items to show claude/`, gitignored; the numbers you need are quoted in §6), `.ai/decisions.md` and `.ai/handoff.md` (their substance is summarised here and in `docs/PROJECT-STATE.md`), and the throwaway test scripts from §7b (`trace-greeting.mjs`, `live-test.mjs`; described in enough detail to rewrite). Also read `CLAUDE.md`, `.repo-layout.yml` and the files listed in §10. Nothing in this repo contains secrets; the AssemblyAI key is in a local `.env` only.

**Deadline: 2026-09-30 11:00 ET** (lablab.ai / AssemblyAI Voice Agent Hackathon). Roughly one day from writing.

**One-paragraph state of things.** The domain logic (statement extraction, contradiction engine, claim ledger, call plan, appeal packet) is built and covered by 195 passing tests. The LIVE voice call — the part a judge would experience as "the product" — has never completed a clean call. Over 2026-09-23 to 2026-09-25 five distinct audio defects were found and fixed one after another, each one hiding the next. The most recent two fixes were committed AFTER the last recorded test call, so **there is no recording of a call on the current build**. The owner reports the calls "aren't working". Whether the current build works is unknown. **All five mandatory contest artifacts (video, deck, cover, short and long description) are still at zero.**

---

## 1. What the product is

A voice agent that makes (or rides along on) a phone call to a health-insurance payer about a medical claim, captures what the payer rep says as timestamped quotable statements in an append-only ledger, detects contradictions against earlier calls on the same claim, and produces an appeal packet quoting the transcript.

Design line: **"We don't predict what the payer will pay. We record what the payer said."**

Vocabulary: **Agent** = the human using the tool. **Rep** = the payer's representative. **Witness** = our voice AI. (In code: `operator` / `rep` / `witness`.)

Two modes:
- **Mode A — the Witness speaks to the Rep.** It opens by disclosing it is an AI assistant calling for the provider's billing office and that the call is recorded, asks for the rep's name and badge number, then works through a deterministic call plan (verify identity, challenge contradictions against prior calls, ask for denial reason, ask for a call reference number, read the reference back, close). This is the mode being tested live.
- **Mode B — Whisper mode.** The human Agent speaks; the Witness whispers into their earpiece. Currently scripted-only, not live.

There are no phone lines. In the demo the "Rep" is either a scripted Rep Simulator or a person talking into the laptop microphone ("Be the Rep"). Real phone lines are out of scope.

Stack: Next.js (App Router, a newer version with breaking changes), React 19, TypeScript, vitest. Hosted on Vercel. Repo: github.com/velez2689/the-witness (public). Live: https://the-witness-omega.vercel.app. Local repo: `C:\JarvisLite\Projects\TheWitness\the-witness`.

External services: AssemblyAI **Voice Agent API** (`wss://agents.assemblyai.com/v1/ws`) and **Streaming STT v3** (`wss://streaming.assemblyai.com/v3/ws`). ElevenLabs was planned for a pre-rendered demo corpus but its key was never added (see §7).

---

## 2. Hard architectural rules (from CLAUDE.md — do not break without the owner)

1. The model never calls tools. (Refused by choice: a tool is a hand that could write to the ledger.)
2. The model never writes the ledger. Our code owns every write.
3. Evidence-bearing speech (contradiction challenges, read-backs, close-out) is ASSEMBLED by our code from ledger rows. The model supplies no facts.
4. Send NO `llm` key on `session.update` — the server rejects the whole update and the call silently runs on defaults with NO greeting (so the AI disclosure goes unsaid).
5. Every exit path must terminate every socket (billing is per open-duration).
6. Never auto-connect a websocket. Account limit: **5 new streams per minute**, and one call opens two.
7. API key lives only in `src/app/api/token/`; the browser gets short-lived single-use tokens.
8. Speaker identity is structural (which socket carried the audio), never diarization.
9. Audio routing explicit per mode.

Standing prohibitions: no CPT descriptors, no PHI, no transcription accuracy percentages anywhere, no rep reputation scoring.

Repo layout contract is `.repo-layout.yml`: `src/domain` is pure (no I/O), `src/services` touches the outside world, `src/ui` never imports services, `tests/` mirrors `src/`. Do not add files to the repo root.

---

## 3. What is built (and what verifies it)

Verified this session: `npx vitest run` → **195 tests passed** (20s). NOT re-run this session: typecheck, lint, production build (the handoff says green at commit `0ac36ef`; I have not independently confirmed).

Domain (`src/domain`): `extractor`, `contradiction` (five kinds + refusals), `engine`, `claim-ledger` (append-only, read-back confirmations are new rows with `confirms=<id>`), `integrity` (SHA-256 hash chain, derived not stored), `call-plan`, `call-session`, `call-roster` (multi-patient calls, wrong-patient quarantine), `speech` (assembly of every spoken line + `checkSpeech` self-check that any alphanumeric spoken exists in the record), `mode-a`, `mode-b`, `packet`, `claim-import` (Excel AR worklist import), `capture-gate`, `claim-update`, `call-brief`, `script*`.

Services (`src/services`): `voice-agent-session.ts` (391 lines), `streaming-session.ts` (160), `live-call.ts` (294, the Mode A orchestrator), `audio-io.ts` (303, mic capture + gapless playback), `call-recorder.ts` (161), `session-registry.ts`, `workbook-reader.ts`, `worklist-store.ts`.

UI (`src/ui`): the evidence console (claim timeline, contradiction link, flag lane, capture sheet, roster band, hang-up gate), `/packet` print view, claim import.

Fixtures: `fixtures/scripts/claim-A-4471-08.md` (six-call demo claim, the test data), `rep-bank-call-06.ts` (Rep Simulator lines), `roster-batch.ts`, `spike-voice-agent.mjs` (live API probe; needs `ASSEMBLYAI_API_KEY` in `.env`).

Multi-patient handling, wrong-claim quarantine, first-call vs follow-up openings, packet with masked member ID: built and unit-tested. None of this is the problem.

---

## 4. The live-call path — how it works now (Mode A, two sockets)

`LiveCall.start()` (explicit user click):
1. Mint two single-use tokens (`agent` and `stt`) from `/api/token`.
2. Open the **Voice Agent socket**. It is used as a MOUTH ONLY: no audio is ever sent to it. Its `greeting` (the AI + recording disclosure) is spoken verbatim by the server on `session.ready`. Our assembled lines are spoken through `reply.create`-style `say()`.
3. On `onReady`: record the greeting in the ledger session, open the **Streaming STT v3 socket**, then start the microphone (`startMic`, 24 kHz PCM16, 50 ms chunks, browser echo cancellation + noise suppression + AGC). Mic chunks go to the STT socket as raw binary frames — **unless `isSpeaking()` is true, in which case they are dropped** (the "mic gate").
4. STT finalized turns → `onRepTurn` → extractor → ledger → engine → `nextMove` from the plan → `voice.say(line)`.
5. Barge-in is ours: an STT *partial* while `isSpeaking()` and `isRealInterruption(text)` (≥2 words, at least one not a back-channel) → `stopAudio()` flushes playback.
6. Playback (`PcmPlayer` in `audio-io.ts`): an AudioWorklet ring buffer (30 s), 120 ms pre-buffer, outputs silence and re-arms on under-run. `isSpeaking()` = `ctx.currentTime < speakingUntil + 0.4s`, where `speakingUntil` accumulates each chunk's playback END time.
7. `closeWhenSilent()` polls `isSpeaking()` (250 ms steps, 15 s cap) before hanging up after a closing move.
8. `CallRecorder` saves, per call, `witness-<ts>.wav`, `rep-<ts>.wav` and `call-<ts>.json` (event timeline). The mic is teed BEFORE the gate so the rep WAV shows what was heard, not what was sent.

Facts learned about the AssemblyAI APIs (verified against the live server, not docs — the docs are wrong in places):
- Voice Agent field shapes: `output.voice`, `input.keyterms`, `input.transcription_prompt`, `input.turn_detection`, `input.voice_focus(_threshold)`, `input.continuous_partials`. `reply.audio` carries base64 PCM16 in `data`. The docs' `voice.voice_id` is rejected.
- **A rejected `session.update` does not error.** The call runs on defaults and the greeting is silently dropped.
- The Voice Agent **answers every finalized user turn with its own LLM and there is no setting to disable it.**
- Output config is `{voice, format, volume}` only. No rate/pitch/SSML. Punctuation is the only prosody lever (measured: semicolon +32% slower, dash −22%, period/double-comma ≈ no change).
- Streaming v3 takes raw binary PCM frames + query-param config. The Voice Agent takes base64 in JSON + `session.update`. Not symmetrical.
- Dictation API rejected for the Rep channel (it removes fillers/self-corrections, discarding the contradictions the product exists to catch).
- `turn_detection.min_silence` set to 1800 ms so reading an identifier with pauses isn't split into two turns.
- The server sends audio far faster than real time (a 10 s greeting lands in ~3 s).

---

## 5. Chronology of the audio problem (the whole story)

The owner tested by making real calls in Chrome while "being the Rep". Symptoms reported across sessions, all described as some form of "the Witness cuts itself off / sounds robotic / sounds like a bad connection / repeats questions I already answered". Each was traced to a different cause:

| # | When (commit) | Symptom | Diagnosed cause | Fix |
|---|---|---|---|---|
| 1 | 09-25 `eacefb2` | Voice shredded, robotic, gaps inside words | Playback gave each ~50 ms chunk its own AudioBufferSourceNode scheduled 20 ms ahead — less than network jitter, so the queue ran dry mid-word | One gapless AudioWorklet ring buffer, 120 ms jitter buffer |
| 2 | 09-25 `619df40` | Two voices at once ("what is the denial reason…" over "thank you, what is your last name?"); AI "repeating questions" | Voice Agent LLM answers every user turn on its own; our assembled line and its chatter played simultaneously | Every reply "owned": ones we asked for play, ones the server volunteered are dropped before the speaker |
| 3 | 09-25 `1a3d149` | Median 3.2 s (worst 8.6 s) dead air before each line | Single socket doing both jobs: our line had to queue behind the unheard model turn | Split Mode A across TWO sockets: Rep audio → Streaming STT v3; Voice Agent is a pure mouth. Spiked at 409 ms, zero unsolicited replies |
| 4 | 09-25 `586db95` | Greeting truncated (2.34 s of a ~10 s greeting in three fragments), next line never plays | `isSpeaking` answered from when audio ARRIVED, not when it finishes playing; mic gate opened mid-greeting; mic heard the Witness through speakers; our own barge-in flushed the rest | `isSpeaking` accumulates playback end time; barge-in requires ≥2 non-back-channel words |
| 5 | 09-25 `5590bfa`, `32a1873` | Closing line cut off; call ended silently when the close move had `line: null` | Hung up on `reply.done` (server finished SENDING, not playing); close move carried no line | `closeWhenSilent()`; no move may hang up silently |
| — | 09-26 `0ac36ef` | (feature) | — | First-call vs follow-up approach derived from ledger |

Commit times: `1a3d149` 17:05, `586db95` 17:34, `0ac36ef` 01:09 next morning (all 2026-09-25/26 local).

Also shipped: identifiers spoken with semicolons, duplicate React key fix, AudioContext double-close rejection fix, in-browser call recording.

---

## 6. THE EVIDENCE — every saved call, exactly what it shows

All files are in `the-witness\Items to show claude\` (gitignored — a `git add -A` once swept the screen recordings in and GitHub rejected the push at 144 MB). Timelines are `call-*.json`, `atMs` from call start.

| Call (local time 09-25) | Build | Witness audio / Rep audio | What happened |
|---|---|---|---|
| 20:24:56 (16:24) | pre-split, after fix 2 | 66 s / 150 s | **Ran to plan-complete.** Greeting played 4.0→11.4 s (≈7.4 s, i.e. complete). All 8 plan moves fired (identify, verify, challenge, probe, ask remit reason, ask reference number, readback, alert_agent). Some short fragmentary plays (0.2–0.8 s) around 72–73 s. The Witness even asked identify with "Sorry, you cut out there for a second" after a one-word rep turn ("Darnell."). Closing line began 146 s, call stopped 153.9 s. |
| 20:30:07 (16:30) | pre-split | 76 s / 208 s | **Ran to plan-complete** but with a 32 s hole at 143.9→175.9 s: the readback was issued at 143.9 s and again at 175.9 s (after rep said "Can you help with anything else?"). Recap started 198.7 s, session ended 210.5 s (cut mid-sentence — the defect fixed by `closeWhenSilent`). |
| 21:26:01 (17:26) | **post-split, PRE mic-gate fix** | **1.9 s** / 15.3 s | **Failed.** Greeting issued at 1.4 s, first audio 5.5 s, idle at 6.5 s (1 s of audio). Fragments at 10.6, 11.0, 11.5 s (0.2–0.5 s each). Greeting never completed. No rep turn ever recognised. |
| 21:29:34 (17:29) | **post-split, PRE mic-gate fix** | **2.34 s** / 29.3 s | **Failed.** Greeting issued 1.0 s, audio 2.3→3.8 s (1.6 s), then fragments at 5.5 s (0.3 s) and 5.9 s (0.5 s). Rep said "Can you hear me?" at 14.9 s → Witness fell to `identify: "Sorry, you cut out there for a second - could I just get your name and badge number?"` but no playback is logged. User stopped at 31.6 s. |

Other files there: `Scenarios 8 (test1/2/3).mp4` (35/151/134 MB screen recordings, 09-25 14:32–15:57) and `Recording 2026-09-23 052700.mp4`. **I did not review these mp4s in this session**; per the handoff a screen recorder itself corrupts the test (it contended for the audio device and delayed the greeting 81 s, and it mixes both speakers into one track). Also 3 screenshots in `Seen by Claude/` and `witness-2026-09-25T20-23-57.wav` (3.2 MB, no matching JSON — an aborted call).

### The key observation
The **only two post-split recordings both show a truncated greeting**. The **two pre-split recordings both completed the full plan.** So the split (`1a3d149`) coincides with the regression; the mic-gate fix (`586db95`) was written specifically for it — but was committed 5 minutes after the last saved failing call. **No recording exists for `586db95` or `0ac36ef`.** The handoff states this plainly: "NOTHING since 586db95 has been confirmed by a real call."

Note also: the greeting's `witness-line` fires at ~1 s but first audio arrives 1–4 s later (call 20:24: 3 s; 21:26: 4 s; 20:30: 0.3 s). Variable first-audio latency on the greeting is unexplained.

---

## 7. What has NOT been done / is unknown

Unknown right now (I did not check these; the next step should):
- **Is https://the-witness-omega.vercel.app actually serving commit `0ac36ef`?** (Handoff says pushed and Vercel auto-deploys from `main`; not verified this session. If the owner is testing a stale deployment the test results mean nothing for the current code.)
- Does the current build pass a live call? No recording exists.
- Does typecheck / lint / production build still pass? Not re-run by me.
- Does `CallRecorder` count audio before or after a barge-in flush? (Matters for reading `witnessSeconds`: if it counts post-flush, 1.9 s may mean "flushed", if it counts arrival, it means "never arrived". Check `call-recorder.ts` and where `enqueue` tees.)
- What the three Scenarios mp4s actually show.
- Whether the owner tests on speakers or headphones. The design assumes headphones (barge-in on speakers is knowingly compromised; the mic gate exists because the player renders through its own AudioContext that browser echo cancellation cannot see).

Never done:
- The ElevenLabs corpus (`ELEVENLABS_API_KEY`, `render-corpus.mjs`) — `fixtures/audio` state unknown; the scripted "Play" buttons use the browser's voice. It is unknown whether Recorded/Scripted mode plays end to end with real audio. This is the fallback path and needs checking.
- Mode B on live audio (scripted only).
- Payer Inconsistency Index, Judge Mode (`/judge`), Contradiction Autopsy scrubber, Deadline Guard, Denial-Letter cross-check.
- **Contest artifacts (mandatory, all zero):** video 3–5 min; slide deck PDF including a competitive-analysis slide; 16:9 cover image; short description ≤255 characters; long description ≥100 words. Nothing is to be SUBMITTED yet without the owner's explicit say-so.

Hypotheses for the post-split truncation, unverified, in the order I'd test them:
1. **Mic gate / self-barge-in** (the mechanism fixed by `586db95`) — needs a call on the current build.
2. **Greeting audio never fully delivered** by the Voice Agent socket now that no audio flows in (timeline: audio arrives 1–4 s late and in <2 s of total content). The spike showed a no-audio session speaks its greeting and answers `reply.create` in 409 ms, but the spike was probably scripted, not browser-driven with a real mic on the other socket.
3. **Player under-run**: `playback-idle` after ≈1 s in both failing calls suggests the ring buffer ran dry. If the server is slow to stream after the first second, the 120 ms prebuffer + `draining` re-arm produces exactly the 0.2–0.5 s fragments seen.
4. **Two AudioContexts** (mic context and player context, both 24 kHz) plus a suspended-until-gesture context — the player only resumes when `open()` finishes; chunks are held in `pending`, but any exception there would look like silence.
5. **Rate limit**: 5 new streams/min and each call opens two. Repeated test clicks could get the second socket refused; the Voice Agent socket then greets with no STT (the timeline in call 21:26 shows no rep-turn at all in 15 s of rep audio, consistent with STT never connecting).
6. Token/session issues on the deployed site vs local dev (same-origin guard, single-use token, 300 s cap).

---

## 7b. NEW EVIDENCE gathered after the sections above were written (same day)

The owner confirmed: **headphones were used, they followed the script, and they want the LIVE ability kept** (not a replay-only fallback). Headphones make acoustic echo an unlikely cause of the truncated greeting in the 17:26/17:29 calls.

Three experiments were run by Claude (scripts in the session scratchpad, NOT committed; they can be rewritten in minutes):

**Experiment 1 — the server in isolation (`trace-greeting.mjs`).** Opened a Voice Agent socket with the app's real `session.update` (same greeting, voice `jean`, turn detection, no `llm` key) and sent NO input audio, then a `reply.create`. Result: `session.ready` at +0.7 s, `reply.started` +0.74 s, first audio +1.1 s, **the complete greeting delivered — 6.82 s of audio, `reply.done` status `completed`** — then the second `reply.create` was accepted and began streaming 80 ms later. Note that audio arrived at roughly REAL-TIME pace (6.57 s of audio by +7.3 s), not "far faster than real time" as the handoff and `isSpeaking` comments assert. The server side is healthy; the API is not the cause.

**Experiment 2 — the real app, silent microphone.** Headless Chromium (playwright-core with the installed chromium-1243, flags `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`), clicked "Be the Rep (live)" → "Start live call", let it run, clicked "Save call". Result on the CURRENT local build (`0ac36ef`, dev server): greeting line at 1.84 s, **playback 2.73 → 9.72 s continuous, 6.99 s recorded — the greeting played in full as one piece.**

**Experiment 3 — replay of the owner's actual failing Rep audio.** Fed `rep-2026-09-25T21-29-34.wav` (the Rep audio from the 17:29 failing call) into the fake mic on the current build, both LOCAL and the DEPLOYED site (https://the-witness-omega.vercel.app, which therefore answers "is it stale?": no, it behaves identically to local `0ac36ef`):
- Local: greeting 1.7 → 10.2 s (8.5 s continuous); "Can you hear me?" recognised at 13.6 s; `identify` line spoken 14.1 → 17.7 s. 12.14 s Witness audio.
- Production: greeting 2.4 → 10.5 s; "Can you hear me?" recognised at 13.9 s; `identify` line spoken 14.2 → 17.5 s. 11.37 s Witness audio.
- Compare the original failure with the same Rep audio: 2.34 s of Witness audio, greeting in three fragments, no line spoken after the Rep's turn.

**What this establishes.** (a) The current code, local and deployed, plays the full greeting and responds to the same Rep audio that broke the earlier build. (b) So the 17:26/17:29 failures were very probably the mic-gate defect that `586db95` fixed — that reading is now supported by a behavioural test, no longer only by unit tests. (c) The deployed site is serving the fixed code. (d) The unit tests, spike and these experiments all pass; a real-person call on the current build is still the missing confirmation.

**What this does NOT establish (important caveats).**
- The fake microphone is a file played straight into Chrome: no room, no acoustic echo, no real timing, and the Rep audio starts at call start, not in response to the Witness. It cannot reproduce speaker-to-mic feedback or a person interrupting mid-sentence.
- Headless Chromium has no real sound device. It proves the audio reaches and is scheduled through the AudioWorklet and that `playback-started/idle` behave; it does not prove what a human hears (glitches, latency perception, voice quality).
- It ran ONE Rep script, ONE conversation. It did not run the full plan to completion, the read-back, the close, or any contradiction challenge. Those were only ever exercised live in the two pre-split calls at 16:24/16:30.
- The owner has said the calls "aren't working" but the newest saved recording predates both fixes. Either the owner's latest tests were not saved, or they exercised a browser/state not covered here (real mic, real room, cached old bundle, extension, different Chrome profile, different network, rate-limited 5 streams/min so the second socket was refused). **The single most valuable next datum is a saved call (`Save call`) from the owner's own machine on the current build, plus any red error text shown in the console UI.** If the owner's calls fail while these pass, the difference is environmental and the failure is on the owner's side of the glass.
- Two observations the next model should chew on: (1) the greeting's first-audio latency varies 0.3–4 s across calls (here 0.6–0.9 s after the `greet` event); (2) the recorded `witness-line` for the greeting is emitted at `session.ready`, ~1–2 s before the first audible sample, so UI text runs ahead of audio.

Suggested immediate next steps for the planner: get an owner-side saved call on the current build with the browser console open (Chrome DevTools → Console; copy red errors), ideally also the exact browser version and whether Chrome extensions or a VPN are active; extend the headless harness to drive the whole plan (script the Rep's turns as separate wav segments timed off `witness-line` events) so full-call regressions are catchable without the owner; keep the timeboxed fallback plan in §8 in parallel, because the artifacts remain at zero regardless.

---

## 8. Time and options for the next 24 hours

The critical path is not the code any more; it is the five contest artifacts. A live demo is a mode of the product, not the whole of it. The app already has Scripted / Recorded / Live modes and the console works on replayed calls. A defensible plan:

1. **Establish ground truth (≈30 min):** confirm what Vercel serves; run typecheck, lint, build; get ONE fresh saved call from the owner on the current build with **headphones**, using the in-app "Save call" button; review it with `agy-listen.mjs` (Gemini via Antigravity, absolute paths; script in `~/.claude/skills/witness-call-review/scripts/`). Do NOT use a screen recorder to test.
2. **Timebox live-audio debugging** to a fixed window (suggested ~4 hours). If the greeting still doesn't complete to "could I get your name and badge number?", stop and go to fallback.
3. **Fallback:** build video/deck from the layers that ARE verified — the evidence engine, ledger, contradiction detection, packet, hash chain — driven by a scripted or recorded call. Check that Recorded mode really plays. Be honest in the video and descriptions about what is live vs replayed (the `witness-judge-package` skill's cite-guard and the ban on accuracy claims already push this way).
4. **Produce artifacts regardless of outcome:** short (≤255 char) and long (≥100 word) descriptions, deck with competitive-analysis slide, 16:9 cover, 3–5 min video.
5. Cut rule: anything not visible in the video is dropped (no Payer Index / Judge Mode / Autopsy unless they'll appear).

Questions the owner must answer:
- Speakers or headphones during the failing tests?
- The earlier request that the AI "speak freely" — was it built correctly? It was read as "the two call approaches (first-call vs follow-up)", NOT as "let the LLM compose its own sentences". All of this project's design (constraints 2–3) and the last week of fixes moved toward the model NEVER being heard. Confirm before anyone loosens it.
- Are you willing to submit a video showing a replayed call if live remains unreliable?

---

## 9. Rules of engagement for whoever works on this next

- Read `AGENTS.md`, `.ai/handoff.md`, then `git status` in `the-witness/`. End of session: update `.ai/handoff.md`, log real decisions in `.ai/decisions.md`.
- Do NOT add files or directories to the repo root; follow `.repo-layout.yml`.
- Never delete, move or rename anything under `C:\JarvisLite\Projects` without explicit permission. Nothing is to be submitted to the contest yet.
- Never add a field to `session.update` without spiking it — failure is silence, not an error.
- Do not "tidy" the semicolons in `spellForSpeech`.
- `git add -A` is dangerous here (the tester's mp4s). `Items to show claude/` is gitignored; keep it so.
- Two sockets per call, both registered, both closed on every exit path; 5 new streams/minute — a reconnect loop or repeated rapid test clicks exhausts it and looks like a connection bug.
- Do not report a check as passing unless it was run. Verified this session: unit tests only.

## 10. Key files for a reader

`src/services/live-call.ts` (orchestration, mic gate, barge-in), `src/services/audio-io.ts` (mic + player + `isSpeaking`), `src/services/voice-agent-session.ts` (socket, `session.update`, owned-reply filter), `src/services/streaming-session.ts`, `src/services/call-recorder.ts`, `src/domain/call-plan.ts` and `speech.ts` (what the Witness says), `src/app/api/token/`, `.ai/decisions.md` (the reasoning behind every design choice, dated), `.ai/handoff.md`, `docs/PROJECT-STATE.md`, `CLAUDE.md`.

---

## 12. WORK REMAINING - checklist for the planner (deadline 2026-09-30 11:00 ET)

Owner decisions already made: **keep the LIVE call** (do not fall back to replay-only unless live cannot be fixed in time); owner tests with **headphones** and follows the Rep script; **nothing is submitted to the contest until the owner says so**.

### A. Prove the live call works (blocks the video)
- [ ] **A1. Owner-side saved call on the current build (`0ac36ef`).** Owner runs one call at https://the-witness-omega.vercel.app, clicks "Save call", and copies any red errors from Chrome DevTools > Console. Done when: a `call-*.json` + `witness-*.wav` + `rep-*.wav` exist for a call made AFTER commit `0ac36ef`, plus console text. (Only the owner can do this; no recording of the current build exists.)
- [ ] **A2. Diagnose if A1 fails.** Compare against §7b: the headless replay passes on the current build, so a failure on the owner's machine points to environment (browser/profile, cached bundle, real mic/room, the 5-new-streams-per-minute limit refusing the second socket, network). Timebox ~4 h, then decide with the owner whether to fall back.
- [ ] **A3. Full-plan run.** Done when one saved call reaches `plan-complete` on the current build with: greeting heard in full, identity captured, at least one contradiction challenge spoken, read-back spoken, closing line heard in full, and no `playback-idle` gaps mid-sentence. Only the opening exchange has been verified since the fixes; the full plan last ran in the two PRE-split calls.
- [ ] **A4. Headless full-call harness** (nice to have, removes dependence on the owner): drive the whole plan with the Rep's lines as separate WAV segments timed off `witness-line` events. Recipe in §7b. Mind the 5 streams/minute limit (each run = 2 streams).

### B. Mandatory contest artifacts - ALL STILL ZERO
Create these outside the repo root (see `.repo-layout.yml`; images/recordings belong in `docs/assets`). Follow the standing prohibitions: **no transcription-accuracy percentages anywhere; no CPT code descriptors; no PHI; no rep reputation scoring.** Use the `witness-judge-package` cite-guard rules. Do not overclaim what is live vs replayed.
- [ ] **B1. Short description**, <= 255 characters. Done when: counted, <= 255.
- [ ] **B2. Long description**, >= 100 words. Done when: word-counted, states the problem (payer call statements vanish; ~19% of in-network claims denied, <1% appealed), the line "we don't predict what the payer will pay - we record what the payer said", the AssemblyAI angle (spoken alphanumerics; agent speaks a read-back rather than guessing), and how it uses Voice Agent + Streaming v3.
- [ ] **B3. Cover image**, 16:9. Done when: exported PNG/JPG at 16:9 (e.g. 1920x1080), legible at thumbnail size.
- [ ] **B4. Slide deck PDF**, must include a **competitive-analysis slide**. Done when: PDF exported; slides cover problem, product, live demo, architecture (two sockets), evidence model (append-only ledger, hash chain), competitive analysis, roadmap (Mode B live).
- [ ] **B5. Demo video**, 3-5 minutes. Done when: length in range; shows a real live call (from A3) or clearly-labelled replay; shows a contradiction being caught and the appeal packet (`/packet`). Owner's approval before anything is published.
- [ ] **B6. Submission on lablab.ai.** Done when: OWNER explicitly says submit. Deadline 2026-09-30 11:00 ET.
- Also required by CLAUDE.md: a meaningful commit each day through Sep 30 (commit-spread is judged).

### C. Owner decisions still open
- [ ] **C1.** "Let the AI speak freely" - built as the two call approaches (first-call vs follow-up), NOT model-composed sentences (constraints 2-3 forbid the model supplying facts). Owner to confirm the reading before anyone loosens it.
- [ ] **C2.** Is a clearly-labelled replay acceptable in the video if live stays flaky? (Owner currently wants live kept.)

### D. Optional - only if time remains (cut rule: drop anything the video or Judge Mode will not show)
- [ ] D1. Judge Mode at `/judge`. D2. Payer Inconsistency Index (aggregate at payer level only). D3. Contradiction Autopsy scrubber. D4. Deadline Guard. D5. Denial-letter cross-check.
- [ ] D6. ElevenLabs demo corpus: needs `ELEVENLABS_API_KEY`, then write `fixtures/scripts/render-corpus.mjs`; until then scripted "Play" buttons use the browser voice. Unknown whether Recorded mode plays end to end - check before relying on it as a fallback.
- [ ] D7. Mode B (Whisper mode) on live audio (Streaming v3 second session). Scripted-only today.

### E. Hygiene
- [ ] E1. Re-run `npm run typecheck`, `npm run lint`, `npm run build` (only `vitest run` = 195 passing was re-run in this session).
- [ ] E2. Correct the comment in `src/services/audio-io.ts` (`isSpeaking`) claiming the server sends audio "far faster than real time"; the §7b trace measured roughly real-time delivery (6.57 s of audio by +7.3 s). The end-time accumulation logic is still correct; only the stated rationale is doubtful.
- [ ] E3. Keep `Items to show claude/` gitignored; never `git add -A`.
- [ ] E4. Update `.ai/handoff.md` (local, outside repo) at the end of each session.

### Suggested order
A1 (owner, ~2 min) in parallel with B1, B2, B3, B4 (no dependence on the live call) -> A2/A3 as needed -> B5 (needs a working call or a labelled replay) -> C answers -> B6 on owner's word -> D only with spare time.


---

## 13. Addendum, later on 2026-09-29: what changed after this report was written

The four saved calls were committed to `docs/assets/calls/` and measured (see that folder's README). The finding that matters: in both failing calls the greeting audio stopped *arriving* from the server after about two seconds, and one of the two had a dead microphone (15 s of digital silence). Neither is something the mic-gate fix touches, so sections 7 and 7b overstate what `586db95` proved. The timeline could not say why the audio stopped because it recorded no socket events; it does now.

Landed on branch `claude/wizardly-edison-7fk3g9` (draft PR against `main`): socket-level events in the saved call; a single zip from "Save call"; the recap no longer ends the session (sign-off follows the Rep's answer or an 8 s silence); the microphone gate applies on speakers only, with a Headphones/Speakers control; an interruption mutes the rest of the reply; the transcription socket pins `speech_model` and raises `max_turn_silence` to 2000 ms (the 16:24 recording shows a badge number split under the default). Also: README, diagram source, config and punctuation cleaned; console design pass; cover image, README animation, deck, descriptions, judging template and runbook in `docs/submission/`.

Still open, in this order: an owner-side saved call on this build (with the new events), the live spike of the transcription parameters, the video, slide 11 verification, submission. All in `docs/submission/RUNBOOK.md`.
