# Saved test calls (2026-09-25)

Recorded from inside the browser by the in-app "Save call" button (`src/services/call-recorder.ts`). Each call is up to three files:

- `call-<ts>.json`: event timeline, `atMs` since call start, kind (`witness-line`, `rep-turn`, `playback-started`, `playback-idle`, `ready`, `stop`). `witnessSeconds` is audio that reached the host from the Voice Agent socket; `repSeconds` is microphone audio.
- `witness-<ts>.wav`: the Witness's voice as it arrived from the server, concatenated (24 kHz mono PCM16). Its length is the amount of audio delivered, not call time.
- `rep-<ts>.wav`: what the microphone heard, recorded before the mic gate.

Timestamps are UTC; local (US Eastern, EDT) is four hours earlier. The tester used headphones and followed the Rep script. All content is scripted demo data (no real patients).

## Which file belongs to which call

The filename stamp is the moment "Save call" was clicked, not the call start, and at the time these were saved the button fired three downloads at once, which Chrome blocks after the first until the user allows multiple downloads. Two files therefore carry the wrong stamp. Attribution below is by measured duration against the timeline's `witnessSeconds` and `repSeconds`.

| Timestamp (UTC) | Local | Build | Files (attributed by duration) | Outcome |
|---|---|---|---|---|
| 20-24-56 | 16:24 | single socket | `call-...20-24-56.json`; witness track is `witness-...20-23-57.wav` (66.00 s = witnessSeconds 66); microphone track is `witness-...20-24-56.wav` (149.80 s = repSeconds 149.8) | Ran to `plan-complete`. Identity was never captured: the STT returned "Badge number 2." (a four-digit badge split mid-utterance), so the call ended on the hand-off line rather than the sign-off. |
| 20-30-07 | 16:30 | single socket | json + both wavs | Ran to `plan-complete`. The read-back requested at 144.0 s did not play until 176.1 s, immediately after the next Rep turn: the server sat on our `reply.create` for 32 s. Closing line cut mid-sentence (fixed since by `closeWhenSilent`). |
| 21-26-01 | 17:26 | two sockets, before `586db95` | json + both wavs | **Failed.** 1.9 s of Witness audio arrived (one 1.75 s segment), then nothing. The microphone track is digital silence for all 15.3 s (peak RMS 0.004): the input device delivered nothing. |
| 21-29-34 | 17:29 | two sockets, before `586db95` | json + both wavs | **Failed.** 2.34 s of Witness audio arrived, then nothing. The Rep said "Can you hear me?" at 10.4 s (recognised at 14.9 s); the `identify` line was queued but no audio for it ever arrived. |

## What the measurements say

- The two failures are upstream of playback: the server's greeting audio stopped *arriving* after about 2 s. A client-side flush cannot reduce `witnessSeconds`, because the host records each chunk before the player sees it.
- Commit `586db95` (the mic-gate fix) changes only how long the microphone stays closed and the barge-in word test. It does not change what the server sends, and the 17:26 microphone was silent anyway, so that commit cannot be what fixed these two failures.
- The timeline has no socket-level events (`reply.started`, `reply.done` and its status, suppressed replies, `session.error`, STT partials), so it cannot say whether the server stopped or a second reply caused our ownership filter to drop the rest. Later builds record those events; the next saved call answers the question.

No saved call exists yet for commits `586db95` or later. See `docs/SITUATION-REPORT-2026-09-29.md` for the fuller analysis.

The screen recordings (`Scenarios 8 (test1-3).mp4`, `Recording 2026-09-23 052700.mp4`, up to 151 MB each) are deliberately not in the repo: GitHub rejects files over 100 MB, they predate the fixes, and a screen recorder contends for the sound card, so they are unreliable for audio review.
