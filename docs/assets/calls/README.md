# Saved test calls (2026-09-25)

Recorded from inside the browser by the in-app "Save call" button (`src/services/call-recorder.ts`). Each call is up to three files sharing a UTC timestamp:

- `call-<ts>.json` - event timeline: `atMs` since call start, kind (`witness-line`, `rep-turn`, `playback-started`, `playback-idle`, `ready`, `stop`...). `witnessSeconds` is audio that reached the player; `repSeconds` is microphone audio.
- `witness-<ts>.wav` - what the Witness's voice delivered (24 kHz mono PCM16).
- `rep-<ts>.wav` - what the microphone heard, recorded before the mic gate.

Timestamps are UTC; local (US Eastern, EDT) is four hours earlier. The tester used headphones and followed the Rep script. All content is scripted demo data (no real patients).

| Timestamp (UTC) | Local | Build | Files | Outcome |
|---|---|---|---|---|
| 2026-09-25T20-23-57 | 16:23 | pre-split | witness wav only (no timeline) | aborted call |
| 2026-09-25T20-24-56 | 16:24 | pre-split, single socket | json + witness wav (no rep wav) | ran the whole plan to `plan-complete`; 66 s Witness audio |
| 2026-09-25T20-30-07 | 16:30 | pre-split, single socket | json + both wavs | ran to `plan-complete`; 32 s stall around the read-back; closing line cut mid-sentence |
| 2026-09-25T21-26-01 | 17:26 | two-socket split, BEFORE the mic-gate fix (`586db95`) | json + both wavs | **failed**: 1.9 s of Witness audio; greeting never completed |
| 2026-09-25T21-29-34 | 17:29 | two-socket split, BEFORE the mic-gate fix | json + both wavs | **failed**: 2.34 s of Witness audio in fragments; no line spoken after the Rep's turn |

No saved call exists for commits `586db95` or `0ac36ef` (the current build). See `docs/SITUATION-REPORT-2026-09-29.md` for the analysis, including a headless replay of the 21-29-34 Rep audio that passes on the current build.

The screen recordings (`Scenarios 8 (test1-3).mp4`, `Recording 2026-09-23 052700.mp4`, up to 151 MB each) are deliberately not in the repo: GitHub rejects files over 100 MB. They also predate the fixes and are unreliable for audio review (a screen recorder contends for the sound card).
