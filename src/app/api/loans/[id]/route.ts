import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { addAudit, getDb, getLoan, hash, listExceptions, updateException, updateLoan } from "@/lib/db";
import { validateLoan } from "@/lib/validators";
import type { Loan } from "@/lib/types";

const editableFields = new Set(["loanType","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","borrowerState","loanPurpose","creditGrade","employmentLength","incomeBand","paymentStatus","daysPastDue","servicerName","lastPaymentDate","lastUpdatedAt","documentStatus"]);

export async function GET(_: Request, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const loan = getLoan(id);
  return loan ? NextResponse.json(loan) : NextResponse.json({ error: "Loan not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const patch = await request.json() as Partial<Loan>;
  const invalidFields = Object.keys(patch).filter(key => !editableFields.has(key));
  if (invalidFields.length) return NextResponse.json({ error: "Fields are not editable", fields: invalidFields }, { status: 400 });
  const before = getLoan(id);
  if (!before) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  const loan = updateLoan(id, patch);
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  const issues = validateLoan(loan, "review");
  const existing = listExceptions("open").filter(exception => exception.loanId === id);
  for (const exception of existing) updateException(exception.id, { status: "corrected" });
  const now = new Date().toISOString();
  if (issues.length) {
    for (const issue of issues) {
      getDb().prepare("INSERT INTO exceptions (id,loan_id,borrower_id,type,severity,message,field,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), id, loan.borrowerId, issue.type, issue.severity, issue.message, issue.field, issue.source, "open", now);
    }
    updateLoan(id, { status: "exception", exceptionCount: issues.length, verifiedAt: undefined, verifiedBy: undefined, recordHash: undefined });
  } else {
    const canonical = getLoan(id);
    updateLoan(id, { status: "verified", exceptionCount: 0, verifiedAt: now, verifiedBy: "Maya Chen", recordHash: canonical ? hash(JSON.stringify(canonical)) : undefined });
    addAudit(id, "Verified record created", "Maya Chen", "Reviewer", { reason: "Corrected record passed validation" });
  }
  addAudit(id, "Field edited", "Maya Chen", "Reviewer", { fields: Object.keys(patch), before, after: getLoan(id), validationIssues: issues.length });
  return NextResponse.json({ loan: getLoan(id), validationIssues: issues });
}
