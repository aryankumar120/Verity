# Architecture Note

## System shape

Verity is a Next.js full-stack application. The browser renders the existing workflow console while Next.js route handlers provide the backend API. SQLite is the persistence layer for local judging.

Browser → Existing Console Workflow → Next.js Route Handlers → Validation / AI / Persistence → SQLite

The data lifecycle is persisted at every material transition. Uploaded rows are retained as raw import data, normalized into the canonical schema, validated, routed to exceptions when necessary, reviewed by a human, and either verified or rejected.

## Data model

`loans` stores canonical normalized loan records, lifecycle status and verification metadata.

`exceptions` stores validation exceptions, severity, source, field, status and optional AI recommendation.

`audit_events` stores material workflow actions with actor, role, timestamp, metadata and SHA-256 event hash.

`imports` stores file-level ingestion metrics and raw uploaded CSV content.

`import_rows` stores each source row, its normalized representation, processing status and validation errors. This preserves row-level lineage even when the canonical loan cannot be verified.

## Workflow lifecycle

1. Data Operator uploads a CSV.
2. The backend parses and normalizes each row.
3. Raw file and row-level lineage are persisted.
4. Deterministic validation runs against the normalized record.
5. Clean rows are marked verified by the validation engine.
6. Invalid rows are persisted as loans with `exception` status and their validation failures are stored as open exceptions.
7. Reviewer opens an exception and can request an AI review.
8. Groq returns an advisory explanation and recommendation when configured. A deterministic local reviewer is used when Groq is unavailable.
9. AI output is persisted as recommendation metadata and does not mutate the loan.
10. Reviewer records an explicit approve, corrected or rejected decision.
11. When the reviewer resolves the final open exception, the loan becomes verified and receives verification metadata and a SHA-256 record hash. Rejected records remain unavailable to the verified-record API.
12. Data Consumers receive only verified loans and can inspect their audit history and export them.

## Validation

The validation engine checks required fields, parseable dates, date ordering, negative principal and balance, balance greater than principal, interest-rate range, state codes, payment-status consistency, document availability and record freshness. Ingestion also detects duplicate loan IDs and repeated borrower, amount and origination combinations within the uploaded file.

## API design

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

The APIs are stateful and read from the same SQLite records that drive the console. This keeps ingestion, reviewer decisions, verified records and audit history consistent.

## AI integration

The application uses the Groq API through its OpenAI-compatible HTTP interface when `GROQ_API_KEY` is configured. The model is configurable through `GROQ_MODEL`. The default is `openai/gpt-oss-120b`.

The prompt instructs the model to return structured JSON containing a summary, recommendation, confidence and validation factors. The server clamps confidence to the valid range and records the recommendation in the exception and audit trail.

The AI layer is advisory and human-gated. It cannot approve, reject, edit or verify a loan by itself.

## Audit strategy

Every material action creates an audit event. Events contain an identifier, loan, actor, role, metadata, timestamp and SHA-256 hash. Verified records additionally carry a record hash representing the canonical record state at verification time.

## Trade-offs

SQLite was selected because the challenge permits it and local judging benefits from minimal infrastructure. A production deployment could move the schema to PostgreSQL.

The deterministic AI fallback prioritizes demo reliability. A production implementation would add provider health telemetry, prompt versioning, structured-output validation and stronger identity controls.

The role selector is intentionally lightweight because production-grade authentication is outside the challenge scope.
