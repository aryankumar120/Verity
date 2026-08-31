import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { addAudit, getDb, getException, getLoan, hash, listExceptions, updateException, updateLoan } from "@/lib/db";
import { validateLoan } from "@/lib/validators";
import type { Loan } from "@/lib/types";

const editableFields = new Set(["loanType","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","borrowerState","loanPurpose","creditGrade","employmentLength","incomeBand","paymentStatus","daysPastDue","servicerName","lastPaymentDate","lastUpdatedAt","documentStatus"]);

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") || undefined;
  return NextResponse.json(listExceptions(status));
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const exception = getException(body.id);
  if (!exception) return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  if (!["approved", "rejected", "corrected"].includes(body.status)) return NextResponse.json({ error: "Invalid reviewer decision" }, { status: 400 });

  const loan = getLoan(exception.loanId);
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (exception.status !== "open") return NextResponse.json({ error: "Exception is no longer open" }, { status: 409 });

  const reviewer = typeof body.reviewer === "string" && body.reviewer.trim() ? body.reviewer.trim() : "Maya Chen";
  const changes = body.changes && typeof body.changes === "object" ? body.changes as Partial<Loan> : {};
  const invalidFields = Object.keys(changes).filter(key => !editableFields.has(key));
  if (invalidFields.length) return NextResponse.json({ error: "Fields are not editable", fields: invalidFields }, { status: 400 });

  const before = getLoan(exception.loanId);
  let current = before;
  if (Object.keys(changes).length) {
    current = updateLoan(exception.loanId, changes);
    if (!current) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    addAudit(exception.loanId, "Field edited", reviewer, "Reviewer", { exceptionId: exception.id, fields: Object.keys(changes), before, after: current });
  }

  const now = new Date().toISOString();
  if (body.status === "corrected") {
    const issues = validateLoan(current!, "review");
    const relatedOpen = listExceptions("open").filter(item => item.loanId === exception.loanId);
    const stillOpen = relatedOpen.filter(item => item.id !== exception.id);
    if (issues.length || stillOpen.length) {
      if (Object.keys(changes).length) {
        for (const item of relatedOpen) updateException(item.id, { status: "corrected" });
        for (const issue of issues) {
          getDb().prepare("INSERT INTO exceptions (id,loan_id,borrower_id,type,severity,message,field,source,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), exception.loanId, current!.borrowerId, issue.type, issue.severity, issue.message, issue.field, issue.source, "open", now);
        }
      }
      const openCount = issues.length + stillOpen.length;
      updateLoan(exception.loanId, { status: "exception", exceptionCount: openCount, verifiedAt: undefined, verifiedBy: undefined, recordHash: undefined });
      if (!Object.keys(changes).length && issues.length) return NextResponse.json({ error: "Correction requires a data change that resolves the validation issue", validationIssues: issues }, { status: 422 });
      updateException(exception.id, { status: "corrected" });
      addAudit(exception.loanId, "Reviewer correction recorded", reviewer, "Reviewer", { exceptionId: exception.id, validationIssues: issues.length, remainingExceptions: openCount });
      return NextResponse.json({ exception: getException(exception.id), loan: getLoan(exception.loanId), remainingExceptions: openCount, validationIssues: issues });
    }
  }

  const updatedException = updateException(exception.id, {
    status: body.status,
    aiRecommendation: body.aiRecommendation ?? exception.aiRecommendation,
    aiConfidence: body.aiConfidence ?? exception.aiConfidence
  });

  const remaining = listExceptions("open").filter(item => item.loanId === loan.id && item.id !== exception.id).length;
  if (body.status === "rejected") {
    updateLoan(loan.id, { status: "rejected", exceptionCount: remaining, verifiedAt: undefined, verifiedBy: undefined, recordHash: undefined });
  } else if (remaining === 0) {
    const canonical = getLoan(loan.id);
    const recordHash = canonical ? hash(JSON.stringify(canonical)) : undefined;
    updateLoan(loan.id, { status: "verified", exceptionCount: 0, verifiedAt: now, verifiedBy: reviewer, recordHash });
    addAudit(loan.id, "Verified record created", reviewer, "Reviewer", { decision: body.status, exceptionId: exception.id, recordHash, reviewerAttestation: body.status === "corrected" });
  } else {
    updateLoan(loan.id, { status: "exception", exceptionCount: remaining });
  }

  addAudit(loan.id, "Reviewer decision recorded", reviewer, "Reviewer", { exceptionId: exception.id, decision: body.status, aiRecommendation: updatedException?.aiRecommendation, aiConfidence: updatedException?.aiConfidence });
  return NextResponse.json({ exception: updatedException, loan: getLoan(loan.id), remainingExceptions: remaining });
}
