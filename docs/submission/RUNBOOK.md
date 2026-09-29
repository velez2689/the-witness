# Submission runbook (for the next model, and for the owner)

Deadline: 2026-09-30 11:00 ET. Nothing is submitted until the owner says so. Standing rules for every artifact: no transcription accuracy percentage; no CPT descriptor text; no PHI (say the data is synthetic); no rep reputation scoring; never call footage live unless it is; every number carries its source and year from `docs/PROJECT-STATE.md` section 9; plain punctuation; no emoji.

## State on 2026-09-29 (what is done, what is not)

| Item | State |
|---|---|
| B1 short description | Done: `docs/submission/short-description.txt` (252 chars) |
| B2 long description | Done except the last paragraph, which says what the video shows; fill it after B5 |
| B3 cover image | Done: `docs/assets/cover-16x9.png` (3840x2160, downscale to 1920x1080 on upload if the form wants it) |
| B4 deck | Done as `docs/submission/deck.html` and `deck.pdf`; slide 11 (competitors) needs the verification step below before it ships |
| B5 video | Not started; recipe below |
| B6 submission | Owner only; checklist below |
| Live call on the current build | Not yet proven; steps below |

## A. Prove the live call (needs the owner's machine, a key, headphones)

1. Deploy the branch (or merge to `main`, Vercel auto-deploys). Confirm the deployed page shows the "Headphones / Speakers" control next to "Be the Rep (live)": that is how you know the new build is live.
2. One Chrome tab, headphones, DevTools Console open, extensions off, no VPN. In Windows sound settings confirm the input device is the headset microphone (the 17:26 recording on Sep 25 had a dead microphone: 15 s of digital silence).
3. Press "Start live call", follow the Rep script in `fixtures/scripts/rep-bank-call-06.ts`, and let it run to the sign-off ("have a good one"). Then press "Save call": one zip downloads.
4. If it fails, open the zip's `call-*.json`. The timeline now carries `reply-started`, `reply-done <status>`, `suppressed`, `transcript-agent`, `session-error`, `stt-begin`, `stt-partial`, `stt-error`, `token`, `socket-closed`, `interrupted`. Read it in this order: did both tokens say `ok`; did `stt-begin` arrive; did `reply-started: ours` arrive for the greeting and did its `reply-done` arrive with `completed`; if audio stopped without a `reply-done`, the server stalled; if a `reply-started: model` appears, the ownership filter dropped the rest (report it, that is a server behaviour the split should have removed); if `session-error` says anything about limits, wait two minutes (5 new streams per minute, 2 per call; the app's own token limit is 10 tokens per 10 minutes).
5. Push the zip to `docs/assets/calls/` and add a row to its README with the build hash.
6. Spike the transcription parameters once: `fixtures/scripts/spike-voice-agent.mjs` shows the pattern; write `spike-streaming.mjs` that mints an `stt` token, connects with the query string `StreamingSession.connect` builds (`speech_model`, `max_turn_silence`, `min_turn_silence`, `voice_focus`, `inactivity_timeout`, `keyterms_prompt`, `format_turns`), streams a WAV of someone reading "Eight K two J, nine eight eight" with a 1.2 s pause, and prints every `Turn` with `words`. Done when the reference arrives as one turn. If any parameter is rejected, the `Error` message says which; remove it from `STT_SETTINGS` in `src/services/live-call.ts`.
7. Timebox: 18:00 ET on Sep 29. After that, the video uses the scripted Rep (see B5).

## B5. Video (3 to 5 minutes, target 4:30, MP4 1920x1080)

| Time | Beat | Screen |
|---|---|---|
| 0:00-0:30 | The problem, opening on the refusal quote | deck slide 2, then the console at idle (the grey "on record" link is visible) |
| 0:30-1:00 | The read-back under degraded audio: why the agent has to speak | console: the reference number lands unconfirmed, the Witness reads it back |
| 1:00-2:00 | FLAG 1: the link from Jul 08 to today; the Witness challenges on the line | console mid-call; banner; inspector with both quotes |
| 2:00-2:30 | FLAG 3: the refusal recorded as a row; the gate; the sign-off | console; hang-up gate; close-out |
| 2:30-3:00 | The packet: quotes with timestamps, Verify integrity | `/packet` |
| 3:00-4:00 | Business case: market, revenue, competitors | deck slides 9 to 11 |
| 4:00-4:30 | Roadmap and the ethics line; what was live vs replayed | deck slides 12 and 8 |

Recipe:
1. Never run a screen recorder that captures system audio during a live call (on Sep 23 it delayed the greeting by 81 s). Record the screen with audio capture OFF and record the call with "Save call". In the editor, lay `witness-*.wav` and `rep-*.wav` from the zip at their offsets from `call-*.json` (`atMs` of the first `playback-started` and the first `rep-turn`). That is the real call audio and can be labelled as such.
2. Narration recorded separately, plain voice, no music under the call.
3. If the live call is not clean by the timebox: run the scripted Rep in Mode A at 1x, mute the browser voice, narrate, and keep a caption "Replayed scripted call on the real console" on screen for the whole demo segment.
4. Check length with the editor or `ffprobe`; the on-screen latency figure must be the real one.
5. Fill the last paragraph of `docs/submission/long-description.md` and slide 8 of the deck to match what was recorded. The owner watches the whole video before it is uploaded.

## B4. Deck: what still needs a human

- Slide 11 names Infinitus, Outbound AI, Waystar, Experian Health and AKASA. Before the PDF ships, open each vendor's site and confirm each row's ticks; put the URL in the slide notes; delete a row rather than guess.
- Regenerate the PDF after any edit: `PLAYWRIGHT_CORE=<path> node fixtures/scripts/render-deck.mjs` (writes `docs/submission/deck.pdf`).
- Check: page count 13, every number on slides 2, 3, 9 has a source and year, no percentage about accuracy, no CPT descriptor.

## B6. Submission checklist (owner clicks submit)

Fields from lablab's submission guide: project title ("The Witness: payer call memory"); short description (B1); long description (B2); technology and category tags (AssemblyAI Streaming STT, AssemblyAI Voice Agent API, Next.js, Vercel, healthcare, voice agent); cover image (B3, PNG 16:9); video (B5, MP4 under 5:00); slide PDF (B4); GitHub URL `https://github.com/velez2689/the-witness`; application URL `https://the-witness-omega.vercel.app`.

Pre-submit gate:
- The branch is merged to `main` and Vercel shows the new build (the Headphones/Speakers control is visible).
- The live URL opens in a fresh incognito window with no auth wall; the scripted call runs end to end.
- `git clone` then `npm ci && npm run build` succeed on a clean machine.
- `LICENSE` is MIT; README top has the URL.
- A commit exists on Sep 29 and on Sep 30 before 10:30 ET.
- `grep -rniE '[0-9]+ ?% ?(accura|wer)' docs/submission docs/assets README.md` returns nothing.
- The long description's last paragraph and deck slide 8 match the video.

## Optional, only if time remains (cut rule: nothing the video will not show)

- Real waveforms in the edit view from the recorder's PCM (`src/ui/Stage.tsx`, a `peaks()` helper).
- "Play" on a live statement plays the Rep WAV slice from the recorder using the statement's span offsets; until then, the button reads "Read aloud" on scripted data.
- Word timings from the `Turn` message as statement offsets, and the end-of-turn to flag latency displayed beside the engine time.
- `agent_context` on the transcription socket: after each Witness line, `UpdateConfiguration` with the line's text (the docs say this improves recognition of spelled-out identifiers in the next user turn). Spike first.
