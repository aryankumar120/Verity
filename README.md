# Loan Data Verification Copilot

Verity is an AI-assisted full-stack console for turning messy loan records into validated, traceable and trusted data for the Intain Campus FinTech Challenge 2026 Full Stack Track.

## What the workflow does

The application starts with an empty workspace and follows a real persisted lifecycle rather than a presentation-only demo. The `npm run seed` command resets the local database to that empty state.

```text
Data Operator
  Upload CSV
      ↓
Parse + Normalize
      ↓
Validate
      ↓
Create persisted exceptions
      ↓
Reviewer
  Review exception
      ↓
Grok AI explanation + recommendation
      ↓
Human approve / correct / reject
      ↓
Verified or rejected loan state
      ↓
Data Consumer
  Verified records + audit trail + export + API
```

## Key capabilities

- CSV ingestion with raw file and row lineage
- Automatic file-type detection: a primary loan tape, a servicer update, or a document manifest are each handled correctly instead of being forced through one shape
- Canonical loan normalization
- Deterministic validation for required fields, dates, balances, rates, payment consistency, state codes, documents and stale records, with severities sourced from `data/validation_rules.json` so the rule set is genuinely configurable rather than hardcoded
- Cross-source conflict detection: uploading `servicer_update.csv` or `document_manifest.csv` compares each field against the existing verified/normalized loan and raises a reviewer exception when sources disagree, instead of corrupting the primary dataset
- Cross-import duplicate and repeated-borrower detection that checks against the whole database, not only the current file
- Persisted exception queue generated from the uploaded file
- Human-gated AI review
- Groq API integration (`openai/gpt-oss-120b` by default) with a deterministic local fallback
- Reviewer approval, correction and rejection state transitions
- Backend field-edit API with revalidation
- Verified record creation with SHA-256 hashing
- Chronological audit trail for material workflow events
- Verified records API and CSV export
- Role-aware demo workflow for Data Operator, Reviewer and Data Consumer
- Existing responsive fintech UI preserved without redesign

## Data package

The `data/` directory includes a complete synthetic competition-style package aligned to the organizer specification:

- `loan_tape.csv`: 1,000 primary loan records with clean rows and intentional data-quality issues.
- `servicer_update.csv`: 250 second-source servicing updates containing partial and conflicting values for reviewer comparison.
- `document_manifest.csv`: document availability records mapped to the primary loan population.
- `validation_rules.json`: configurable rules covering the required validation themes.
- `users.json`: mock Data Operator, Reviewer and Data Consumer identities.
- `expected_exception_sample.csv`: representative known exceptions for demo orientation.
- `sample-loan-tape.csv`: four-row compact fixture for quick smoke testing.

For the competition-style demo, start from an empty database with `npm run seed`, then upload `data/loan_tape.csv`. The four-row sample remains available when a very fast local smoke test is useful. After the primary tape is loaded, uploading `data/servicer_update.csv` and `data/document_manifest.csv` demonstrates cross-source conflict detection against the already-verified population.

## Tech stack

Next.js 15, React 19, TypeScript, SQLite, better-sqlite3, Papa Parse, Framer Motion and Lucide React.

Next.js route handlers provide the backend API and SQLite provides local persistence.

## AI configuration

The AI review endpoint uses Groq when `GROQ_API_KEY` is available. Groq provides an OpenAI-compatible API at `https://api.groq.com/openai/v1`. https://console.groq.com/docs/openai

Create a local `.env.local` file:

```bash
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
NEXT_PUBLIC_APP_NAME=Verity
```

If no Groq key is configured, the application automatically uses its deterministic local review engine so the complete workflow remains runnable.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run build
npm start
```

Reset the local database:

```bash
npm run seed
```

Run automated tests:

```bash
npm test
```

## Demo roles

- Data Operator: Aarav Mehta. Uploads the loan tape and observes ingestion, validation and exception creation.
- Reviewer: Maya Chen. Receives the persisted open exceptions, runs AI review and records the human decision.
- Data Consumer: Daniel Brooks. Sees only verified records and can inspect audit history, export and APIs.

Changing the role switches the existing console into the appropriate workflow while preserving the same visual system. The role switcher is a lightweight judging workflow rather than production authentication, consistent with the challenge scope.

## Five-minute demo

1. Reset the workspace with `npm run seed` and select Data Operator.
2. Upload `data/sample-loan-tape.csv`.
3. Show the live import totals and newly created exceptions.
4. Switch to Reviewer and open an exception generated by that upload.
5. Run AI Review and show the recommendation separately from the human decision.
6. Approve or reject the exception, or use the correction API with a field change when demonstrating correction.
7. Switch to Data Consumer and open Verified Records.
8. Show the verified loan and its audit history.
9. Show the verified-loans API response and export.

## API

```text
GET   /api/summary
GET   /api/loans
GET   /api/loans/:id
PATCH /api/loans/:id
GET   /api/exceptions
PATCH /api/exceptions
POST  /api/ingest
POST  /api/ai/review
GET   /api/verified-loans
GET   /api/verified-loans/:id
GET   /api/audit
GET   /api/audit/:loanId
```

`PATCH /api/loans/:id` accepts only approved editable loan fields, re-runs validation and either creates fresh exceptions or verifies the corrected record.

## Assignment mapping

- Module A: ingestion, normalization, raw-file lineage, import summary and automatic detection of loan tape vs. servicer update vs. document manifest files
- Module B: deterministic validation and exception creation, driven by `data/validation_rules.json`
- Module C: persisted exception queue and reviewer decisions
- Module D: AI explanation, recommendation, confidence and human control
- Module E: canonical verified record, reviewer, timestamp and hash
- Module F: audit events for upload, import, validation, exception, AI, edits, decisions and verification
- Module G: operator, reviewer and consumer workflow through the existing console
- Module H: verified records and audit APIs

## AI controls

AI output is advisory. It never silently changes loan data. AI recommendations are stored separately from reviewer decisions and logged with model metadata, confidence and a representative prompt. Reviewer actions are the authority for state transitions.

## Agentic development log

See `AI-DEVELOPMENT-LOG.md` for development prompts, human review notes, rejected AI outputs and lessons learned.

## Architecture

See `ARCHITECTURE.md` for the system design, lifecycle, data model, API contract, AI controls, audit strategy and trade-offs.
