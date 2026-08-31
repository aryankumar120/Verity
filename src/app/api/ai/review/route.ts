import { NextResponse } from "next/server";
import { addAudit, getLoan, listExceptions, updateException } from "@/lib/db";

function localReview(loanId: string) {
  const loan = getLoan(loanId);
  if (!loan) return null;
  const issues = listExceptions("open").filter(e => e.loanId === loanId);
  const primary = issues[0];
  if (!primary) return { loanId, summary: "No open validation exceptions remain for this record.", recommendation: "Approve as verified.", confidence: 0.98, factors: [], model: "local-rule-reasoner" };
  const recommendations: Record<string, string> = {
    "Balance integrity": "Review the latest authoritative balance source and correct the current balance only after reconciling the source timestamp and lineage.",
    "Rate outlier": "Confirm the interest rate against the source of record before approval.",
    "Date integrity": "Correct the maturity date using the authoritative loan term and origination date before approval.",
    "Invalid state": "Replace the state code with the verified two-letter borrower state from the authoritative source.",
    "Payment mismatch": "Confirm payment status against the latest payment ledger and balance evidence before approval.",
    "Missing document": "Request the missing document or update the document manifest when source evidence confirms availability.",
    "Stale record": "Confirm the latest source update before treating this record as current."
  };
  const recommendation = recommendations[primary.type] || "Review the flagged field against the authoritative source and record the final decision.";
  const confidence = primary.severity === "critical" ? 0.94 : primary.severity === "high" ? 0.89 : primary.severity === "medium" ? 0.85 : 0.81;
  return { loanId, summary: `${issues.length} open exception${issues.length === 1 ? "" : "s"} detected. Highest priority is ${primary.type}.`, recommendation, confidence, factors: issues.slice(0, 6).map(e => ({ type: e.type, severity: e.severity, message: e.message, field: e.field })), model: "local-rule-reasoner" };
}

async function groqReview(loanId: string) {
  const loan = getLoan(loanId);
  const issues = listExceptions("open").filter(e => e.loanId === loanId);
  if (!loan) return null;
  const prompt = `You are a financial data quality review assistant. Do not make decisions, silently edit data, or claim that a correction has been applied. Analyze the loan and validation exceptions. Return ONLY valid JSON with keys summary, recommendation, confidence, factors. confidence must be a number from 0 to 1. factors must be an array of objects with type, severity, message and field.\nLoan: ${JSON.stringify(loan)}\nExceptions: ${JSON.stringify(issues)}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You produce strict JSON for a human-gated financial data review workflow." }, { role: "user", content: prompt }] })
  });
  if (!response.ok) throw new Error(`Groq API returned ${response.status}`);
  const data = await response.json();
  const text = String(data.choices?.[0]?.message?.content || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(text);
  return { loanId, summary: String(parsed.summary), recommendation: String(parsed.recommendation), confidence: Math.max(0, Math.min(1, Number(parsed.confidence))), factors: Array.isArray(parsed.factors) ? parsed.factors : [], model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" };
}

export async function POST(request: Request) {
  const { loanId } = await request.json();
  let result;
  let provider = "local-rule-reasoner";
  if (process.env.GROQ_API_KEY) {
    try {
      result = await groqReview(loanId);
      provider = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    } catch {
      result = localReview(loanId);
      provider = "local-rule-reasoner";
    }
  } else {
    result = localReview(loanId);
  }
  if (!result) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  const issue = listExceptions("open").find(e => e.loanId === loanId);
  if (issue) updateException(issue.id, { aiRecommendation: result.recommendation, aiConfidence: result.confidence });
  addAudit(loanId, "AI recommendation generated", "Verity AI", "Reviewer", { provider, model: result.model, confidence: result.confidence, prompt: "Explain the validation exception and suggest a traceable correction." });
  return NextResponse.json(result);
}
