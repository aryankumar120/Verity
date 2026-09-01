"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  FileCheck2,
  FileUp,
  Filter,
  Hash,
  History,
  Landmark,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap
} from "lucide-react";
import type { AuditEvent, Exception, Loan, Role } from "@/lib/types";

type Summary = {
  total: number;
  verified: number;
  exceptions: number;
  critical: number;
  principal: number;
  avgRate: number;
  quality: number;
  recent: AuditEvent[];
};

type View = "overview" | "ingest" | "exceptions" | "verified" | "audit" | "api";

const nav = [
  { id: "overview", label: "Command Center", icon: LayoutDashboard },
  { id: "ingest", label: "Data Ingestion", icon: UploadCloud },
  { id: "exceptions", label: "Exception Queue", icon: AlertTriangle },
  { id: "verified", label: "Verified Records", icon: FileCheck2 },
  { id: "audit", label: "Audit Trail", icon: History },
  { id: "api", label: "API Explorer", icon: Zap }
] as const;

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

const numericFields = new Set<keyof Loan>([
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "daysPastDue"
]);

export function CopilotConsole() {
  const [view, setView] = useState<View>("overview");
  const [role, setRole] = useState<Role>("Data Operator");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [selectedException, setSelectedException] = useState<Exception | null>(null);
  const [ai, setAi] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [editValue, setEditValue] = useState("");
  const [reviewerComment, setReviewerComment] = useState("");

  const roleViews: Record<Role, View[]> = {
    "Data Operator": ["overview", "ingest", "exceptions", "audit"],
    Reviewer: ["overview", "exceptions", "verified", "audit"],
    "Data Consumer": ["overview", "verified", "audit", "api"]
  };

  const defaultView: Record<Role, View> = {
    "Data Operator": "overview",
    Reviewer: "exceptions",
    "Data Consumer": "verified"
  };

  const refresh = async () => {
    try {
      const responses = await Promise.all([
        fetch("/api/summary"),
        fetch("/api/loans"),
        fetch("/api/exceptions?status=open"),
        fetch("/api/audit")
      ]);

      const [summaryResponse, loansResponse, exceptionsResponse, auditResponse] = responses;

      if (!summaryResponse.ok || !loansResponse.ok || !exceptionsResponse.ok) {
        throw new Error("Backend API request failed");
      }

      setSummary(await summaryResponse.json());
      setLoans(await loansResponse.json());
      setExceptions(await exceptionsResponse.json());
      setAudit(auditResponse.ok ? await auditResponse.json() : []);
    } catch (error) {
      console.error("Failed to refresh application data:", error);
      setToast("Could not load backend data");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setView(defaultView[role]);
    setSelected(null);
    setSelectedException(null);
    setAi(null);
    setFilter("all");
    setEditValue("");
    setReviewerComment("");
  }, [role]);

  const filteredLoans = useMemo(
    () =>
      loans.filter(
        loan =>
          `${loan.id} ${loan.borrowerId} ${loan.borrowerState}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "all" || loan.status === filter)
      ),
    [loans, query, filter]
  );

  const openLoan = async (loan: Loan, exceptionOverride?: Exception) => {
    if (role !== "Reviewer") {
      setToast("Switch to Reviewer to inspect and resolve exceptions");
      return;
    }

    const exception =
      exceptionOverride || exceptions.find(item => item.loanId === loan.id) || null;

    setSelected(loan);
    setSelectedException(exception);
    setAi(null);
    setReviewerComment(exception?.reviewerComment || "");

    if (exception) {
      const field = fieldMap[exception.field] || (exception.field as keyof Loan);
      const value = loan[field];
      setEditValue(value === undefined || value === null ? "" : String(value));
    } else {
      setEditValue("");
    }

    try {
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanId: loan.id })
      });

      if (response.ok) {
        setAi(await response.json());
      } else {
        setToast("AI review could not be loaded");
      }
    } catch (error) {
      console.error("AI review failed:", error);
      setToast("AI review could not be loaded");
    }
  };

  const decide = async (status: "approved" | "rejected" | "corrected") => {
    if (!selected || !selectedException) {
      setToast("No exception is selected");
      return;
    }

    const changes: Partial<Loan> = {};

    if (status === "corrected") {
      const field = fieldMap[selectedException.field] ||
        (selectedException.field as keyof Loan);

      if (field === "id") {
        setToast("Loan ID cannot be edited during review");
        return;
      }

      if (numericFields.has(field)) {
        const value = Number(editValue);
        if (!Number.isFinite(value)) {
          setToast("Enter a valid numeric value");
          return;
        }
        changes[field] = value as never;
      } else {
        if (!editValue.trim()) {
          setToast("Enter a value before saving the correction");
          return;
        }
        changes[field] = editValue as never;
      }
    }

    try {
      const response = await fetch("/api/exceptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedException.id,
          status,
          reviewer: "Maya Chen",
          changes,
          reviewerComment,
          aiRecommendation: ai?.recommendation,
          aiConfidence: ai?.confidence
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setToast(data.error || "Reviewer action could not be completed");
        return;
      }

      if (status === "approved") {
        setToast(
          data.remainingExceptions === 0
            ? "Loan approved and verified"
            : "Exception approved and recorded"
        );
      } else if (status === "rejected") {
        setToast("Loan rejected and recorded");
      } else {
        setToast(
          data.remainingExceptions === 0
            ? "Correction accepted and loan verified"
            : `Correction saved • ${data.remainingExceptions} exception(s) remain`
        );
      }

      setSelected(null);
      setSelectedException(null);
      setAi(null);
      setReviewerComment("");
      setEditValue("");
      await refresh();
    } catch (error) {
      console.error("Reviewer action failed:", error);
      setToast("Reviewer action failed");
    }
  };

  const ingest = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/ingest", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        setToast(data.error || "Import failed");
        return;
      }

      setToast(`${data.success || 0} rows imported • ${data.failed || 0} flagged`);
      await refresh();
      setView("exceptions");
    } catch (error) {
      console.error("Import failed:", error);
      setToast("Import failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const exportVerified = () => {
    const headers = [
      "loan_id",
      "borrower_id",
      "status",
      "original_principal",
      "current_balance",
      "interest_rate",
      "verified_by",
      "verified_at",
      "record_hash"
    ];

    const rows = loans
      .filter(loan => loan.status === "verified")
      .map(loan => [
        loan.id,
        loan.borrowerId,
        loan.status,
        loan.originalPrincipal,
        loan.currentBalance,
        loan.interestRate,
        loan.verifiedBy || "",
        loan.verifiedAt || "",
        loan.recordHash || ""
      ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "verified-loans.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Verified dataset exported");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark"><Landmark size={19} /></div>
          <div><strong>verity</strong><span>loan intelligence</span></div>
        </div>

        <div className="nav-label">Workspace</div>
        <nav className="nav">
          {nav
            .filter(item => roleViews[role].includes(item.id))
            .map(item => (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                <item.icon size={15} />
                <span>{item.label}</span>
                {item.id === "exceptions" && exceptions.length > 0 ? (
                  <em className="pill high" style={{ marginLeft: "auto", padding: "3px 6px" }}>
                    {exceptions.length}
                  </em>
                ) : null}
              </button>
            ))}
        </nav>

        <div className="sidebar-foot">
          <div className="role-card">
            <small>You are</small>
            <select
              className="role-select"
              value={role}
              onChange={event => setRole(event.target.value as Role)}
            >
              <option>Data Operator</option>
              <option>Reviewer</option>
              <option>Data Consumer</option>
            </select>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="top-actions">
            <div className="search">
              <Search size={15} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search loans, borrowers..."
              />
            </div>
          </div>
          <div className="avatar">AM</div>
        </header>

        <div className="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}
            >
              {view === "overview" ? (
                <Overview
                  summary={summary}
                  loans={loans}
                  exceptions={exceptions}
                  setView={setView}
                  openLoan={openLoan}
                  role={role}
                />
              ) : view === "ingest" ? (
                <Ingestion ingest={ingest} uploading={uploading} />
              ) : view === "exceptions" ? (
                <Exceptions
                  exceptions={exceptions}
                  openLoan={openLoan}
                  filter={filter}
                  setFilter={setFilter}
                  query={query}
                />
              ) : view === "verified" ? (
                <Verified
                  loans={filteredLoans.filter(loan => loan.status === "verified")}
                  exportVerified={exportVerified}
                />
              ) : view === "audit" ? (
                <Audit audit={audit} />
              ) : (
                <ApiExplorer />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {selected ? (
          <LoanDrawer
            loan={selected}
            exception={selectedException}
            ai={ai}
            editValue={editValue}
            setEditValue={setEditValue}
            reviewerComment={reviewerComment}
            setReviewerComment={setReviewerComment}
            close={() => setSelected(null)}
            decide={decide}
          />
        ) : null}
      </AnimatePresence>

      {toast ? (
        <div className="toast">
          <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Overview({
  summary,
  loans,
  exceptions,
  setView,
  openLoan,
  role
}: {
  summary: Summary | null;
  loans: Loan[];
  exceptions: Exception[];
  setView: (view: View) => void;
  openLoan: (loan: Loan, exception?: Exception) => void;
  role: Role;
}) {
  const vals = [24, 31, 28, 40, 36, 55, 48, 67, 61, 73, 70, 88];
  const primaryView = role === "Reviewer" ? "exceptions" : role === "Data Consumer" ? "verified" : "ingest";
  const primaryLabel = role === "Reviewer" ? "Review queue" : role === "Data Consumer" ? "Verified records" : "Ingest data";
  const PrimaryIcon = role === "Reviewer" ? ClipboardCheck : role === "Data Consumer" ? FileCheck2 : UploadCloud;

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Verification command center</div>
          <h1>{role === "Reviewer" ? "Review with confidence." : role === "Data Consumer" ? "Consume trusted data." : "Trust the tape."}</h1>
          <p>
            {role === "Reviewer"
              ? "Resolve high-signal exceptions with AI assistance and human control."
              : role === "Data Consumer"
                ? "Inspect verified records, lineage and evidence before downstream use."
                : "Turn messy loan records into clean, traceable, reviewer-approved data."}
          </p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setView("audit")}>
            <History size={14} /> Audit trail
          </button>
          <button className="btn primary" onClick={() => setView(primaryView)}>
            <PrimaryIcon size={14} /> {primaryLabel}
          </button>
        </div>
      </section>

      <div className="metrics">
        <Metric label="Records ingested" value={summary?.total ?? 0} sub="Across active sources" icon={Database} />
        <Metric label="Verified records" value={summary?.verified ?? 0} sub={`${summary?.quality ?? 0}% verified`} icon={ShieldCheck} good />
        <Metric label="Open exceptions" value={summary?.exceptions ?? 0} sub={`${summary?.critical ?? 0} critical`} icon={AlertTriangle} warn />
        <Metric label="Principal under review" value={`$${((summary?.principal ?? 0) / 1000000).toFixed(2)}M`} sub={`Avg rate ${(summary?.avgRate ?? 0).toFixed(2)}%`} icon={ClipboardCheck} />
      </div>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Validation throughput</div>
              <div className="panel-meta">Records cleared across the latest processing window</div>
            </div>
            <span className="pill ok"><Activity size={11} /> Live</span>
          </div>
          <div className="chart">
            <div className="chart-grid">
              {vals.map((value, index) => <div key={index} className="bar" style={{ height: `${value}%` }} />)}
            </div>
            <div className="axis"><span>01:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>Now</span></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Data quality score</div>
              <div className="panel-meta">Weighted verification confidence</div>
            </div>
            <Sparkles size={15} color="#55e6b4" />
          </div>
          <div className="health">
            <div className="ring"><div className="ring-content"><strong>{summary?.quality ?? 0}%</strong><span>verified</span></div></div>
            <div className="health-row"><span>Canonical fields</span><b className="up">99.2%</b></div>
            <div className="health-row"><span>Source lineage</span><b className="up">100%</b></div>
            <div className="health-row"><span>Exception backlog</span><b className="warn">{summary?.exceptions ?? 0}</b></div>
          </div>
        </section>
      </div>

      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Priority exceptions</div>
            <div className="panel-meta">Highest-impact records requiring human review</div>
          </div>
          <button className="btn ghost" onClick={() => setView("exceptions")}>View queue <ChevronRight size={13} /></button>
        </div>
        <div className="exception-list">
          {exceptions.slice(0, 4).map(exception => (
            <div
              className="exception"
              key={exception.id}
              onClick={() => {
                const loan = loans.find(item => item.id === exception.loanId);
                if (loan) openLoan(loan, exception);
              }}
            >
              <div className="exception-top">
                <div>
                  <h4>{exception.type} <span className="mono" style={{ color: "#527068", fontWeight: 400 }}>{exception.loanId}</span></h4>
                  <p>{exception.message}</p>
                </div>
                <span className={`pill ${exception.severity}`}>{exception.severity}</span>
              </div>
              <div className="exception-foot"><span>{exception.field} • {exception.source}</span><span>Open <ArrowUpRight size={10} /></span></div>
            </div>
          ))}
          {exceptions.length === 0 ? <div className="empty">All records are clean. Nice.</div> : null}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, sub, icon: Icon, good, warn }: { label: string; value: string | number; sub: string; icon: any; good?: boolean; warn?: boolean }) {
  return <div className="metric"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={14} /></span></div><div className="metric-value">{value}</div><div className={`metric-sub ${good ? "up" : warn ? "warn" : ""}`}>{sub}</div></div>;
}

function Ingestion({ ingest, uploading }: { ingest: (file: File) => void; uploading: boolean }) {
  return (
    <>
      <section className="hero"><div><div className="eyebrow">Module A</div><h1>Ingest a loan tape.</h1><p>Parse, normalize and preserve source lineage before validation begins.</p></div></section>
      <div className="page-grid">
        <section className="panel">
          <div className="panel-head"><div><div className="panel-title">CSV ingestion</div><div className="panel-meta">Supports loan_tape.csv and servicer_update.csv style files</div></div><FileUp size={15} color="#55e6b4" /></div>
          <div className="detail">
            <label className="upload">
              <div className="upload-icon"><UploadCloud size={22} /></div>
              <strong style={{ fontSize: 13 }}>Drop your loan tape here</strong>
              <p style={{ color: "#718d84", fontSize: 10 }}>CSV only • raw file lineage is retained</p>
              <input type="file" accept=".csv" onChange={event => event.target.files?.[0] && ingest(event.target.files[0])} />
              <span className="btn primary" style={{ marginTop: 8 }}>Choose CSV</span>
              {uploading ? <><div className="progress"><i /></div><div style={{ marginTop: 8, fontSize: 10, color: "#78938b" }}>Normalizing records and running validation...</div></> : null}
            </label>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><div><div className="panel-title">Pipeline contract</div><div className="panel-meta">What happens to every row</div></div></div>
          <div className="timeline">
            <TimelineStep n="01" title="Parse" text="Read source columns and preserve the original file reference." />
            <TimelineStep n="02" title="Normalize" text="Map source fields into the canonical loan schema." />
            <TimelineStep n="03" title="Validate" text="Apply deterministic rules for dates, balances, status and lineage." />
            <TimelineStep n="04" title="Route" text="Create exceptions and send ambiguous records to a reviewer." />
          </div>
        </section>
      </div>
    </>
  );
}

function TimelineStep({ n, title, text }: { n: string; title: string; text: string }) {
  return <div className="timeline-item"><div className="dot" /><div><h4><span className="mono" style={{ color: "#55e6b4", marginRight: 7 }}>{n}</span>{title}</h4><p>{text}</p></div></div>;
}

function Exceptions({ exceptions, openLoan, filter, setFilter, query }: { exceptions: Exception[]; openLoan: (loan: Loan, exception?: Exception) => void; filter: string; setFilter: (value: string) => void; query: string }) {
  const [loans, setLoans] = useState<Loan[]>([]);

  useEffect(() => {
    fetch("/api/loans")
      .then(response => response.ok ? response.json() : [])
      .then(setLoans)
      .catch(() => setLoans([]));
  }, [exceptions.length]);

  const rows = exceptions.filter(exception => {
    const matchesSeverity = filter === "all" || exception.severity === filter;
    const searchText = `${exception.loanId} ${exception.borrowerId} ${exception.type} ${exception.field}`.toLowerCase();
    return matchesSeverity && (!query || searchText.includes(query.toLowerCase()));
  });

  return (
    <>
      <section className="hero"><div><div className="eyebrow">Module C + D</div><h1>Exception queue.</h1><p>Human review is the final control. AI explains, suggests and waits.</p></div><div className="actions"><span className="pill high"><AlertTriangle size={11} /> {exceptions.length} open</span></div></section>
      <section className="panel table-panel">
        <div className="toolbar">
          <button className={`filter ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}><Filter size={12} /> All</button>
          {["critical", "high", "medium", "low"].map(severity => <button key={severity} className={`filter ${filter === severity ? "active" : ""}`} onClick={() => setFilter(severity)}>{severity}</button>)}
        </div>
        <table className="data-table">
          <thead><tr><th>Severity</th><th>Exception</th><th>Loan</th><th>Field</th><th>Source</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map(exception => (
              <tr key={exception.id} onClick={() => { const loan = loans.find(item => item.id === exception.loanId); if (loan) openLoan(loan, exception); }}>
                <td><span className={`pill ${exception.severity}`}>{exception.severity}</span></td>
                <td><b>{exception.type}</b><div style={{ color: "#6f8880", fontSize: 9, marginTop: 3 }}>{exception.message}</div></td>
                <td className="loan-id mono">{exception.loanId}</td>
                <td className="mono">{exception.field}</td>
                <td>{exception.source}</td>
                <td><ChevronRight size={14} color="#55756c" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="empty">No exceptions match this filter.</div> : null}
      </section>
    </>
  );
}

function Verified({ loans, exportVerified }: { loans: Loan[]; exportVerified: () => void }) {
  return (
    <>
      <section className="hero"><div><div className="eyebrow">Module E</div><h1>Verified records.</h1><p>Canonical data with reviewer decision, timestamp and cryptographic trace.</p></div><div className="actions"><button className="btn primary" onClick={exportVerified}><Download size={14} /> Export CSV</button></div></section>
      <section className="panel table-panel">
        <table className="data-table">
          <thead><tr><th>Loan</th><th>Borrower</th><th>Principal</th><th>Balance</th><th>Rate</th><th>Verified by</th><th>Hash</th></tr></thead>
          <tbody>{loans.map(loan => <tr key={loan.id}><td className="loan-id mono">{loan.id}</td><td>{loan.borrowerId}</td><td>${loan.originalPrincipal.toLocaleString()}</td><td>${loan.currentBalance.toLocaleString()}</td><td>{loan.interestRate}%</td><td>{loan.verifiedBy || "System"}</td><td className="mono" style={{ color: "#55776e" }}>{loan.recordHash?.slice(0, 12)}...</td></tr>)}</tbody>
        </table>
      </section>
    </>
  );
}

function Audit({ audit }: { audit: AuditEvent[] }) {
  return (
    <>
      <section className="hero"><div><div className="eyebrow">Module F</div><h1>Audit trail.</h1><p>Every material action is time-stamped and chained to a SHA-256 record hash.</p></div><div className="pill ok"><Hash size={11} /> Tamper-evident</div></section>
      <section className="panel"><div className="timeline">{audit.slice(0, 30).map(event => <div className="timeline-item" key={event.id}><div className="dot" /><div><h4>{event.action} <span className="mono" style={{ color: "#537068", fontWeight: 400 }}>• {event.loanId || "batch"}</span></h4><p>{event.actor} · {event.actorRole} · {new Date(event.createdAt).toLocaleString()}<br /><span className="mono">{event.hash}</span></p></div></div>)}</div></section>
    </>
  );
}

function ApiExplorer() {
  return (
    <>
      <section className="hero"><div><div className="eyebrow">Module H</div><h1>Verified records API.</h1><p>Simple endpoints for consumers who need trusted data, not raw noise.</p></div></section>
      <div className="page-grid">
        <section className="panel"><div className="panel-head"><div className="panel-title">Endpoints</div><span className="pill ok">GET</span></div><div className="detail">{["/api/loans", "/api/loans/:id", "/api/exceptions", "/api/verified-loans", "/api/verified-loans/:id", "/api/audit/:loanId", "/api/summary"].map(path => <div key={path} className="field" style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span className="mono">{path}</span><span className="pill ok">GET</span></div>)}</div></section>
        <section className="panel"><div className="panel-head"><div className="panel-title">Example response</div><span className="mono" style={{ fontSize: 9, color: "#55e6b4" }}>200 OK</span></div><div className="detail"><pre className="api-code">{`{
  "loan_id": "LN-00005",
  "status": "verified",
  "validation": "passed",
  "verified_by": "Maya Chen",
  "record_hash": "9f2a...d31c"
}`}</pre></div></section>
      </div>
    </>
  );
}

function LoanDrawer({
  loan,
  exception,
  ai,
  editValue,
  setEditValue,
  reviewerComment,
  setReviewerComment,
  close,
  decide
}: {
  loan: Loan;
  exception: Exception | null;
  ai: any;
  editValue: string;
  setEditValue: (value: string) => void;
  reviewerComment: string;
  setReviewerComment: (value: string) => void;
  close: () => void;
  decide: (status: "approved" | "rejected" | "corrected") => void;
}) {
  const editableField = exception?.field || "";
  const fieldLabel = editableField.replaceAll("_", " ");

  return (
    <motion.div className="drawer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
      <motion.aside className="drawer-card" initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} onClick={event => event.stopPropagation()}>
        <div className="drawer-head">
          <div><div className="eyebrow">Loan detail</div><h2 style={{ margin: "7px 0 4px", fontSize: 24, letterSpacing: "-.04em" }}>{loan.id}</h2><p style={{ margin: 0, color: "#6f8880", fontSize: 10 }}>{loan.borrowerId} • {loan.sourceSystem}</p></div>
          <button className="close" onClick={close}><X size={15} /></button>
        </div>

        <div className="detail-grid" style={{ marginTop: 18 }}>
          {[
            ["Status", loan.status],
            ["Principal", `$${loan.originalPrincipal.toLocaleString()}`],
            ["Balance", `$${loan.currentBalance.toLocaleString()}`],
            ["Rate", `${loan.interestRate}%`],
            ["State", loan.borrowerState],
            ["Payment", loan.paymentStatus],
            ["Origination", loan.originationDate],
            ["Maturity", loan.maturityDate],
            ["Documents", loan.documentStatus]
          ].map(([key, value]) => <div className="field" key={key}><label>{key}</label><span>{value}</span></div>)}
        </div>

        {exception ? (
          <div className="ai-box" style={{ marginTop: 14 }}>
            <div className="ai-head"><ClipboardCheck size={15} /> REVIEW ITEM <span className={`pill ${exception.severity}`} style={{ marginLeft: "auto" }}>{exception.severity}</span></div>
            <p className="ai-summary" style={{ marginBottom: 4 }}><b>{exception.type}</b></p>
            <p className="ai-summary" style={{ marginTop: 0 }}>{exception.message}</p>
            <div style={{ fontSize: 10, color: "#76938a" }}>Affected field: <span className="mono">{exception.field}</span></div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: 10, color: "#8fa9a1", marginBottom: 6 }}>Edit {fieldLabel}</label>
              <input
                value={editValue}
                onChange={event => setEditValue(event.target.value)}
                disabled={editableField === "loan_id"}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 8, border: "1px solid #23483e", background: "#071713", color: "#dff8ee", outline: "none" }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 10, color: "#8fa9a1", marginBottom: 6 }}>Reviewer comment</label>
              <textarea
                value={reviewerComment}
                onChange={event => setReviewerComment(event.target.value)}
                placeholder="Explain the review decision..."
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: "10px 11px", borderRadius: 8, border: "1px solid #23483e", background: "#071713", color: "#dff8ee", outline: "none", fontFamily: "inherit" }}
              />
            </div>
          </div>
        ) : null}

        <div className="ai-box" style={{ marginTop: 14 }}>
          <div className="ai-head"><Bot size={15} /> VERITY AI REVIEW <span className="pill low" style={{ marginLeft: "auto" }}>human gated</span></div>
          {ai ? (
            <>
              <p className="ai-summary">{ai.summary}</p>
              <div style={{ fontSize: 10, color: "#76938a", marginBottom: 6 }}>Recommendation confidence {Math.round(ai.confidence * 100)}%</div>
              <div className="confidence"><i style={{ width: `${ai.confidence * 100}%` }} /></div>
              <p className="ai-summary"><b style={{ color: "#9df8d7" }}>Suggested action:</b> {ai.recommendation}</p>
              {ai.factors?.map((factor: any, index: number) => <div key={`${factor.type}-${factor.field}-${index}`} style={{ borderTop: "1px solid #1c3b32", padding: "9px 0", fontSize: 10 }}><span className={`pill ${factor.severity}`} style={{ marginRight: 7 }}>{factor.severity}</span>{factor.message}</div>)}
            </>
          ) : <div className="empty" style={{ padding: "25px 0" }}>Analyzing validation context...</div>}

          <div className="ai-actions">
            <button className="btn primary" onClick={() => decide("approved")}><CheckCircle2 size={13} /> Approve</button>
            <button className="btn" onClick={() => decide("corrected")}><ClipboardCheck size={13} /> Save correction</button>
            <button className="btn" onClick={() => decide("rejected")}><X size={13} /> Reject</button>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}><label>Record hash</label><span className="mono" style={{ fontSize: 9, wordBreak: "break-all" }}>{loan.recordHash || "Pending verification"}</span></div>
      </motion.aside>
    </motion.div>
  );
}
