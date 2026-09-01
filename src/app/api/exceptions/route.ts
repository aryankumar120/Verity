import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  addAudit,
  getDb,
  getException,
  getLoan,
  hash,
  listExceptions,
  updateException,
  updateLoan
} from "@/lib/db";
import { validateLoan } from "@/lib/validators";
import type { Loan } from "@/lib/types";

export const runtime = "nodejs";

const editableFields = new Set([
  "loanType",
  "originationDate",
  "maturityDate",
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "borrowerState",
  "loanPurpose",
  "creditGrade",
  "employmentLength",
  "incomeBand",
  "paymentStatus",
  "daysPastDue",
  "servicerName",
  "lastPaymentDate",
  "lastUpdatedAt",
  "documentStatus"
]);

const fieldMap: Record<string, keyof Loan> = {
  loan_id: "id",
  borrower_id: "borrowerId",
  loan_type: "loanType",
  origination_date: "originationDate",
  maturity_date: "maturityDate",
  original_principal: "originalPrincipal",
  current_balance: "currentBalance",
  interest_rate: "interestRate",
  term_months: "termMonths",
  borrower_state: "borrowerState",
  loan_purpose: "loanPurpose",
  credit_grade: "creditGrade",
  employment_length: "employmentLength",
  income_band: "incomeBand",
  payment_status: "paymentStatus",
  days_past_due: "daysPastDue",
  servicer_name: "servicerName",
  last_payment_date: "lastPaymentDate",
  last_updated_at: "lastUpdatedAt",
  document_status: "documentStatus"
};

function canonicalFieldName(field: string) {
  return String(fieldMap[field] || field);
}

function openLoanExceptions(loanId: string) {
  return listExceptions("open").filter(item => item.loanId === loanId);
}

function createValidationException(loan: Loan, issue: ReturnType<typeof validateLoan>[number], createdAt: string) {
  getDb()
    .prepare(
      `INSERT INTO exceptions
       (id, loan_id, borrower_id, type, severity, message, field, source, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      crypto.randomUUID(),
      loan.id,
      loan.borrowerId,
      issue.type,
      issue.severity,
      issue.message,
      issue.field,
      issue.source,
      "open",
      createdAt
    );
}

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") || undefined;
  return NextResponse.json(listExceptions(status));
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const exception = getException(body.id);

    if (!exception) {
      return NextResponse.json({ error: "Exception not found" }, { status: 404 });
    }

    if (!["approved", "rejected", "corrected"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid reviewer decision" }, { status: 400 });
    }

    if (exception.status !== "open") {
      return NextResponse.json({ error: "Exception is no longer open" }, { status: 409 });
    }

    const loan = getLoan(exception.loanId);
    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    const reviewer =
      typeof body.reviewer === "string" && body.reviewer.trim()
        ? body.reviewer.trim()
        : "Maya Chen";

    const changes =
      body.changes && typeof body.changes === "object"
        ? (body.changes as Partial<Loan>)
        : {};

    const invalidFields = Object.keys(changes).filter(
      key => !editableFields.has(key)
    );

    if (invalidFields.length) {
      return NextResponse.json(
        { error: "Fields are not editable", fields: invalidFields },
        { status: 400 }
      );
    }

    const reviewerComment =
      typeof body.reviewerComment === "string"
        ? body.reviewerComment.trim()
        : "";

    const now = new Date().toISOString();

    if (reviewerComment) {
      updateException(exception.id, { reviewerComment });
      addAudit(
        exception.loanId,
        "Reviewer comment added",
        reviewer,
        "Reviewer",
        { exceptionId: exception.id, comment: reviewerComment }
      );
    }

    if (body.status === "corrected") {
      if (!Object.keys(changes).length) {
        return NextResponse.json(
          {
            error:
              "Correction requires a data change that resolves the validation issue."
          },
          { status: 422 }
        );
      }

      const before = getLoan(exception.loanId);
      const updatedLoan = updateLoan(exception.loanId, changes);

      if (!updatedLoan) {
        return NextResponse.json({ error: "Loan not found" }, { status: 404 });
      }

      addAudit(
        exception.loanId,
        "Field edited",
        reviewer,
        "Reviewer",
        {
          exceptionId: exception.id,
          fields: Object.keys(changes),
          before,
          after: updatedLoan
        }
      );

      const issues = validateLoan(updatedLoan, `review:${exception.id}`);
      const affectedFields = new Set(
        Object.keys(changes).map(canonicalFieldName)
      );

      const currentOpen = openLoanExceptions(exception.loanId);

      for (const item of currentOpen) {
        if (affectedFields.has(canonicalFieldName(item.field))) {
          const matchingIssue = issues.some(
            issue =>
              canonicalFieldName(issue.field) === canonicalFieldName(item.field) &&
              issue.type === item.type
          );

          if (!matchingIssue) {
            updateException(item.id, { status: "corrected" });
          }
        }
      }

      const openAfterResolution = openLoanExceptions(exception.loanId);
      const existingKeys = new Set(
        openAfterResolution.map(
          item => `${canonicalFieldName(item.field)}|${item.type}`
        )
      );

      for (const issue of issues) {
        const key = `${canonicalFieldName(issue.field)}|${issue.type}`;
        if (!existingKeys.has(key)) {
          createValidationException(updatedLoan, issue, now);
          existingKeys.add(key);
        }
      }

      const remaining = openLoanExceptions(exception.loanId).length;

      if (remaining === 0) {
        const canonical = getLoan(exception.loanId);
        const recordHash = canonical
          ? hash(JSON.stringify(canonical))
          : undefined;

        updateLoan(exception.loanId, {
          status: "verified",
          exceptionCount: 0,
          verifiedAt: now,
          verifiedBy: reviewer,
          recordHash
        });

        addAudit(
          exception.loanId,
          "Verified record created",
          reviewer,
          "Reviewer",
          {
            decision: "corrected",
            exceptionId: exception.id,
            recordHash
          }
        );
      } else {
        updateLoan(exception.loanId, {
          status: "exception",
          exceptionCount: remaining,
          verifiedAt: undefined,
          verifiedBy: undefined,
          recordHash: undefined
        });
      }

      addAudit(
        exception.loanId,
        "Reviewer correction recorded",
        reviewer,
        "Reviewer",
        {
          exceptionId: exception.id,
          fields: Object.keys(changes),
          validationIssues: issues.length,
          remainingExceptions: remaining
        }
      );

      return NextResponse.json({
        exception: getException(exception.id),
        loan: getLoan(exception.loanId),
        remainingExceptions: remaining,
        validationIssues: issues
      });
    }

    const updatedException = updateException(exception.id, {
      status: body.status,
      aiRecommendation:
        body.aiRecommendation ?? exception.aiRecommendation,
      aiConfidence:
        body.aiConfidence ?? exception.aiConfidence
    });

    const remaining = openLoanExceptions(loan.id).length;
    const hasRejectedException = listExceptions("rejected").some(
      item => item.loanId === loan.id
    );

    if (body.status === "rejected") {
      updateLoan(loan.id, {
        status: "rejected",
        exceptionCount: remaining,
        verifiedAt: undefined,
        verifiedBy: undefined,
        recordHash: undefined
      });

      addAudit(
        loan.id,
        "Loan rejected",
        reviewer,
        "Reviewer",
        {
          exceptionId: exception.id,
          decision: "rejected"
        }
      );
    } else if (remaining === 0 && !hasRejectedException) {
      const canonical = getLoan(loan.id);
      const recordHash = canonical
        ? hash(JSON.stringify(canonical))
        : undefined;

      updateLoan(loan.id, {
        status: "verified",
        exceptionCount: 0,
        verifiedAt: now,
        verifiedBy: reviewer,
        recordHash
      });

      addAudit(
        loan.id,
        "Verified record created",
        reviewer,
        "Reviewer",
        {
          decision: "approved",
          exceptionId: exception.id,
          recordHash
        }
      );
    } else {
      updateLoan(loan.id, {
        status: "exception",
        exceptionCount: remaining
      });
    }

    addAudit(
      loan.id,
      "Reviewer decision recorded",
      reviewer,
      "Reviewer",
      {
        exceptionId: exception.id,
        decision: body.status,
        aiRecommendation: updatedException?.aiRecommendation,
        aiConfidence: updatedException?.aiConfidence
      }
    );

    return NextResponse.json({
      exception: updatedException,
      loan: getLoan(loan.id),
      remainingExceptions: remaining
    });
  } catch (error) {
    console.error("Reviewer action failed:", error);
    return NextResponse.json(
      {
        error: "Reviewer action failed",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
