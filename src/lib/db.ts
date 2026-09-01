import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AuditEvent, Exception, Loan } from "./types";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "verity.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  borrower_id TEXT NOT NULL,
  loan_type TEXT NOT NULL,
  origination_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL,
  original_principal REAL NOT NULL,
  current_balance REAL NOT NULL,
  interest_rate REAL NOT NULL,
  term_months INTEGER NOT NULL,
  borrower_state TEXT NOT NULL,
  loan_purpose TEXT NOT NULL,
  credit_grade TEXT NOT NULL,
  employment_length TEXT NOT NULL,
  income_band TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  days_past_due INTEGER NOT NULL,
  servicer_name TEXT NOT NULL,
  last_payment_date TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  document_status TEXT NOT NULL,
  source_system TEXT NOT NULL,
  status TEXT NOT NULL,
  exception_count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verified_by TEXT,
  record_hash TEXT
);
CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL,
  borrower_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  field TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ai_recommendation TEXT,
  ai_confidence REAL,
  reviewer_comment TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  loan_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  raw_data TEXT
);
CREATE TABLE IF NOT EXISTS import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  raw_data TEXT NOT NULL,
  normalized_data TEXT NOT NULL,
  status TEXT NOT NULL,
  errors TEXT NOT NULL
);
`);

try { db.prepare("ALTER TABLE imports ADD COLUMN raw_data TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE exceptions ADD COLUMN reviewer_comment TEXT").run(); } catch {}

const loanColumns = ["id","borrowerId","loanType","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","borrowerState","loanPurpose","creditGrade","employmentLength","incomeBand","paymentStatus","daysPastDue","servicerName","lastPaymentDate","lastUpdatedAt","documentStatus","sourceSystem","status","exceptionCount","verifiedAt","verifiedBy","recordHash"];
const loanDbColumns = ["id","borrower_id","loan_type","origination_date","maturity_date","original_principal","current_balance","interest_rate","term_months","borrower_state","loan_purpose","credit_grade","employment_length","income_band","payment_status","days_past_due","servicer_name","last_payment_date","last_updated_at","document_status","source_system","status","exception_count","verified_at","verified_by","record_hash"];

export function seedIfEmpty() {}

export function hash(input: string) { return crypto.createHash("sha256").update(input).digest("hex"); }
export function getDb() { return db; }
export function listLoans(limit = 100) { return db.prepare("SELECT * FROM loans ORDER BY last_updated_at DESC LIMIT ?").all(limit).map(mapLoan) as Loan[]; }
export function getLoan(id: string) { const row = db.prepare("SELECT * FROM loans WHERE id = ?").get(id); return row ? mapLoan(row) as Loan : null; }
export function listExceptions(status?: string) {
  const sql = status
    ? "SELECT * FROM exceptions WHERE status = ? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC"
    : "SELECT * FROM exceptions ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC";
  return (status ? db.prepare(sql).all(status) : db.prepare(sql).all()).map(mapException) as Exception[];
}
export function getException(id: string) { const row = db.prepare("SELECT * FROM exceptions WHERE id = ?").get(id); return row ? mapException(row) as Exception : null; }
export function listAudit(loanId?: string) {
  const rows = loanId ? db.prepare("SELECT * FROM audit_events WHERE loan_id = ? ORDER BY created_at ASC").all(loanId) : db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 80").all();
  return rows.map(mapAudit) as AuditEvent[];
}
export function addAudit(loanId: string | undefined, action: string, actor: string, actorRole: string, metadata: Record<string, unknown>) {
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({ loanId, action, actor, actorRole, metadata, createdAt });
  const event: AuditEvent = { id: crypto.randomUUID(), loanId, action, actor, actorRole: actorRole as AuditEvent["actorRole"], metadata: JSON.stringify(metadata), createdAt, hash: hash(payload) };
  db.prepare("INSERT INTO audit_events (id,loan_id,action,actor,actor_role,metadata,created_at,hash) VALUES (?,?,?,?,?,?,?,?)").run(event.id,event.loanId,event.action,event.actor,event.actorRole,event.metadata,event.createdAt,event.hash);
  return event;
}
export function insertLoan(loan: Loan) {
  const values = loanColumns.map((key) => (loan as unknown as Record<string, unknown>)[key]);
  db.prepare(`INSERT INTO loans (${loanDbColumns.join(",")}) VALUES (${loanDbColumns.map(() => "?").join(",")})`).run(...values);
  return getLoan(loan.id);
}
export function updateLoan(id: string, patch: Partial<Loan>) {
  const entries = Object.entries(patch).filter(([key]) => loanColumns.includes(key) && key !== "id");
  if (!entries.length) return getLoan(id);
  const sql = entries.map(([key]) => `${loanDbColumns[loanColumns.indexOf(key)]} = ?`).join(", ");
  db.prepare(`UPDATE loans SET ${sql} WHERE id = ?`).run(...entries.map(([,value]) => value), id);
  return getLoan(id);
}
export function updateException(id: string, patch: Partial<Exception>) {
  const mapping: Record<string, string> = {
    aiRecommendation: "ai_recommendation",
    aiConfidence: "ai_confidence",
    reviewerComment: "reviewer_comment",
    status: "status"
  };
  const entries = Object.entries(patch).filter(([key]) => mapping[key]);
  if (!entries.length) return getException(id);
  const sql = entries.map(([key]) => `${mapping[key]} = ?`).join(", ");
  db.prepare(`UPDATE exceptions SET ${sql} WHERE id = ?`).run(
    ...entries.map(([, value]) => value),
    id
  );
  return getException(id);
}
export function createImport(filename: string, rowCount: number, successCount: number, failedCount: number, rawData: string) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO imports (id,filename,row_count,success_count,failed_count,created_at,raw_data) VALUES (?,?,?,?,?,?,?)").run(id,filename,rowCount,successCount,failedCount,new Date().toISOString(),rawData);
  return id;
}
export function addImportRow(importId: string, rowNumber: number, rawData: unknown, normalizedData: unknown, status: string, errors: string[]) {
  db.prepare("INSERT INTO import_rows (id,import_id,row_number,raw_data,normalized_data,status,errors) VALUES (?,?,?,?,?,?,?)").run(crypto.randomUUID(),importId,rowNumber,JSON.stringify(rawData),JSON.stringify(normalizedData),status,JSON.stringify(errors));
}
export function countLoansByBorrower(borrowerId: string) {
  return (db.prepare("SELECT COUNT(*) as n FROM loans WHERE borrower_id = ?").get(borrowerId) as { n: number }).n;
}
export function findFingerprintMatch(borrowerId: string, originalPrincipal: number, originationDate: string, excludeId: string) {
  const row = db.prepare("SELECT id FROM loans WHERE borrower_id = ? AND original_principal = ? AND origination_date = ? AND id != ?").get(borrowerId, originalPrincipal, originationDate, excludeId);
  return row ? (row as { id: string }).id : null;
}
export function summary() {
  const total = (db.prepare("SELECT COUNT(*) as n FROM loans").get() as {n:number}).n;
  const verified = (db.prepare("SELECT COUNT(*) as n FROM loans WHERE status='verified'").get() as {n:number}).n;
  const exceptions = (db.prepare("SELECT COUNT(*) as n FROM exceptions WHERE status='open'").get() as {n:number}).n;
  const critical = (db.prepare("SELECT COUNT(*) as n FROM exceptions WHERE status='open' AND severity='critical'").get() as {n:number}).n;
  const principal = (db.prepare("SELECT COALESCE(SUM(original_principal),0) as n FROM loans WHERE status = 'exception'").get() as {n:number}).n;
  const avgRate = (db.prepare("SELECT COALESCE(AVG(interest_rate),0) as n FROM loans").get() as {n:number}).n;
  const recent = listAudit().slice(0, 7);
  return { total, verified, exceptions, critical, principal, avgRate, quality: total ? Math.round((verified / total) * 100) : 0, recent };
}

function mapLoan(row: any): Loan { return { id:row.id, borrowerId:row.borrower_id, loanType:row.loan_type, originationDate:row.origination_date, maturityDate:row.maturity_date, originalPrincipal:Number(row.original_principal), currentBalance:Number(row.current_balance), interestRate:Number(row.interest_rate), termMonths:Number(row.term_months), borrowerState:row.borrower_state, loanPurpose:row.loan_purpose, creditGrade:row.credit_grade, employmentLength:row.employment_length, incomeBand:row.income_band, paymentStatus:row.payment_status, daysPastDue:Number(row.days_past_due), servicerName:row.servicer_name, lastPaymentDate:row.last_payment_date, lastUpdatedAt:row.last_updated_at, documentStatus:row.document_status, sourceSystem:row.source_system, status:row.status, exceptionCount:Number(row.exception_count), verifiedAt:row.verified_at || undefined, verifiedBy:row.verified_by || undefined, recordHash:row.record_hash || undefined }; }
function mapException(row: any): Exception {
  return {
    id: row.id,
    loanId: row.loan_id,
    borrowerId: row.borrower_id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    field: row.field,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    aiRecommendation: row.ai_recommendation || undefined,
    aiConfidence: row.ai_confidence == null ? undefined : Number(row.ai_confidence),
    reviewerComment: row.reviewer_comment || undefined
  };
}
function mapAudit(row: any): AuditEvent { return { id:row.id, loanId:row.loan_id || undefined, action:row.action, actor:row.actor, actorRole:row.actor_role, metadata:row.metadata, createdAt:row.created_at, hash:row.hash }; }

