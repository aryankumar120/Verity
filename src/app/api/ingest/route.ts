import { NextResponse } from "next/server";
import Papa from "papaparse";
import { addAudit, addImportRow, countLoansByBorrower, createImport, findFingerprintMatch, getDb, getLoan, hash, insertLoan, listExceptions, updateLoan } from "@/lib/db";
import { validateLoan } from "@/lib/validators";
import { getSeverity } from "@/lib/rules";
import type { Loan } from "@/lib/types";
import crypto from "node:crypto";

export const runtime = "nodejs";

const PRIMARY_FIELDS = ["origination_date", "maturity_date", "original_principal", "term_months"];
const DOCUMENT_FIELDS = ["document_type", "document_reference"];

function detectFileKind(fields: string[]): "primary" | "servicer_update" | "document_manifest" {
  const has = (name: string) => fields.includes(name);
  if (PRIMARY_FIELDS.every(has)) return "primary";
  if (DOCUMENT_FIELDS.every(has)) return "document_manifest";
  if (has("current_balance") || has("interest_rate") || has("payment_status")) return "servicer_update";
  return "primary";
}

function toNumber(value: string | undefined): number {
  if (value === undefined || value === null || value.trim() === "") return 0;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(row: Record<string, string>, filename: string): Loan {
  return {
    id: String(row.loan_id ?? "").trim(),
    borrowerId: String(row.borrower_id ?? "").trim(),
    loanType: String(row.loan_type ?? "").trim(),
    originationDate: String(row.origination_date ?? "").trim(),
    maturityDate: String(row.maturity_date ?? "").trim(),
    originalPrincipal: toNumber(row.original_principal),
    currentBalance: toNumber(row.current_balance),
    interestRate: toNumber(row.interest_rate),
    termMonths: toNumber(row.term_months),
    borrowerState: String(row.borrower_state ?? "").trim().toUpperCase(),
    loanPurpose: String(row.loan_purpose ?? "").trim(),
    creditGrade: String(row.credit_grade ?? "").trim(),
    employmentLength: String(row.employment_length ?? "").trim(),
    incomeBand: String(row.income_band ?? "").trim(),
    paymentStatus: String(row.payment_status ?? "").trim(),
    daysPastDue: toNumber(row.days_past_due),
    servicerName: String(row.servicer_name ?? "").trim(),
    lastPaymentDate: String(row.last_payment_date ?? "").trim(),
    lastUpdatedAt: String(row.last_updated_at ?? "").trim() || new Date().toISOString(),
    documentStatus: String(row.document_status ?? "").trim(),
    sourceSystem: filename,
    status: "pending",
    exceptionCount: 0
  };
}

function insertException(loanId: string, borrowerId: string, type: string, severity: "critical" | "high" | "medium" | "low", message: string, field: string, source: string, createdAt: string) {
  getDb().prepare("INSERT INTO exceptions (id,loan_id,borrower_id,type,severity,message,field,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), loanId, borrowerId, type, severity, message, field, source, "open", createdAt);
}

function openExceptionCount(loanId: string) {
  return listExceptions("open").filter(item => item.loanId === loanId).length;
}

function ingestPrimary(rows: Record<string, string>[], filename: string, importId: string) {
  const errors: Array<{ row: number; loanId: string; issues: string[] }> = [];
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const insertedBorrowers = new Set<string>();
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const normalized = normalize(row, filename);
    const missingId = !normalized.id;
    if (missingId) normalized.id = `IMPORT-${importId.slice(0, 8)}-${i + 2}`;
    const issues = validateLoan(normalized, `csv:${filename}`);
    const rowIssues = [...issues];
    if (missingId) rowIssues.push({ type: "Missing loan ID", severity: getSeverity("required_fields", "critical"), message: "Loan ID is missing.", field: "loan_id", source: `csv:${filename}` });
    const originalLoanId = normalized.id;
    const duplicateId = Boolean(normalized.id && (seenIds.has(normalized.id) || Boolean(getLoan(normalized.id))));
    if (duplicateId) rowIssues.push({ type: "Duplicate loan ID", severity: getSeverity("duplicate_loan_id", "critical"), message: `Loan ID ${normalized.id} already exists in the upload or database.`, field: "loan_id", source: `csv:${filename}` });
    const fingerprint = `${normalized.borrowerId}|${normalized.originalPrincipal}|${normalized.originationDate}`;
    const crossFileMatch = normalized.borrowerId && normalized.originationDate ? findFingerprintMatch(normalized.borrowerId, normalized.originalPrincipal, normalized.originationDate, normalized.id) : null;
    if (normalized.borrowerId && normalized.originationDate && (seenFingerprints.has(fingerprint) || crossFileMatch)) rowIssues.push({ type: "Duplicate borrower combination", severity: getSeverity("duplicate_borrower_combination", "medium"), message: "Borrower, amount and origination date combination repeats within the upload or existing records.", field: "borrower_id", source: `csv:${filename}` });
    if (duplicateId) normalized.id = `IMPORT-${importId.slice(0, 8)}-${i + 2}`;
    if (normalized.id) seenIds.add(originalLoanId || normalized.id);
    if (fingerprint !== "||") seenFingerprints.add(fingerprint);

    const status = rowIssues.length ? "exception" : "verified";
    const now = new Date().toISOString();
    const loan: Loan = {
      ...normalized,
      status,
      exceptionCount: rowIssues.length,
      verifiedAt: status === "verified" ? now : undefined,
      verifiedBy: status === "verified" ? "Validation Engine" : undefined,
      recordHash: status === "verified" ? hash(JSON.stringify(normalized)) : undefined
    };
    insertLoan(loan);
    if (loan.borrowerId) insertedBorrowers.add(loan.borrowerId);
    addImportRow(importId, i + 2, row, loan, status, rowIssues.map(x => x.message));

    for (const issue of rowIssues) insertException(loan.id, loan.borrowerId, issue.type, issue.severity, issue.message, issue.field, issue.source, now);

    addAudit(loan.id, "Loan record imported", "Aarav Mehta", "Data Operator", { importId, row: i + 2, status, exceptionCount: rowIssues.length });
    addAudit(loan.id, "Validation executed", "Validation Engine", "Data Operator", { importId, result: rowIssues.length ? "failed" : "passed", exceptionCount: rowIssues.length });
    if (rowIssues.length) {
      addAudit(loan.id, "Exception created", "Validation Engine", "Data Operator", { importId, exceptionCount: rowIssues.length });
      errors.push({ row: i + 2, loanId: loan.id, issues: rowIssues.map(x => x.message) });
      failed += 1;
    } else {
      success += 1;
    }
  }

  const repeatedThreshold = 3;
  for (const borrowerId of insertedBorrowers) {
    if (countLoansByBorrower(borrowerId) < repeatedThreshold) continue;
    const loansForBorrower = (getDb().prepare("SELECT id FROM loans WHERE borrower_id = ?").all(borrowerId) as { id: string }[]).map(row => row.id);
    const now = new Date().toISOString();
    for (const loanId of loansForBorrower) {
      const alreadyFlagged = listExceptions("open").some(item => item.loanId === loanId && item.type === "Repeated borrower record");
      if (alreadyFlagged) continue;
      const loan = getLoan(loanId);
      if (!loan) continue;
      insertException(loanId, borrowerId, "Repeated borrower record", getSeverity("repeated_borrower", "medium"), `Borrower ${borrowerId} appears on ${loansForBorrower.length} loan records, which is unusually high and should be reviewed.`, "borrower_id", `csv:${filename}`, now);
      addAudit(loanId, "Exception created", "Validation Engine", "Data Operator", { importId, type: "Repeated borrower record" });
      updateLoan(loanId, { status: "exception", exceptionCount: openExceptionCount(loanId), verifiedAt: undefined, verifiedBy: undefined, recordHash: undefined });
    }
  }

  return { success, failed, errors };
}

const SERVICER_FIELD_MAP: Record<string, keyof Loan> = {
  current_balance: "currentBalance",
  interest_rate: "interestRate",
  payment_status: "paymentStatus",
  days_past_due: "daysPastDue",
  servicer_name: "servicerName",
  document_status: "documentStatus"
};

const DOCUMENT_FIELD_MAP: Record<string, keyof Loan> = {
  document_status: "documentStatus"
};

function valuesConflict(field: keyof Loan, existing: unknown, incoming: unknown) {
  if (field === "currentBalance" || field === "interestRate" || field === "daysPastDue") {
    const a = Number(existing);
    const b = Number(incoming);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) > 0.01;
  }
  return String(existing ?? "").trim().toLowerCase() !== String(incoming ?? "").trim().toLowerCase();
}

function ingestSecondary(rows: Record<string, string>[], filename: string, importId: string, kind: "servicer_update" | "document_manifest") {
  const fieldMap = kind === "servicer_update" ? SERVICER_FIELD_MAP : DOCUMENT_FIELD_MAP;
  const errors: Array<{ row: number; loanId: string; issues: string[] }> = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const loanId = String(row.loan_id ?? "").trim();
    if (!loanId) {
      errors.push({ row: i + 2, loanId: "", issues: ["Loan ID is missing from the update record."] });
      failed += 1;
      continue;
    }
    const loan = getLoan(loanId);
    if (!loan) {
      errors.push({ row: i + 2, loanId, issues: ["Loan ID was not found in the verified population; update skipped."] });
      failed += 1;
      continue;
    }

    const now = new Date().toISOString();
    let conflictCount = 0;
    for (const [column, canonicalField] of Object.entries(fieldMap)) {
      const rawValue = row[column];
      if (rawValue === undefined || String(rawValue).trim() === "") continue;
      const incoming = ["currentBalance", "interestRate", "daysPastDue"].includes(canonicalField) ? toNumber(rawValue) : String(rawValue).trim();
      const existing = loan[canonicalField];
      if (valuesConflict(canonicalField, existing, incoming)) {
        conflictCount += 1;
        insertException(
          loan.id,
          loan.borrowerId,
          "Conflicting values",
          getSeverity("source_conflict", "high"),
          `${filename} reports ${column} as "${incoming}" while the current record shows "${existing}". Values conflict across sources and require reviewer resolution.`,
          canonicalField,
          `csv:${filename}`,
          now
        );
      }
    }

    addImportRow(importId, i + 2, row, { loanId, fields: Object.keys(fieldMap) }, conflictCount ? "conflict" : "matched", conflictCount ? [`${conflictCount} conflicting field(s) detected against ${filename}`] : []);

    if (conflictCount) {
      addAudit(loan.id, "Exception created", "Validation Engine", "Data Operator", { importId, source: filename, exceptionCount: conflictCount });
      updateLoan(loan.id, { status: "exception", exceptionCount: openExceptionCount(loan.id), verifiedAt: undefined, verifiedBy: undefined, recordHash: undefined });
      errors.push({ row: i + 2, loanId, issues: [`${conflictCount} conflicting field(s) detected against ${filename}`] });
      failed += 1;
    } else {
      success += 1;
    }

    addAudit(loan.id, "Loan record imported", "Aarav Mehta", "Data Operator", { importId, row: i + 2, source: filename, result: conflictCount ? "conflict" : "matched" });
  }

  return { success, failed, errors };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "CSV file is required" }, { status: 400 });

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) return NextResponse.json({ error: "CSV could not be parsed", details: parsed.errors }, { status: 400 });

  const fields = parsed.meta.fields || [];
  const kind = detectFileKind(fields);
  const importId = createImport(file.name, parsed.data.length, 0, 0, text);

  const result = kind === "primary"
    ? ingestPrimary(parsed.data, file.name, importId)
    : ingestSecondary(parsed.data, file.name, importId, kind);

  getDb().prepare("UPDATE imports SET success_count=?, failed_count=? WHERE id=?").run(result.success, result.failed, importId);
  addAudit(undefined, "File uploaded", "Aarav Mehta", "Data Operator", { importId, filename: file.name, rows: parsed.data.length, kind, success: result.success, failed: result.failed });

  return NextResponse.json({ importId, filename: file.name, fileKind: kind, rowCount: parsed.data.length, success: result.success, failed: result.failed, errors: result.errors });
}
