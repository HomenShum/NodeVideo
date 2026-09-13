# NodeVideo × NodeSlide morning rehearsal

## The test

Explain NodeVideo to an applied-agents backend interviewer in **120 seconds** using the five-slide deck. Do not memorize the narration. Use each slide to recover the causal chain.

## Slide timing

| Slide | Time | Your job | The interviewer should be able to repeat |
| --- | ---: | --- | --- |
| 1. Problem and motivation | 0:00–0:22 | State why trust, not FFmpeg syntax, is the problem. | “The model proposes; exact media work must be reproducible.” |
| 2. Architecture boundary | 0:22–0:47 | Name the three planes and one owner for each. | “NodeAgent plans, Convex coordinates, tools execute.” |
| 3. Planning vs execution | 0:47–1:12 | Walk one request from brief through receipt. | “Approval freezes a typed, hash-bound plan before render.” |
| 4. Tradeoff and failure | 1:12–1:37 | Name the rejected alternative and one concrete failure guard. | “Less unconstrained flexibility buys inspectability and recovery.” |
| 5. Proof and lesson | 1:37–2:00 | Give one pass, one abstention result, and one failure. | “The system reports non-success honestly.” |

## Two adaptive questions

1. Why is the language model not responsible for frame-accurate editing?
2. What state must survive reload, concurrent sessions, and stale proposals?

Answer each in 20 seconds without looking at speaker notes. If you name a technology, immediately bridge it with **because**.

## Retake rules

- Retake only the slide that misses its job.
- Kill and retry a section if it has more than three unexplained technology names.
- Kill and retry if you state a result without its proof boundary.
- Keep the tradeoff at 20–25 seconds; do not spend the first minute on setup.
- Never say the full Expression Loop is implemented. Say this is the first manual dogfood artifact.

## Self-check receipt

- [ ] Led with the trust problem in the first 12 seconds.
- [ ] Separated NodeAgent, Convex, and deterministic tools.
- [ ] Explained the proposal → approval → hash-bound plan → render flow.
- [ ] Named arbitrary renderer code as the rejected alternative.
- [ ] Explained leases or stale-proposal rejection in plain language.
- [ ] Included both the 22-test pass and the strict editorial failure.
- [ ] Stayed within 120 seconds.
- [ ] Did not read any slide verbatim.
- [ ] Ended with the lesson, not a product slogan.
