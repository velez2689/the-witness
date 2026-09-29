# Writing style for code, UI text and docs

Short on purpose. Every rule here was applied to the repo on 2026-09-29; keep it that way.

- ASCII punctuation in user-visible strings and in prose: commas, colons, full stops, plain hyphens. No em or en dashes, no curly quotes, no ellipsis character.
- The middle dot (U+00B7) is allowed as a separator in console readouts and labels ("same badge · 49 days · two answers"). It is the console's transport-style separator, not decoration.
- No emoji anywhere: code, comments, docs, commit messages, submission copy.
- Confidence is a state (confirmed, unconfirmed, not captured), never a percentage. No transcription accuracy percentage anywhere.
- CPT codes are opaque strings. Descriptor text never ships.
- Uppercase letterspaced labels only where a real instrument prints them: the transport state, the contradiction kind label, the CMS-1500 box labels.
- Comments explain a decision and the evidence for it. They do not narrate what the next line does.
