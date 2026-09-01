# AI Development Log

## Representative prompts

1. Design a full-stack architecture for a loan data verification console with CSV ingestion, deterministic validation, exceptions, human-gated AI review, verified records and audit hashes.
2. Generate a canonical loan schema and validation matrix covering the intentional data issues described in the challenge statement.
3. Design a dark fintech dashboard that prioritizes data density, trust signals, exception severity and reviewer workflow without visual clutter.
4. Create an API surface for loans, exceptions, verified records, audit events, summaries and AI review.
5. Generate a deterministic AI review fallback that explains validation failures and suggests traceable corrections without silently mutating records.
6. Review the exception lifecycle and ensure AI recommendations are separate from human decisions and are logged.
7. Generate test cases for negative balances, balance overflow, invalid dates and clean records.
8. Review the backend workflow so uploaded exceptions persist and flow from Data Operator to Reviewer to Data Consumer.
9. Integrate the AI review endpoint with the Groq API while preserving a deterministic fallback when the provider is unavailable.

## Human review process

AI-generated implementation ideas were reviewed against the challenge requirements before being incorporated. The final design keeps validation deterministic, makes AI output advisory, persists uploaded exceptions, and records reviewer actions independently.

## Estimated AI-assisted implementation

Approximately 70% of scaffolding, UI ideation, API drafting, workflow analysis and test generation was AI-assisted. Core architecture decisions, challenge mapping, validation boundaries, audit semantics, product flow and final integration were human-reviewed.

## Additional prompts (post-review hardening pass)

10. Detect whether an uploaded CSV is a primary loan tape, a servicer update, or a document manifest, and route each to the correct backend handling instead of assuming one shape.
11. Implement cross-source conflict detection between the loan tape and the servicer update / document manifest files, raising reviewer exceptions instead of silently overwriting or corrupting records.
12. Make validation severities configurable by reading them from `validation_rules.json` instead of hardcoding them in the validation engine.
13. Verify the Groq model configured for the AI review endpoint is still current and not deprecated, and update the default accordingly.

## Rejected AI outputs

1. An early approach allowed AI suggestions to directly update loan fields. Rejected because the challenge requires AI output to remain separate from the final human decision.
2. An early architecture placed the entire workflow in the browser with local state only. Rejected because the challenge requires backend API and database persistence.
3. An early ingestion flow discarded invalid rows instead of persisting them as reviewer exceptions. Rejected because the Reviewer must receive the actual exceptions generated from the uploaded loan tape.
4. An early AI integration depended only on an external model. Rejected because the demo must remain usable when the provider is unavailable, so a deterministic fallback is retained.
5. An early servicer-update handling approach ingested the second-source file through the same primary loan-tape parser used for `loan_tape.csv`. Rejected because the files do not share a schema; that approach silently created corrupted duplicate loan records under generated IDs instead of comparing values against the existing record.
6. An early conflict-resolution approach let the update file overwrite the existing loan value directly. Rejected because the challenge requires conflicting values to be routed to a human reviewer, not resolved automatically.

## Lessons learned

AI was most useful for rapidly exploring architecture, API boundaries, validation cases and reviewer workflows. Human engineering judgment was most important when translating the challenge requirements into explicit state transitions, keeping AI human-gated, preserving raw-to-verified lineage and making the local demo reliable.
