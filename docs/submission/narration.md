# Narration for the demo video

Spoken by AssemblyAI voice agents (the same Voice Agent API the product uses, as a mouth only: each line is sent verbatim with `reply.create`). One numbered line per beat; the footage script holds each beat for the length of its audio, and line numbers must not change because each number is tied to one console step. A line may hold several segments separated by ` || `; a segment that starts with `REP: ` is the payer representative, rendered in a second voice through a phone-line filter. Everything else is the narrator, who is also the Witness. Total spoken time must stay under four and a half minutes. No accuracy percentage, no CPT descriptor, no PHI.

1. Hi. This is an AssemblyAI voice agent, and the voice you will hear on the call. Let me show you The Witness: payer call memory for medical billers.
2. A biller spends twenty-five minutes and about fourteen dollars on one call asking why a claim was denied. The answer is spoken, and gone at hang-up. Weeks later a different representative says something else, and nothing catches it. Nearly one in five claims is denied. Fewer than one in a hundred denials is appealed.
3. The console before the call. Six earlier calls on one claim, hold time to scale. One contradiction already on record. Every row is what a representative said, with a date, a name and a badge.
4. The call starts. I say that I am an AI assistant and that the call is recorded. That line is verbatim.
5. A name and a badge number become a row.
6. I read the claim back and say earlier calls are on file.
7. Four minutes on hold. Then the answer: that claim was denied, for timely filing.
8. The same representative, badge two two one zero, said no prior authorization forty-nine days ago. The link is drawn, and I challenge it on the recorded line. Code assembled every fact in that sentence. I only read it.
9. REP: I am showing timely filing today.
10. I ask about the August fifth call, citing the payer's own reference number.
11. REP: I do not have a record of that call. || The ledger does.
12. REP: I would have to look into that.
13. What does the remit say?
14. REP: There is also a diagnosis issue on it.
15. Which diagnosis code?
16. REP: It does not specify on my screen. || A category with no value. A refusal, recorded as a row, not left blank. The absence is the evidence.
17. Remark code?
18. REP: I would have to refer you to the denial letter. || A second refusal on record.
19. Reference number for this call?
20. The representative reads it fast, over hold music. Reference numbers are the hardest thing to hear on a phone, so it lands unconfirmed. I do not guess.
21. I read it back. Eight K two J, nine eight eight. Did I get that right?
22. REP: That is correct. || The field turns confirmed, as a new row. The original is never touched.
23. The recap is assembled from the rows: representative, denial reason, the conflict, two refusals, the reference number.
24. REP: You are welcome. Goodbye.
25. Now I sign off. The call ends only once the gate is clear.
26. The inspector holds both quotes. The hang-up gate: every required field is captured, or refused on the record.
27. The claim update sheet. Every line traces to a statement.
28. The biller can also take the call. Whisper mode: the biller speaks, I listen, and I whisper into their earpiece only. I never speak on the line.
29. When the representative contradicts the July call, I whisper the earlier statement and its date. The biller challenges it in their own words.
30. At the end I whisper what the claim still needs, and the close-out is read from the rows.
31. The appeal packet quotes the record: badge, reference, date and offset. Conflicts first.
32. The ledger is hash-chained. Verify integrity recomputes it from the log on the page.
33. How it works. The representative's audio goes to AssemblyAI Streaming. Verbatim. The claim's own numbers are seeded as keyterms. I speak through the Voice Agent API, and I am never sent audio. I call no tools, and I never touch the ledger.
34. An append-only, hash-chained ledger. Five kinds of contradiction. Refusals recorded as rows. Confidence is a state, never a percentage.
35. Spoken reference numbers are the hard case. So: keyterms before the call. A read-back instead of a guess. And a transcript that keeps the self-correction, because the correction is often the contradiction.
36. The market is the cost of chasing denials: twenty-five point seven billion dollars a year, and fifty-seven dollars per denied claim. The buyer is a billing office with a denial queue.
37. Revenue: a seat per month, metered calls above the quota, the appeal packet as the upsell. A back-of-envelope break-even, using a hypothetical ninety-nine dollar seat: it pays for itself if it prevents eight repeat calls a month.
38. Voice agents that call payers exist. Denial platforms exist. One promises to predict what the payer will pay. We record what the payer said.
39. Next: Whisper mode on live audio, and a payer-level inconsistency index. We never score representatives.
40. That was the scripted representative on the real console. To run it live: open the witness omega dot vercel dot app in Chrome, with headphones, choose Be the Rep, live, Headphones, then Start live call. Give a name and a badge, say the claim denied for timely filing, and when I ask for the reference number say eight K two J, nine eight eight. Then click Save call. Thank you.
