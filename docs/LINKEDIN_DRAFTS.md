# LinkedIn drafts: Countersign

Two drafts for Shane to edit, written 2026-11-24 for the portfolio pack. **Both: Drafted, unposted.**

Rules they follow: first person, plain, one real decision from `docs/countersign/DECISIONS.md` each (named below the
draft, not in it); Countersign is described as a sample build on synthetic data that is not deployed; no client, user,
result or personal career number is claimed; no employer is named. Every product fact traces to the decisions log or the
README.

---

## Draft 1: "Is this the document that was signed?"

**Status: Drafted, unposted.** Built on **D-40** (verify by re-deriving the record, not by looking up a stored hash),
with D-17 (unsigned never verifies).

> A stored hash only proves one thing: the stored bytes match the stored hash.
>
> I learned that building Countersign, a sample proposal-and-e-sign app I made to test how a signing record holds up later. Synthetic data, not deployed, signing mocked on purpose.
>
> The question a signing tool has to answer months later is simple: is this the PDF that was signed?
>
> The easy version looks the file's hash up and says yes. But if someone edits the record at rest, the lookup still says yes.
>
> So the verify page rebuilds the record instead. It re-renders the proposal PDF and the completion certificate from the stored data and compares them byte for byte. It re-computes the price the client agreed to. Only when every check passes does it say "Verified."
>
> The trade-off: a renderer upgrade can change the bytes, so I pinned the version and taught the page to say "renderer changed" rather than cry tampering.
>
> And a proposal that was sent but never signed still has a valid hash. It verifies as "never signed," not as a match.
>
> If you have built anything that has to prove what happened later, what did you check that a lookup would have missed?
>
> #marketingoperations #ai #esignature #buildinpublic

---

## Draft 2: The add-on problem

**Status: Drafted, unposted.** Built on **D-32** (the client's add-on choice is recorded with the signature, not turned
into a new version), with D-21 (a sent version is frozen in the database).

> Proposals usually have optional extras. The client ticks "add the training day" and the total changes.
>
> Building Countersign, a sample proposal-and-e-sign app on synthetic data, that small feature ran straight into a rule I had already set: once a proposal is sent, its PDF and its lines are frozen. The database refuses the change.
>
> Two ways out. Make every tick create a new version with a new PDF. Or leave the document alone and record the choice with the signature.
>
> I went with the second. The sent PDF lists each add-on with its price. What the client picked, and the re-computed total, is stored with their signature and printed on the completion certificate.
>
> The document they read is byte for byte the document they signed. The certificate says what they chose.
>
> The cost is one more place to look: the final price lives on the certificate, not the proposal. I think that's the right trade for a record that has to hold up later. I'm less sure a sales team would agree.
>
> Where do you put a client's choices: in the document, or beside it?
>
> #marketingoperations #salesops #esignature #buildinpublic

---

Before posting: read each one aloud, check it still matches the decisions log, and decide whether to link the public repo
(`shanelabountyai/countersign` is public per CLONES.md).
