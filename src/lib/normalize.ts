import type { EvolutionPoint, Execution, Product, TestResult, Trigger } from "@/lib/metrics";
import { groupFailureOccurrences } from "@/lib/metrics";

/** Files published by the automations under quality-hub/ on the metrics branch. */
export const QUALITY_HUB_FILES: Record<Product, string[]> = {
  api: [
    "latest.json", "history.json", "test-history.json", "test-stability-30d.json", "execution-trend-30d.json",
    "period-comparison.json", "failure-reasons-30d.json", "failure-lifecycle.json",
    "api-swagger-coverage-current.json", "api-swagger-coverage-history.json", "api-automation-evolution.json",
  ],
  ui: [
    "latest.json", "history.json", "test-history.json", "test-stability-30d.json", "execution-trend-30d.json",
    "period-comparison.json", "failure-reasons-30d.json", "failure-lifecycle.json", "ui-automation-evolution.json",
  ],
};
/** Which file feeds executions and weekly evolution. */
export const EXECUTIONS_FILE = "history.json";
export const TEST_HISTORY_FILE = "test-history.json";
export const EVOLUTION_FILE: Record<Product, string> = {
  api: "api-automation-evolution.json",
  ui: "ui-automation-evolution.json",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const pick = (o: Obj, keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };

/** Decodes a GitHub Contents API body (base64 in `content`) or passes raw JSON through. */
export function decodeGithubContent(body: unknown): unknown {
  if (isObj(body) && typeof body["content"] === "string" && body["encoding"] === "base64") {
    const bin = atob((body["content"] as string).replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return body;
}

/** Finds the main list in a file: the array itself, or the first array under common keys. */
export function extractList(raw: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!isObj(raw)) return null;
  for (const k of keys) if (Array.isArray(raw[k])) return raw[k] as unknown[];
  return null;
}

export function countRecords(raw: unknown): number | null {
  if (Array.isArray(raw)) return raw.length;
  if (isObj(raw)) { for (const v of Object.values(raw)) if (Array.isArray(v)) return v.length; return Object.keys(raw).length; }
  return null;
}

function toDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toStatus(v: unknown): TestResult["status"] | null {
  const s = String(v ?? "").toLowerCase();
  if (["passed", "pass", "success", "ok"].includes(s)) return "passed";
  if (["failed", "fail", "failure", "error", "broken"].includes(s)) return "failed";
  if (["flaky", "unstable", "retried"].includes(s)) return "flaky";
  return null;
}

function toTrigger(v: unknown, origin?: unknown, actor?: unknown): Trigger {
  const s = String(v ?? "").toLowerCase();
  if (s === "workflow_dispatch" && origin === "jenkins_schedule" && String(actor ?? "").toLowerCase() === "joao-paulo-vertem") return "scheduled";
  if (s.includes("merge") || s === "push" || s === "pull_request") return "post-merge";
  if (s.includes("manual") || s === "workflow_dispatch") return "manual";
  if (s === "schedule" || s === "scheduled") return "scheduled";
  return "unknown";
}

export class FormatError extends Error {}

function describe(raw: unknown): string {
  if (Array.isArray(raw)) return "array";
  if (isObj(raw)) return `campos ${Object.keys(raw).slice(0, 8).join(", ") || "nenhum"}`;
  return typeof raw;
}

function readTest(t: unknown, where: string): TestResult {
  if (!isObj(t)) throw new FormatError(`${where} não é um objeto`);
  const title = pick(t, ["title", "name", "test"]);
  const status = toStatus(pick(t, ["status", "outcome", "result"]));
  if (typeof title !== "string") throw new FormatError(`${where}.title ausente`);
  if (!status) throw new FormatError(`${where}.status desconhecido`);
  const str = (k: string[]) => { const v = pick(t, k); return v == null ? undefined : String(v); };
  const r: TestResult = { title, status };
  const error = str(["error", "message"]), detail = str(["detail", "details", "stack"]), cause = str(["cause", "reason", "category", "failureCategory"]);
  if (error) r.error = error;
  if (detail) r.detail = detail;
  if (cause) r.cause = cause;
  return r;
}

/** Per-test list when published; otherwise rebuilt from the summary counts (tests.passed/failed/flaky). */
function readResults(item: Obj, i: number): TestResult[] {
  const executedResults = (list: unknown[], where: string) => list.flatMap((test, j) => {
    if (isObj(test) && ["skipped", "pending"].includes(String(pick(test, ["status", "outcome", "result"]) ?? "").toLowerCase())) return [];
    return [readTest(test, `${where}[${j}]`)];
  });
  for (const key of ["results", "testResults"]) {
    const list = item[key];
    if (Array.isArray(list) && list.length) return executedResults(list, `[${i}].${key}`);
  }
  const sum = isObj(item["tests"]) ? (item["tests"] as Obj) : null;
  if (Array.isArray(item["tests"])) return executedResults(item["tests"] as unknown[], `[${i}].tests`);
  if (!sum) throw new FormatError(`[${i}].tests ausente (resumo ou lista de testes)`);
  if (sum["available"] === false) return [];
  const n = (k: string) => { const v = Number(sum[k] ?? 0); return Number.isFinite(v) ? v : 0; };
  const failed = n("failed") + n("errors");
  const flakyList = Array.isArray(item["flakyTests"]) ? (item["flakyTests"] as unknown[]) : [];
  const flakyTitles = flakyList.map((f, k) => (isObj(f) ? String(pick(f, ["title", "name"]) ?? `Teste instável ${k + 1}`) : String(f)));
  const flaky = Math.max(n("flaky"), flakyTitles.length);
  const total = Math.max(n("total") - n("skipped") - n("pending"), n("passed") + failed + flaky);
  const out: TestResult[] = [];
  for (let k = 0; k < flaky; k++) out.push({ title: flakyTitles[k] ?? `Teste instável ${k + 1}`, status: "flaky" });
  for (let k = 0; k < failed; k++) out.push({ title: `Falha sem detalhe ${k + 1}`, status: "failed", cause: "Sem detalhe publicado" });
  for (let k = out.length; k < total; k++) out.push({ title: `Teste ${k + 1}`, status: "passed" });
  return out;
}

/** Normalizes a history file into executions. Throws FormatError naming the first invalid field. */
export function normalizeExecutions(raw: unknown, product: Product): Execution[] {
  const list = extractList(raw, ["executions", "runs", "history", "items", "data"]);
  if (!list) throw new FormatError(`lista de execuções não encontrada (esperado array ou campo executions/runs/history; encontrado: ${describe(raw)})`);
  return list.map((item, i) => {
    if (!isObj(item)) throw new FormatError(`[${i}] não é um objeto`);
    const run = isObj(item["run"]) ? (item["run"] as Obj) : {};
    const date = toDate(pick(item, ["date", "generatedAt", "startedAt", "started_at", "createdAt", "created_at", "timestamp"]));
    if (!date) throw new FormatError(`[${i}].date/generatedAt ausente ou inválida`);
    const id = String(pick(run, ["id"]) ?? pick(item, ["id", "runId", "run_id"]) ?? `${date}-${i}`);
    const attempt = Number(pick(run, ["attempt"]) ?? pick(item, ["runAttempt", "run_attempt", "attempt"]) ?? 1);
    const triggerId = String(pick(item, ["triggerId", "trigger_id"]) ?? id);
    const trigger = toTrigger(pick(run, ["event"]) ?? pick(item, ["trigger", "event", "origin"]), pick(run, ["origin"]) ?? item["origin"], pick(run, ["actor"]) ?? item["actor"]);
    const results = readResults(item, i);
    return { id, product, triggerId, runAttempt: Number.isFinite(attempt) && attempt >= 1 ? attempt : 1, trigger, date, results, dataSource: String(pick(item, ["dataSource", "data_source", "workflow"]) ?? product.toUpperCase()) };
  });
}

/** Normalizes a weekly evolution file. */
export function normalizeEvolution(raw: unknown): EvolutionPoint[] {
  const list = extractList(raw, ["points", "weeks", "evolution", "history", "items", "data"]);
  if (!list) throw new FormatError("lista semanal não encontrada (esperado array ou campo weeks/evolution/history)");
  return list.map((item, i) => {
    if (!isObj(item)) throw new FormatError(`[${i}] não é um objeto`);
    const week = toDate(pick(item, ["week", "date", "weekEnd", "week_end"]));
    const p = Number(pick(item, ["productConditions", "product_conditions", "product", "total"]));
    const a = Number(pick(item, ["automatedConditions", "automated_conditions", "automated", "covered"]));
    if (!week) throw new FormatError(`[${i}].week ausente ou inválida`);
    if (!Number.isFinite(p)) throw new FormatError(`[${i}].productConditions não numérico`);
    if (!Number.isFinite(a)) throw new FormatError(`[${i}].automatedConditions não numérico`);
    return { week, productConditions: p, automatedConditions: a, projectedAutomatedConditions: null };
  });
}

// ---------- Specialized failure/stability files ----------
export const STABILITY_FILE = "test-stability-30d.json";
export const REASONS_FILE = "failure-reasons-30d.json";
export const LIFECYCLE_FILE = "failure-lifecycle.json";

export interface StabilityRow { title: string; executions: number; failureExecutions: number; successRate: number | null; dataSource: string }
export interface ReasonRow { cause: string; value: number }
export interface DatedTestResult { date: string; runId: string; testKey: string; title: string; status: TestResult["status"]; cause?: string }
export interface DatedFailure { date: string; runId: string; testKey: string; cause: string }
export interface DatedFailureHistory { failures: DatedFailure[]; tests: DatedTestResult[]; retentionDays: number | null }

/** Display the scenario rather than the Playwright suite and file path. */
export function scenarioTitle(title: string): string {
  const parts = title.split(/\s+›\s+/).map(part => part.trim()).filter(Boolean);
  return parts.at(-1) ?? title;
}

/** Uses only definitive failures from the first attempt of scheduled executions. */
export function normalizeDatedFailures(raw: unknown): DatedFailureHistory {
  if (!isObj(raw) || !Array.isArray(raw["results"])) throw new FormatError("Histórico detalhado de testes não encontrado.");
  const failures: DatedFailure[] = [];
  const tests: DatedTestResult[] = [];
  for (const [i, item] of raw["results"].entries()) {
    if (!isObj(item)) throw new FormatError(`results[${i}] não é um objeto`);
    const status = toStatus(item["status"]);
    if (toTrigger(item["event"], item["origin"], item["actor"]) !== "scheduled" || Number(item["runAttempt"] ?? 1) !== 1 || !status) continue;
    const date = toDate(item["generatedAt"]), runId = item["runId"], key = item["testKey"];
    if (!date || runId == null || typeof key !== "string" || !key) throw new FormatError(`results[${i}]: falha sem data, execução ou identificador do teste`);
    const title = typeof item["title"] === "string" ? item["title"] : key;
    const cause = item["failureCategory"] ? String(item["failureCategory"]) : undefined;
    tests.push({ date, runId: String(runId), testKey: key, title, status, ...(cause ? { cause } : {}) });
    if (status === "failed") failures.push({ date, runId: String(runId), testKey: key, cause: cause || "Histórico sem classificação" });
  }
  const retention = Number(raw["retentionDays"]);
  return { failures, tests, retentionDays: Number.isFinite(retention) && retention > 0 ? retention : null };
}
export interface SpecialFailureRow { title: string; error: string; detail: string; occurrences: number; dataSource: string; firstSeen: string; firstOccurrence: string; lastOccurrence: string; testKey?: string }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
function needList(raw: unknown, key: string): Obj[] {
  if (!isObj(raw) || !Array.isArray(raw[key])) throw new FormatError(`campo "${key}" ausente ou não é uma lista`);
  return (raw[key] as unknown[]).filter(isObj);
}
/** title → error → detail; generic label only when none is published. */
const titleOf = (o: Obj, i: number) => str(o["title"]) || str(o["name"]) || str(o["error"]) || str(o["detail"]) || `Falha sem detalhe ${i + 1}`;

/** test-stability-30d.json → flaky rows (tests that failed at least once). */
export function normalizeStability(raw: unknown, dataSource: string): StabilityRow[] {
  return needList(raw, "tests")
    .map((t, i) => {
      const executions = num(t["executions"]);
      const failureExecutions = num(pick(t, ["failureExecutions", "failures"]));
      const sr = pick(t, ["successRatePercent", "successRate"]);
      return {
        title: str(t["title"]) || str(t["name"]) || `Teste ${i + 1}`,
        executions, failureExecutions,
        successRate: sr == null ? (executions ? Math.round(((executions - failureExecutions) / executions) * 10000) / 100 : null) : num(sr),
        dataSource: str(t["dataSourceName"]) || dataSource,
      };
    })
    .filter((r) => r.failureExecutions >= 3);
}

/** failure-reasons-30d.json → { failures (table), reasons (donut, definitive failures only — flaky excluded) }. */
export function normalizeReasons(raw: unknown, dataSource: string): { failures: SpecialFailureRow[]; reasons: ReasonRow[] } {
  const failures = groupFailureOccurrences(needList(raw, "failures").map((f, i) => failureRow(f, i, dataSource)));
  const reasons = needList(raw, "reasons")
    .map((r) => ({ cause: str(r["reason"]) || "Sem classificação", value: num(pick(r, ["failedOccurrences", "occurrences"])) }))
    .filter((r) => r.value > 0);
  return { failures, reasons };
}

/** failure-lifecycle.json → lifetime failure rows, sorted by occurrences desc. */
export function normalizeLifecycle(raw: unknown, dataSource: string): SpecialFailureRow[] {
  const seen = new Map<string, string>();
  if (isObj(raw) && Array.isArray(raw["tests"])) for (const t of raw["tests"] as unknown[]) if (isObj(t)) seen.set(str(t["testKey"]), str(t["firstSeen"]));
  return groupFailureOccurrences(needList(raw, "failures")
    .map((f, i) => { const row = failureRow(f, i, dataSource); if (!row.firstSeen) row.firstSeen = seen.get(str(f["testKey"])) ?? ""; return row; })
  );
}

function failureRow(f: Obj, i: number, dataSource: string): SpecialFailureRow {
  return {
    ...(str(f["testKey"]) ? { testKey: str(f["testKey"]) } : {}),
    title: titleOf(f, i), error: str(f["error"]), detail: str(f["detail"]), occurrences: num(f["occurrences"]),
    dataSource: str(f["dataSourceName"]) || dataSource,
    firstSeen: str(f["firstSeen"]), firstOccurrence: str(f["firstOccurrence"]), lastOccurrence: str(f["lastOccurrence"]),
  };
}
