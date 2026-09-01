import fs from "node:fs";
import path from "node:path";

type RuleDefinition = { id: string; severity: string; description: string; fields?: string[] };
type RulesFile = { version: string; description: string; rules: RuleDefinition[] };

const rulesPath = path.join(process.cwd(), "data", "validation_rules.json");

function loadRules(): RulesFile {
  try {
    const raw = fs.readFileSync(rulesPath, "utf8");
    return JSON.parse(raw) as RulesFile;
  } catch {
    return { version: "0", description: "", rules: [] };
  }
}

let cache: RulesFile | null = null;
let cachedAt = 0;

function rules(): RulesFile {
  const now = Date.now();
  if (!cache || now - cachedAt > 5000) {
    cache = loadRules();
    cachedAt = now;
  }
  return cache;
}

export function getSeverity(ruleId: string, fallback: "critical" | "high" | "medium" | "low") {
  const match = rules().rules.find(rule => rule.id === ruleId);
  const severity = match?.severity;
  return severity === "critical" || severity === "high" || severity === "medium" || severity === "low" ? severity : fallback;
}

export function listRules() {
  return rules().rules;
}
