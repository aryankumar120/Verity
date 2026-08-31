import type { Loan, Exception } from "./types";

const states = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]);

export function validateLoan(loan: Partial<Loan>, source = "upload") {
  const issues: Omit<Exception,"id"|"createdAt"|"status"|"loanId"|"borrowerId">[] = [];
  const required = ["id","borrowerId","loanType","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","borrowerState","paymentStatus","documentStatus"] as const;
  for (const field of required) if (loan[field] === undefined || loan[field] === null || loan[field] === "") issues.push({type:"Missing required field",severity:"critical",message:`Required field ${field} is missing.`,field,source});
  const numericFields = [
    ["originalPrincipal", loan.originalPrincipal],
    ["currentBalance", loan.currentBalance],
    ["interestRate", loan.interestRate],
    ["termMonths", loan.termMonths],
    ["daysPastDue", loan.daysPastDue]
  ] as const;
  for (const [field, value] of numericFields) {
    if (value !== undefined && value !== null && !Number.isFinite(value)) {
      issues.push({type:"Invalid numeric value",severity:"high",message:`Field ${field} must contain a valid numeric value.`,field,source});
    }
  }
  const orig = loan.originationDate ? new Date(loan.originationDate) : null;
  const maturity = loan.maturityDate ? new Date(loan.maturityDate) : null;
  if (orig && Number.isNaN(orig.getTime())) issues.push({type:"Invalid date",severity:"high",message:"Origination date is not parseable.",field:"originationDate",source});
  if (maturity && Number.isNaN(maturity.getTime())) issues.push({type:"Invalid date",severity:"high",message:"Maturity date is not parseable.",field:"maturityDate",source});
  if (orig && maturity && !Number.isNaN(orig.getTime()) && !Number.isNaN(maturity.getTime()) && maturity <= orig) issues.push({type:"Date integrity",severity:"critical",message:"Maturity date must occur after origination date.",field:"maturityDate",source});
  if (Number(loan.originalPrincipal) < 0) issues.push({type:"Negative principal",severity:"critical",message:"Original principal cannot be negative.",field:"originalPrincipal",source});
  if (Number(loan.currentBalance) < 0) issues.push({type:"Negative balance",severity:"critical",message:"Current balance cannot be negative.",field:"currentBalance",source});
  if (Number(loan.currentBalance) > Number(loan.originalPrincipal)) issues.push({type:"Balance integrity",severity:"high",message:"Current balance cannot exceed original principal.",field:"currentBalance",source});
  if (Number(loan.interestRate) < 0 || Number(loan.interestRate) > 18) issues.push({type:"Rate outlier",severity:"high",message:"Interest rate should be between 0% and 18%.",field:"interestRate",source});
  if (loan.borrowerState && !states.has(String(loan.borrowerState).toUpperCase())) issues.push({type:"Invalid state",severity:"medium",message:"Borrower state code is invalid.",field:"borrowerState",source});
  if (loan.paymentStatus === "Closed" && Number(loan.currentBalance) > 0) issues.push({type:"Payment mismatch",severity:"high",message:"Closed loans should not carry a positive balance.",field:"paymentStatus",source});
  if (loan.paymentStatus === "Current" && Number(loan.daysPastDue) > 0) issues.push({type:"Payment mismatch",severity:"high",message:"Current payment status conflicts with days past due.",field:"daysPastDue",source});
  if (!loan.documentStatus || loan.documentStatus === "Missing") issues.push({type:"Missing document",severity:"medium",message:"Required document status is missing or incomplete.",field:"documentStatus",source});
  const updated = loan.lastUpdatedAt ? new Date(loan.lastUpdatedAt) : null;
  if (updated && !Number.isNaN(updated.getTime()) && Date.now() - updated.getTime() > 180 * 24 * 60 * 60 * 1000) issues.push({type:"Stale record",severity:"low",message:"Record has not been updated within the expected freshness window.",field:"lastUpdatedAt",source});
  return issues;
}
