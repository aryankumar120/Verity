import { NextResponse } from "next/server";
import Papa from "papaparse";
import { addAudit, addImportRow, createImport, getDb, getLoan, hash, insertLoan } from "@/lib/db";
import { validateLoan } from "@/lib/validators";
import type { Loan } from "@/lib/types";
import crypto from "node:crypto";

export const runtime = "nodejs";

function normalize(row: Record<string, string>, filename: string): Loan {
  const toNumber = (value: string | undefined): number => {
    if (value === undefined || value === null || value.trim() === "") {
      return 0;
    }

    const parsed = Number(value.trim());

    return Number.isFinite(parsed) ? parsed : 0;
  };

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

    lastUpdatedAt:
      String(row.last_updated_at ?? "").trim() ||
      new Date().toISOString(),

    documentStatus: String(row.document_status ?? "").trim(),

    sourceSystem: filename,

    status: "pending",

    exceptionCount: 0
  };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "CSV file is required" }, { status: 400 });

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) return NextResponse.json({ error: "CSV could not be parsed", details: parsed.errors }, { status: 400 });

  const importId = createImport(file.name, parsed.data.length, 0, 0, text);
  const errors: Array<{ row: number; loanId: string; issues: string[] }> = [];
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  let success = 0;
  let failed = 0;

  for (let i = 0; i < parsed.data.length; i += 1) {
    const row = parsed.data[i];
    const normalized = normalize(row, file.name);
    const missingId = !normalized.id;
    if (missingId) normalized.id = `IMPORT-${importId.slice(0, 8)}-${i + 2}`;
    const issues = validateLoan(normalized, `csv:${file.name}`);
    const rowIssues = [...issues];
    if (missingId) rowIssues.push({ type: "Missing loan ID", severity: "critical", message: "Loan ID is missing.", field: "loan_id", source: `csv:${file.name}` });
    const originalLoanId = normalized.id;
    const duplicateId = Boolean(normalized.id && (seenIds.has(normalized.id) || Boolean(getLoan(normalized.id))));
    if (duplicateId) rowIssues.push({ type: "Duplicate loan ID", severity: "critical", message: `Loan ID ${normalized.id} already exists in the upload or database.`, field: "loan_id", source: `csv:${file.name}` });
    const fingerprint = `${normalized.borrowerId}|${normalized.originalPrincipal}|${normalized.originationDate}`;
    if (normalized.borrowerId && normalized.originationDate && seenFingerprints.has(fingerprint)) rowIssues.push({ type: "Duplicate borrower combination", severity: "medium", message: "Borrower, amount and origination date combination repeats within this upload.", field: "borrower_id", source: `csv:${file.name}` });
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
    addImportRow(importId, i + 2, row, loan, status, rowIssues.map(x => x.message));

    for (const issue of rowIssues) {
      const exceptionId = crypto.randomUUID();
      getDb().prepare("INSERT INTO exceptions (id,loan_id,borrower_id,type,severity,message,field,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(exceptionId, loan.id, loan.borrowerId, issue.type, issue.severity, issue.message, issue.field, issue.source, "open", now);
    }

    addAudit(loan.id, "Loan record imported", "Aarav Mehta", "Data Operator", { importId, row: i + 2, status, exceptionCount: rowIssues.length });
    addAudit(loan.id, "Validation executed", "Validation Engine", "Data Operator", { importId, result: rowIssues.length ? "failed" : "passed", exceptionCount: rowIssues.length });
    if (rowIssues.length) {
      addAudit(loan.id, "Validation exceptions created", "Validation Engine", "Data Operator", { importId, exceptionCount: rowIssues.length });
      errors.push({ row: i + 2, loanId: loan.id, issues: rowIssues.map(x => x.message) });
      failed += 1;
    } else {
      success += 1;
    }
  }

  getDb().prepare("UPDATE imports SET success_count=?, failed_count=? WHERE id=?").run(success, failed, importId);
  addAudit(undefined, "File uploaded", "Aarav Mehta", "Data Operator", { importId, filename: file.name, rows: parsed.data.length, success, failed });

  return NextResponse.json({ importId, filename: file.name, rowCount: parsed.data.length, success, failed, errors });
}
