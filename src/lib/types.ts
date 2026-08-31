export type Role = "Data Operator" | "Reviewer" | "Data Consumer";
export type LoanStatus = "verified" | "exception" | "pending" | "rejected";

export type Loan = {
  id: string;
  borrowerId: string;
  loanType: string;
  originationDate: string;
  maturityDate: string;
  originalPrincipal: number;
  currentBalance: number;
  interestRate: number;
  termMonths: number;
  borrowerState: string;
  loanPurpose: string;
  creditGrade: string;
  employmentLength: string;
  incomeBand: string;
  paymentStatus: string;
  daysPastDue: number;
  servicerName: string;
  lastPaymentDate: string;
  lastUpdatedAt: string;
  documentStatus: string;
  sourceSystem: string;
  status: LoanStatus;
  exceptionCount: number;
  verifiedAt?: string;
  verifiedBy?: string;
  recordHash?: string;
};

export type Exception = {
  id: string;
  loanId: string;
  borrowerId: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  field: string;
  source: string;
  status: "open" | "approved" | "rejected" | "corrected";
  createdAt: string;
  aiRecommendation?: string;
  aiConfidence?: number;
};

export type AuditEvent = {
  id: string;
  loanId?: string;
  action: string;
  actor: string;
  actorRole: Role;
  metadata: string;
  createdAt: string;
  hash: string;
};
