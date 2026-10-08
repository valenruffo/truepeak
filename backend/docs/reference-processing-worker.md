# Reference processing worker

This internal seam processes a claim already authorized by a trusted caller. The immutable claim
receipt describes one attempt; it is not external authorization.

## Contract

- The caller constructs and supplies the bounded provider; the worker does not configure a model.
- The reader receives the claimed label, reference, upload, and final ETag for exact-object reading.
- Original reading and inference run outside service sessions and database transactions.
- Success uses the existing atomic publication transaction to store the embedding and mark the
  exact active claim READY.
- Read or inference errors attempt failure completion once with the same receipt. The original
  error remains raised; a failure-completion conflict or error is chained as evidence.
- Publication errors never trigger failure completion because the database commit may be ambiguous.
- The worker does not authorize, claim, retry, resume, poll, or automatically overwrite a claim.
