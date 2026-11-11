// Pure business rules for automation metrics. Keep free of React/IO so they are testable.

export type Product = "api" | "ui";
export type Trigger = "scheduled" | "post-merge" | "manual" | "unknown";
export type TestStatus = "passed" | "failed" | "flaky";

export interface TestResult {
  title: string;
  /** passed = first try ok; flaky = failed internally but passed on retry; failed = definitive failure */
  status: TestStatus;
  error?: string;
  detail?: string;
  cause?: string;
}

export interface Execution {
  id: string;
  product: Product;
  /** Identifies the trigger (schedule tick, merge commit, manual dispatch). Reruns share it. */
  triggerId: string;
  /** GitHub Actions run_attempt. 1 = first attempt; >1 = rerun of the same Action. */
  runAttempt: number;
  trigger: Trigger;
  date: string; // YYYY-MM-DD
  dataSource: string;
  results: TestResult[];
}

export interface EvolutionPoint {
  week: string;
  productConditions: number;
  automatedConditions: number;
  projectedAutomatedConditions: number | null;
  projectedProductConditions?: number | null;
}

export interface DailyResult {
  date: string;
  passed: number;
  failed: number;
  unstable: number;
}

export interface DailyExecutionVolume {
  date: string;
  ciRuns: number;
  scenarioRuns: number | null;
}

/** Count recorded runs and their results. Empty results are treated as unavailable, not zero. */
export function dailyExecutionVolume(execs: Execution[]): DailyExecutionVolume[] {
  const days = new Map<string, DailyExecutionVolume>();
  for (const execution of execs) {
    const day = days.get(execution.date) ?? { date: execution.date, ciRuns: 0, scenarioRuns: 0 };
    day.ciRuns++;
    if (!execution.results.length) day.scenarioRuns = null;
    else if (day.scenarioRuns !== null) day.scenarioRuns += execution.results.length;
    days.set(execution.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Keep only the first attempt of each trigger: reruns of the same Action are ignored. */
export function dedupeExecutions(execs: Execution[]): Execution[] {
  const best = new Map<string, Execution>();
  for (const e of execs) {
    const key = `${e.product}|${e.triggerId}`;
    const cur = best.get(key);
    if (!cur || e.runAttempt < cur.runAttempt) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface ExecFilter {
  product: "all" | Product;
  periodDays: number | null; // null = all history
  origins: Trigger[];
  now: Date;
}

export function daysAgoISO(now: Date, days: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function filterExecutions(execs: Execution[], f: ExecFilter): Execution[] {
  const from = f.periodDays == null ? null : daysAgoISO(f.now, f.periodDays - 1);
  return execs.filter(
    (e) =>
      (f.product === "all" || e.product === f.product) &&
      f.origins.includes(e.trigger) &&
      (from == null || e.date >= from) && e.date <= daysAgoISO(f.now, 0),
  );
}

export interface Summary {
  passed: number;
  flaky: number;
  failed: number;
  total: number;
  /** success rate in %, null when there is no data */
  rate: number | null;
}

/** sucesso = aprovados (inclui flaky recuperado por retry) / total; falha = definitiva. */
export function summarize(execs: Execution[]): Summary {
  let passed = 0,
    flaky = 0,
    failed = 0;
  for (const e of execs)
    for (const r of e.results) {
      if (r.status === "passed") passed++;
      else if (r.status === "flaky") flaky++;
      else failed++;
    }
  const total = passed + flaky + failed;
  return { passed, flaky, failed, total, rate: total ? ((passed + flaky) / total) * 100 : null };
}

/** Per-execution status preserves missing results instead of treating them as failures. */
export function summarizeExecutionHealth(execs: Execution[]) {
  const classified = execs.map((execution) => ({ execution, ...summarize([execution]) }));
  const critical = classified.filter((item) => item.rate != null && item.rate < 80).sort((a, b) => a.rate! - b.rate! || a.execution.date.localeCompare(b.execution.date));
  const attention = classified.filter((item) => item.rate != null && item.rate >= 80 && item.rate < 90).sort((a, b) => a.rate! - b.rate! || a.execution.date.localeCompare(b.execution.date));
  const healthy = classified.filter((item) => item.rate != null && item.rate >= 90);
  const missing = classified.filter((item) => item.rate == null);
  return { critical, attention, healthy, missing, healthySummary: summarize(healthy.map((item) => item.execution)) };
}

export type Tone = "success" | "warning" | "danger";
export function rateTone(rate: number): Tone {
  if (rate >= 90) return "success";
  if (rate >= 80) return "warning";
  return "danger";
}

export interface CurrentTests { total: number; projects: { dataSource: string; date: string; count: number }[] }

/**
 * Testes atuais: cada título de cenário é um teste. Conta os cenários da execução mais recente de cada
 * projeto (todas as execuções desse último dia juntas, para não perder uma execução dividida) e soma os
 * projetos. Testes renomeados ou removidos deixam de contar assim que a próxima execução roda.
 */
export function currentTests(execs: Execution[], product: Product): CurrentTests {
  const latest = new Map<string, string>();
  for (const e of execs) if (e.product === product && e.results.length && e.date > (latest.get(e.dataSource) ?? "")) latest.set(e.dataSource, e.date);
  const projects = [...latest.entries()].map(([dataSource, date]) => {
    const titles = new Set<string>();
    for (const e of execs) if (e.product === product && e.dataSource === dataSource && e.date === date) e.results.forEach((r) => titles.add(r.title));
    return { dataSource, date, count: titles.size };
  }).sort((a, b) => a.dataSource.localeCompare(b.dataSource));
  return { total: projects.reduce((sum, p) => sum + p.count, 0), projects };
}

export function testCount(execs: Execution[], product: Product): number {
  return currentTests(execs, product).total;
}

export function dailyResults(execs: Execution[]): DailyResult[] {
  const m = new Map<string, DailyResult>();
  for (const e of execs) {
    const d = m.get(e.date) ?? { date: e.date, passed: 0, failed: 0, unstable: 0 };
    for (const r of e.results) {
      if (r.status === "passed") d.passed++;
      else if (r.status === "flaky") d.unstable++;
      else d.failed++;
    }
    m.set(e.date, d);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface FlakyRow {
  title: string;
  executions: number;
  failureExecutions: number;
  dataSource: string;
}

export function flakyTable(execs: Execution[]): FlakyRow[] {
  const m = new Map<string, FlakyRow>();
  for (const e of execs) {
    const oneRun = new Map<string, { title: string; failed: boolean }>();
    for (const r of e.results) {
      const key = `${e.dataSource}|${r.title}`;
      const current = oneRun.get(key);
      oneRun.set(key, { title: r.title, failed: Boolean(current?.failed || r.status === "flaky" || r.status === "failed") });
    }
    for (const [key, test] of oneRun) {
      const row = m.get(key) ?? { title: test.title, executions: 0, failureExecutions: 0, dataSource: e.dataSource };
      row.executions++;
      if (test.failed) row.failureExecutions++;
      m.set(key, row);
    }
  }
  return [...m.values()].filter((r) => r.failureExecutions >= 3).sort((a, b) => b.failureExecutions - a.failureExecutions);
}

export interface FailureRow {
  title: string;
  error: string;
  detail: string;
  cause: string;
  occurrences: number;
  dataSource: string;
  firstSeen: string;
  firstOccurrence: string;
  lastOccurrence: string;
}

/** Une registros equivalentes sem misturar origens ou motivos diferentes. */
export function groupFailureOccurrences<T extends { title: string; error: string; detail: string; dataSource: string; occurrences: number; firstSeen: string; firstOccurrence: string; lastOccurrence: string; testKey?: string }>(rows: T[]): T[] {
  const groups = new Map<string, T>();
  const earlier = (a: string, b: string) => !a ? b : !b ? a : a < b ? a : b;
  const later = (a: string, b: string) => !a ? b : !b ? a : a > b ? a : b;
  for (const row of rows) {
    const key = JSON.stringify([row.dataSource, row.testKey || row.title, row.error, row.detail]);
    const previous = groups.get(key);
    if (!previous) groups.set(key, { ...row });
    else groups.set(key, { ...previous, occurrences: previous.occurrences + row.occurrences, firstSeen: earlier(previous.firstSeen, row.firstSeen), firstOccurrence: earlier(previous.firstOccurrence, row.firstOccurrence), lastOccurrence: later(previous.lastOccurrence, row.lastOccurrence) });
  }
  return [...groups.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/** Groups definitive failures by source, scenario, error and detail. Each execution counts once. */
export function failureRows(execs: Execution[]): FailureRow[] {
  const firstSeen = new Map<string, string>();
  for (const e of execs)
    for (const r of e.results) {
      const k = `${e.dataSource}|${r.title}`;
      const cur = firstSeen.get(k);
      if (!cur || e.date < cur) firstSeen.set(k, e.date);
    }
  const m = new Map<string, FailureRow>();
  for (const e of execs) {
    const seenInExec = new Set<string>();
    for (const r of e.results) {
      if (r.status !== "failed") continue;
      const key = JSON.stringify([e.dataSource, r.title, r.error ?? "", r.detail ?? ""]);
      if (seenInExec.has(key)) continue;
      seenInExec.add(key);
      const row =
        m.get(key) ??
        ({
          title: r.title,
          error: r.error ?? "—",
          detail: r.detail ?? "—",
          cause: r.cause ?? "Não classificada",
          occurrences: 0,
          dataSource: e.dataSource,
          firstSeen: firstSeen.get(`${e.dataSource}|${r.title}`) ?? e.date,
          firstOccurrence: e.date,
          lastOccurrence: e.date,
        } as FailureRow);
      row.occurrences++;
      if (e.date < row.firstOccurrence) row.firstOccurrence = e.date;
      if (e.date > row.lastOccurrence) row.lastOccurrence = e.date;
      m.set(key, row);
    }
  }
  return [...m.values()].sort((a, b) => b.occurrences - a.occurrences);
}

export function causeDistribution(rows: FailureRow[]): { cause: string; value: number }[] {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(r.cause, (m.get(r.cause) ?? 0) + r.occurrences));
  return [...m.entries()].map(([cause, value]) => ({ cause, value })).sort((a, b) => b.value - a.value);
}

/** Counts distinct minimum conditions: route + method + status + contract. Duplicated scenarios count once. */
export function countCoveredConditions(
  contract: { route: string; method: string; status: number; contract: string }[],
  evidences: { route: string; method: string; status: number; contract: string }[],
): number {
  const key = (c: { route: string; method: string; status: number; contract: string }) =>
    `${c.method.toUpperCase()} ${c.route} ${c.status} ${c.contract}`;
  const valid = new Set(contract.map(key));
  const covered = new Set(evidences.map(key).filter((k) => valid.has(k)));
  return covered.size;
}

export const MIN_POINTS_FOR_PROJECTION = 3;

function slope(ys: number[], weeks: number[]): number {
  const n = ys.length;
  const mx = weeks.reduce((sum, x) => sum + x, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    den = 0;
  ys.forEach((y, i) => {
    num += (weeks[i]! - mx) * (y - my);
    den += (weeks[i]! - mx) ** 2;
  });
  return den ? num / den : 0;
}

function addWeeks(iso: string, w: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}

export type Projection =
  | { status: "empty"; series: EvolutionPoint[] }
  | { status: "insufficient"; series: EvolutionPoint[]; currentGap: number }
  | { status: "no-parity"; series: EvolutionPoint[]; currentGap: number; productVelocity: number; automationVelocity: number }
  | { status: "beyond-horizon"; series: EvolutionPoint[]; currentGap: number; weeksRemaining: number }
  | {
      status: "parity";
      series: EvolutionPoint[];
      currentGap: number;
      productVelocity: number;
      automationVelocity: number;
      parityWeek: string;
      weeksRemaining: number;
    };

/** Projection only exists when automation grows faster than the product (linear regression, weekly). */
export function computeProjection(points: EvolutionPoint[]): Projection {
  const pts = [...points].sort((a, b) => a.week.localeCompare(b.week)).map((p) => ({ ...p, projectedAutomatedConditions: null }));
  if (!pts.length) return { status: "empty", series: [] };
  const last = pts[pts.length - 1]!;
  const currentGap = last.productConditions - last.automatedConditions;
  if (pts.length < MIN_POINTS_FOR_PROJECTION) return { status: "insufficient", series: pts, currentGap };
  const window = pts.slice(-8);
  const firstWeek = Date.parse(`${window[0]!.week}T00:00:00Z`);
  const weeks = window.map((p) => (Date.parse(`${p.week}T00:00:00Z`) - firstWeek) / (7 * 86_400_000));
  if (new Set(weeks).size < MIN_POINTS_FOR_PROJECTION || weeks.some((w) => !Number.isFinite(w))) return { status: "insufficient", series: pts, currentGap };
  const vp = slope(window.map((p) => p.productConditions), weeks);
  const va = slope(window.map((p) => p.automatedConditions), weeks);
  if (va <= vp || currentGap <= 0) {
    return { status: "no-parity", series: pts, currentGap, productVelocity: vp, automationVelocity: va };
  }
  const weeksRemaining = Math.ceil(currentGap / (va - vp));
  if (!Number.isFinite(weeksRemaining) || weeksRemaining > 520) return { status: "beyond-horizon", series: pts, currentGap, weeksRemaining };
  const series: EvolutionPoint[] = pts.map((p, i) =>
    i === pts.length - 1 ? { ...p, projectedAutomatedConditions: p.automatedConditions, projectedProductConditions: p.productConditions } : p,
  );
  for (let k = 1; k <= weeksRemaining; k++) {
    series.push({
      week: addWeeks(last.week, k),
      productConditions: null as unknown as number,
      automatedConditions: null as unknown as number,
      projectedAutomatedConditions: Math.round(last.automatedConditions + va * k),
      projectedProductConditions: Math.round(last.productConditions + vp * k),
    });
  }
  return {
    status: "parity",
    series,
    currentGap,
    productVelocity: vp,
    automationVelocity: va,
    parityWeek: addWeeks(last.week, weeksRemaining),
    weeksRemaining,
  };
}

/** Sums several projects' weekly evolution into one series (weeks aligned by date). */
export function aggregateEvolution(series: EvolutionPoint[][]): EvolutionPoint[] {
  const m = new Map<string, EvolutionPoint>();
  for (const s of series)
    for (const p of s) {
      const cur = m.get(p.week) ?? { week: p.week, productConditions: 0, automatedConditions: 0, projectedAutomatedConditions: null };
      cur.productConditions += p.productConditions;
      cur.automatedConditions += p.automatedConditions;
      m.set(p.week, cur);
    }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

// ---------- Extra chart datasets (catalog based on chart-type legend) ----------

/** Tests ranked by definitive failure occurrences (sum across errors). */
export function topFailingTests(rows: FailureRow[], n = 10): { title: string; value: number }[] {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(r.title, (m.get(r.title) ?? 0) + r.occurrences));
  return [...m.entries()].map(([title, value]) => ({ title, value })).sort((a, b) => b.value - a.value).slice(0, n);
}

/** Success rate per day (same rule as summarize). */
export function dailyRate(execs: Execution[]): { date: string; rate: number }[] {
  return dailyResults(execs).map((d) => {
    const total = d.passed + d.unstable + d.failed;
    return { date: d.date, rate: total ? Math.round(((d.passed + d.unstable) / total) * 10000) / 100 : 0 };
  });
}

/** Success rate per origin (trigger); origins without data are omitted. */
export function rateByOrigin(execs: Execution[]): { origin: Trigger; rate: number; total: number }[] {
  return (["scheduled", "post-merge", "manual"] as Trigger[])
    .map((origin) => {
      const s = summarize(execs.filter((e) => e.trigger === origin));
      return { origin, rate: s.rate == null ? -1 : Math.round(s.rate * 100) / 100, total: s.total };
    })
    .filter((r) => r.rate >= 0);
}

/** Per test: how many valid executions ran it vs how many ended flaky/failed. */
export function testStability(execs: Execution[]): { title: string; executions: number; problems: number }[] {
  const m = new Map<string, { title: string; executions: number; problems: number }>();
  for (const e of execs)
    for (const r of e.results) {
      const row = m.get(r.title) ?? { title: r.title, executions: 0, problems: 0 };
      row.executions++;
      if (r.status !== "passed") row.problems++;
      m.set(r.title, row);
    }
  return [...m.values()];
}

/** Weekday (0=Sun) x ISO week grid of definitive failures. */
export function failureHeatmap(execs: Execution[]): { week: string; day: number; failed: number; total: number }[] {
  const m = new Map<string, { week: string; day: number; failed: number; total: number }>();
  for (const e of execs) {
    const d = new Date(e.date + "T00:00:00Z");
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    const week = monday.toISOString().slice(0, 10);
    const k = `${week}|${day}`;
    const c = m.get(k) ?? { week, day, failed: 0, total: 0 };
    for (const r of e.results) {
      c.total++;
      if (r.status === "failed") c.failed++;
    }
    m.set(k, c);
  }
  return [...m.values()];
}

/** Funnel: product conditions → automated → tests executed in period → tests without definitive failure. */
export function qualityFunnel(evo: EvolutionPoint[], execs: Execution[]): { stage: string; value: number }[] {
  const last = evo.filter((p) => p.productConditions > 0).at(-1);
  const titles = new Set<string>();
  const failed = new Set<string>();
  execs.forEach((e) => e.results.forEach((r) => { titles.add(r.title); if (r.status === "failed") failed.add(r.title); }));
  return [
    { stage: "Condições do produto", value: last?.productConditions ?? 0 },
    { stage: "Condições automatizadas", value: last?.automatedConditions ?? 0 },
    { stage: "Testes executados", value: titles.size },
    { stage: "Testes sem falha definitiva", value: titles.size - failed.size },
  ];
}

/** Waterfall of automated conditions: start value + weekly increments. */
export function coverageWaterfall(evo: EvolutionPoint[]): { label: string; base: number; delta: number; end: number }[] {
  const pts = evo.filter((p) => p.productConditions > 0);
  if (!pts.length) return [];
  const out = [{ label: pts[0]!.week, base: 0, delta: pts[0]!.automatedConditions, end: pts[0]!.automatedConditions }];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!.automatedConditions, cur = pts[i]!.automatedConditions;
    out.push({ label: pts[i]!.week, base: Math.min(prev, cur), delta: cur - prev, end: cur });
  }
  return out;
}

// ---------- Motivo das falhas (quem precisa agir) ----------
//
// A classificação parte de FATOS da mensagem de erro (primeira linha, sem stack nem código do teste)
// e só aponta um motivo quando há evidência suficiente. Sem evidência, a falha fica em
// "Precisa de análise" com o indício encontrado, em vez de receber um motivo chutado.

/** Natureza = quem precisa agir. */
export type FailureNature = "product" | "environment" | "test_data" | "automation" | "investigate";
/** Sintoma = o que a mensagem de erro mostra. */
export type FailureSymptom =
  | "connection" | "server_error" | "test_data" | "auth" | "contract" | "strict_selector"
  | "api_timeout" | "response_timeout" | "element_missing" | "element_state" | "assertion" | "timeout" | "unknown";
export type Confidence = "alta" | "média" | "baixa";

export const NATURE_ORDER: FailureNature[] = ["product", "environment", "test_data", "automation", "investigate"];
export const NATURE_LABEL: Record<FailureNature, string> = {
  product: "Possível bug no sistema",
  environment: "Problema no ambiente",
  test_data: "Problema na massa de teste",
  automation: "Ajuste no teste automatizado",
  investigate: "Precisa de análise",
};
export const NATURE_MEANING: Record<FailureNature, string> = {
  product: "Há evidência de que o sistema se comportou errado: erro 5xx, contrato quebrado ou o mesmo resultado errado se repetindo.",
  environment: "Há evidência de que o ambiente de testes (HML) falhou: serviço fora do ar, acesso recusado ou muitos testes quebrando ao mesmo tempo.",
  test_data: "A mensagem indica que o dado do teste não existia, estava duplicado ou não pôde ser criado.",
  automation: "A mensagem indica erro no próprio script, como um seletor que encontra mais de um elemento.",
  investigate: "A mensagem mostra o que falhou, mas não o porquê. Abra a execução (captura de tela, vídeo e rede) para confirmar o motivo.",
};
export const NATURE_OWNER: Record<FailureNature, string> = {
  product: "Desenvolvimento",
  environment: "SRE / DevOps",
  test_data: "QA",
  automation: "QA",
  investigate: "QA (triagem)",
};
/** O que aconteceu, em linguagem simples. */
export const SYMPTOM_LABEL: Record<FailureSymptom, string> = {
  connection: "O serviço não respondeu ou recusou a conexão.",
  server_error: "O sistema respondeu com erro interno (5xx).",
  test_data: "O dado do teste estava duplicado, ausente ou não pôde ser preparado.",
  auth: "O acesso foi recusado (401/403 ou token inválido).",
  contract: "A resposta não seguiu o contrato (schema) esperado.",
  strict_selector: "O seletor do teste encontrou mais de um elemento na tela.",
  api_timeout: "A API não respondeu dentro do tempo limite.",
  response_timeout: "A tela esperou uma resposta ou navegação que não chegou no tempo limite.",
  element_missing: "Um elemento esperado não apareceu na tela.",
  element_state: "Um elemento da tela mostrou valor ou estado diferente do esperado.",
  assertion: "O resultado foi diferente do esperado pelo teste.",
  timeout: "Uma etapa do teste passou do tempo limite.",
  unknown: "A execução não registrou a mensagem de erro.",
};
/** Possíveis explicações quando a evidência não basta para escolher uma. */
const SYMPTOM_HINT: Partial<Record<FailureSymptom, string>> = {
  api_timeout: "Pode ser lentidão momentânea do ambiente ou do endpoint.",
  response_timeout: "Pode ser lentidão do ambiente, erro na API chamada pela tela ou mudança no fluxo da tela.",
  element_missing: "Pode ser tela com erro (ex.: 404 ou 500), tela que mudou ou script desatualizado. A captura de tela da execução mostra qual.",
  element_state: "Pode ser bug na tela, massa de teste diferente ou regra que mudou.",
  assertion: "Pode ser bug, massa de teste diferente ou regra que mudou.",
  timeout: "Pode ser lentidão do ambiente ou do sistema.",
  unknown: "Sem mensagem, só o relatório da execução mostra o motivo.",
};

/** Etapa do cenário em que a falha aconteceu (Dado / Quando / Então). */
export type FailurePhase = "preparacao" | "acao" | "verificacao";
export interface CapturedCall { method: string; url: string; status: number | null; ms?: number; detail?: string; error?: string }
export interface CapturedHttpError { method: string; url: string; status: number; type?: string }
export interface CapturedNetworkFailure { method: string; url: string; error: string }
/** Evidência gravada pela automação no momento da falha (campo `failureEvidence` do test-history). */
export interface CapturedEvidence {
  layer?: Product;
  phase: FailurePhase | null;
  failedStep: string | null;
  timedOut: boolean;
  pageUrl?: string;
  pageTitle?: string;
  calls: CapturedCall[];
  httpErrors: CapturedHttpError[];
  networkFailures: CapturedNetworkFailure[];
  pageErrors: string[];
  consoleErrors: string[];
}
export const PHASE_LABEL: Record<FailurePhase, string> = { preparacao: "Preparação (Dado)", acao: "Ação testada (Quando)", verificacao: "Verificação (Então)" };

/** Uma ocorrência de teste na primeira tentativa de uma execução agendada. */
export interface TestOccurrence {
  product: Product;
  date: string;
  runId: string;
  testKey: string;
  title: string;
  status: TestStatus;
  /** Primeira linha da mensagem de erro (sem stack nem trecho de código). */
  summary?: string | undefined;
  /** Categoria publicada pela automação; usada só quando não há mensagem. */
  cause?: string | undefined;
  runUrl?: string | undefined;
  /** Evidência capturada na falha; ausente em execuções anteriores à captura. */
  captured?: CapturedEvidence | undefined;
  dataSource: string;
}

export interface FailureIncident { product: Product; date: string; runId: string; failed: number; total: number; dataSource: string; runUrl?: string | undefined }

export interface ClassifiedFailure extends TestOccurrence {
  nature: FailureNature;
  symptom: FailureSymptom;
  confidence: Confidence;
  /** Por que esta natureza, citando a evidência. */
  rule: string;
  /** Trecho da mensagem que serviu de evidência ("" quando veio da categoria publicada). */
  evidence: string;
  /** "evidencia" = decidido pela evidência capturada; "mensagem" = só pela mensagem de erro (execuções antigas ou sem prova). */
  source: "evidencia" | "mensagem";
  /** Fatos que sustentam a classificação, um por linha (ex.: "GET /visitas → 404"). */
  proof: string[];
  /** Falha dentro de uma execução com falha em massa. */
  incident: boolean;
  /** Execuções distintas (fora de incidentes) em que o mesmo teste falhou definitivamente. */
  failedRuns: number;
}

/** Execução com falha em massa: pelo menos 5 falhas definitivas e 30% dos testes executados. */
export const INCIDENT_MIN_FAILURES = 5;
export const INCIDENT_MIN_SHARE = 0.3;
/** Execuções distintas com o mesmo teste falhando para considerar a falha recorrente. */
export const RECURRENT_RUNS = 3;

/** Código HTTP citado como status (evita confundir com IDs ou posições). */
const http = (codes: string) => `(?:status|http|code|c[oó]digo|received|recebido)\\D{0,15}(?:${codes})\\b`;
const SYMPTOM_RULES: { symptom: FailureSymptom; pattern: RegExp }[] = [
  { symptom: "connection", pattern: new RegExp(`ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed|net::ERR_[A-Z_]+|bad gateway|service unavailable|gateway time-?out|${http("50[234]")}`, "i") },
  { symptom: "server_error", pattern: new RegExp(`internal server error|${http("5\\d\\d")}`, "i") },
  { symptom: "test_data", pattern: new RegExp(`already exists|j[aá] existe|duplicate key|duplicad[oa]|unique constraint|massa de teste|prepara[cç][aã]o .{0,60}falhou|${http("409")}`, "i") },
  { symptom: "auth", pattern: new RegExp(`unauthori[sz]ed|forbidden|access denied|token (?:inv[aá]lido|invalid|expirado|expired)|${http("401|403")}`, "i") },
  { symptom: "contract", pattern: /schema|contract|contrato|additional propert|required propert|ajv/i },
  { symptom: "strict_selector", pattern: /strict mode violation/i },
  { symptom: "api_timeout", pattern: /apiRequestContext\.\w+: Timeout/i },
  { symptom: "response_timeout", pattern: /(?:waitForResponse|waitForRequest|waitForURL|waitForNavigation|waitForLoadState|page\.goto|navigation)\b.{0,40}timeout|timeout.{0,60}(?:waiting for (?:event "response"|navigation))/i },
  { symptom: "element_missing", pattern: /locator\.\w+: Timeout|toBeVisible|toBeAttached|toBeInViewport|waiting for (?:locator|selector)|element (?:was )?not found|locator\.waitFor/i },
  { symptom: "element_state", pattern: /toHaveValue|toHaveText|toContainText|toBeHidden|toHaveCount|toBeChecked|toBeEnabled|toBeDisabled|toHaveAttribute|toHaveURL|toHaveTitle/i },
  { symptom: "timeout", pattern: /timeout|timed?\s*out|exceeded/i },
  { symptom: "assertion", pattern: /expect|received|assert|toEqual|toBe|toContain|toMatch|diverg|fora da ordem|n[aã]o corresponde|\berror\b/i },
];

/** Categoria publicada → sintoma. "Autenticação" fica de fora: a automação a deduz do código do teste, não do erro. */
const CAUSE_SYMPTOM: [RegExp, FailureSymptom][] = [
  [/rede|infra/i, "connection"],
  [/timeout|sincroniza/i, "timeout"],
  [/seletor|elemento/i, "element_missing"],
  [/massa/i, "test_data"],
  [/contrato/i, "contract"],
  [/resposta|regra|diverg/i, "assertion"],
];

const UNPUBLISHED = /detalhe n[aã]o registrado|sem detalhe|histórico sem classificação/i;

/** Sintoma e o trecho da mensagem que o comprova; sem mensagem, usa a categoria publicada. */
export function failureEvidence(summary?: string, cause?: string): { symptom: FailureSymptom; evidence: string } {
  const text = (summary ?? "").trim();
  if (text && !UNPUBLISHED.test(text)) {
    for (const rule of SYMPTOM_RULES) {
      const match = text.match(rule.pattern);
      if (match) return { symptom: rule.symptom, evidence: match[0].trim() };
    }
    return { symptom: "unknown", evidence: "" };
  }
  return { symptom: CAUSE_SYMPTOM.find(([pattern]) => pattern.test(cause ?? ""))?.[1] ?? "unknown", evidence: "" };
}

export function failureSymptom(summary?: string, cause?: string): FailureSymptom {
  return failureEvidence(summary, cause).symptom;
}

const occurrenceId = (t: TestOccurrence) => `${t.product}|${t.dataSource}|${t.runId}|${t.testKey}`;
const runKey = (t: { product: Product; dataSource: string; runId: string }) => `${t.product}|${t.dataSource}|${t.runId}`;

/** Execuções em que muitos testes falharam juntos — normalmente indisponibilidade do ambiente, não N problemas distintos. */
export function detectIncidents(tests: TestOccurrence[]): FailureIncident[] {
  const runs = new Map<string, FailureIncident>();
  const seen = new Set<string>();
  for (const t of tests) {
    if (seen.has(occurrenceId(t))) continue;
    seen.add(occurrenceId(t));
    const run = runs.get(runKey(t)) ?? { product: t.product, date: t.date, runId: t.runId, failed: 0, total: 0, dataSource: t.dataSource, runUrl: t.runUrl };
    run.total++;
    if (t.status === "failed") run.failed++;
    run.runUrl ??= t.runUrl;
    runs.set(runKey(t), run);
  }
  return [...runs.values()]
    .filter((r) => r.failed >= INCIDENT_MIN_FAILURES && r.failed / r.total >= INCIDENT_MIN_SHARE)
    .sort((a, b) => b.date.localeCompare(a.date));
}

const TOKEN_URL = /\/(?:oauth2?|token|connect\/token|protocol\/openid-connect)\b/i;
const NETWORK_ERROR = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|net::ERR_|getaddrinfo|network/i;
const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };
const callText = (c: { method: string; url: string; status: number | null; detail?: string; error?: string }) =>
  `${c.method} ${pathOf(c.url)} → ${c.status ?? (c.error ? c.error : "sem resposta")}${c.detail ? ` (${c.detail})` : ""}`;
const stepText = (c: CapturedEvidence) => (c.failedStep ? ` Etapa: "${c.failedStep}".` : "");

type Verdict = [FailureNature, Confidence, string, string[]];

/**
 * Regras sobre a evidência capturada, na ordem em que devem valer. Cada regra só dispara com prova
 * concreta; quando nenhuma dispara, devolve null e a classificação cai para a mensagem de erro.
 */
export function classifyByEvidence(c: CapturedEvidence, symptom: FailureSymptom, failedRuns: number): Verdict | null {
  const calls = c.calls;
  const httpErrors = [...c.httpErrors.map((e) => ({ ...e, status: e.status as number | null })), ...calls.filter((call) => call.status != null && call.status >= 400)];
  const recurrent = failedRuns >= RECURRENT_RUNS;
  const phase = c.phase ? ` na ${PHASE_LABEL[c.phase].toLowerCase()}` : "";

  // 1. Serviço inacessível: requisição que não chegou ou gateway 502/503/504.
  const network = [
    ...c.networkFailures.map((n) => `${n.method} ${pathOf(n.url)} → ${n.error}`),
    ...calls.filter((call) => call.status == null && NETWORK_ERROR.test(call.error ?? "")).map(callText),
    ...httpErrors.filter((e) => e.status != null && e.status >= 502 && e.status <= 504).map(callText),
  ];
  if (network.length) return ["environment", "alta", `O serviço não respondeu ou estava fora do ar${phase}.${stepText(c)}`, network];

  // 2. Erro interno do sistema (5xx).
  const server = httpErrors.filter((e) => e.status != null && e.status >= 500).map(callText);
  if (server.length) return ["product", "alta", `O sistema respondeu com erro interno${phase}; isso não depende do teste.${stepText(c)}`, server];

  // 3. Credencial do usuário de teste recusada no servidor de login.
  const token = calls.filter((call) => TOKEN_URL.test(call.url) && call.status != null && call.status >= 400).map(callText);
  if (token.length) return ["environment", "alta", `O login do usuário de teste foi recusado; confira credenciais e permissões no HML.${stepText(c)}`, token];

  // 4. Tela (UI) que recebeu 4xx: página inexistente ou chamada de API com erro.
  if (c.layer === "ui" || c.httpErrors.length) {
    const denied = c.httpErrors.filter((e) => e.status === 401 || e.status === 403).map(callText);
    if (denied.length) return ["environment", "média", `A tela teve acesso negado; pode ser sessão expirada ou permissão do usuário de teste.${stepText(c)}`, denied];
    const page = c.httpErrors.filter((e) => e.type === "document" && e.status >= 400).map(callText);
    if (page.length) return ["product", "alta", `A própria tela respondeu com erro (ex.: 404, página inexistente).${stepText(c)}`, page];
    const api = c.httpErrors.filter((e) => e.status >= 400).map(callText);
    if (api.length) return ["product", "média", `A tela chamou a API e recebeu erro${phase}.${stepText(c)}`, api];
  }

  // 5. Falhou ao preparar o cenário (Dado), sem erro de sistema: o dado necessário não estava disponível.
  if (c.phase === "preparacao") return ["test_data", "média", `A falha aconteceu na preparação do cenário, antes da ação testada, sem erro do sistema: o dado ou estado necessário não estava disponível.${stepText(c)}`, calls.slice(-3).map(callText)];

  // 6. Seletor ambíguo no script.
  if (symptom === "strict_selector") return ["automation", "alta", `O seletor do teste encontrou mais de um elemento.${stepText(c)}`, []];

  // 7. Erro de JavaScript na página.
  if (c.pageErrors.length) return ["product", "média", `A página teve erro de JavaScript durante o teste.${stepText(c)}`, c.pageErrors.map((e) => `Erro na página: ${e}`)];

  // 8. Elemento não apareceu numa tela que carregou sem nenhum erro: tela alterada ou script desatualizado.
  if (c.layer === "ui" && symptom === "element_missing") {
    const where = c.pageUrl ? [`Tela carregada sem erros: ${pathOf(c.pageUrl)}${c.pageTitle ? ` (${c.pageTitle})` : ""}`] : [];
    return ["automation", "média", `A tela carregou sem erro de rede nem de JavaScript, mas o elemento esperado não apareceu: provável mudança na tela ou script desatualizado.${stepText(c)}`, where];
  }

  // 9. Chamada de API que estourou o tempo limite.
  const slow = calls.filter((call) => call.status == null && /timeout/i.test(call.error ?? "")).map(callText);
  if (slow.length) return recurrent
    ? ["product", "média", `A mesma chamada estourou o tempo limite em ${failedRuns} execuções: indica lentidão do sistema.${stepText(c)}`, slow]
    : ["investigate", "baixa", `Uma chamada estourou o tempo limite uma vez; pode ser lentidão momentânea do ambiente.${stepText(c)}`, slow];

  return null;
}

/** Classifica as falhas definitivas. `tests` deve conter todos os testes das execuções (aprovados inclusive) para detectar falhas em massa. */
export function classifyFailures(tests: TestOccurrence[]): ClassifiedFailure[] {
  const incidents = new Map(detectIncidents(tests).map((i) => [runKey(i), i]));
  const seen = new Set<string>();
  const failures = tests.filter((t) => {
    if (t.status !== "failed" || seen.has(occurrenceId(t))) return false;
    seen.add(occurrenceId(t));
    return true;
  });
  const testId = (t: TestOccurrence) => `${t.product}|${t.dataSource}|${t.testKey}`;
  const runsByTest = new Map<string, Set<string>>();
  for (const f of failures) if (!incidents.has(runKey(f))) runsByTest.set(testId(f), (runsByTest.get(testId(f)) ?? new Set<string>()).add(f.runId));
  return failures.map((f) => {
    const { symptom, evidence } = failureEvidence(f.summary, f.cause);
    const incident = incidents.get(runKey(f));
    const failedRuns = runsByTest.get(testId(f))?.size ?? 0;
    const recurrent = failedRuns >= RECURRENT_RUNS;
    const hasMessage = Boolean(f.summary?.trim()) && !UNPUBLISHED.test(f.summary ?? "");
    const quoted = !hasMessage
      ? (f.cause ? `Sem mensagem; a automação publicou a categoria "${f.cause}". ` : "")
      : evidence && !/^error$/i.test(evidence) ? `A mensagem contém "${evidence}". ` : "";
    const capturedProof = f.captured ? f.captured.calls.filter((call) => call.status == null || call.status >= 400).map(callText) : [];
    if (incident) return { ...f, nature: "environment", symptom, confidence: "alta", rule: `${incident.failed} de ${incident.total} testes falharam na mesma execução (${fmtDay(incident.date)}). Tantas falhas juntas indicam queda ou instabilidade do ambiente, não ${incident.failed} problemas diferentes.`, evidence, incident: true, failedRuns, source: f.captured ? "evidencia" : "mensagem", proof: [`${incident.failed} de ${incident.total} testes falharam na execução de ${fmtDay(incident.date)}`, ...capturedProof.slice(0, 2)] };
    const verdict = f.captured ? classifyByEvidence(f.captured, symptom, failedRuns) : null;
    if (verdict) {
      const [nature, confidence, rule, proof] = verdict;
      return { ...f, nature, symptom, confidence, rule, evidence, incident: false, failedRuns, source: "evidencia", proof };
    }
    const [nature, confidence, rule] = ((): [FailureNature, Confidence, string] => {
      switch (symptom) {
        case "connection": return ["environment", "alta", `${quoted}O serviço não estava acessível durante o teste.`];
        case "server_error": return ["product", "alta", `${quoted}O sistema devolveu erro interno, o que não depende do teste.`];
        case "contract": return ["product", "alta", `${quoted}A resposta saiu do contrato esperado.`];
        case "test_data": return ["test_data", "alta", `${quoted}O problema está no dado usado pelo teste.`];
        case "strict_selector": return ["automation", "alta", `${quoted}O seletor do script é ambíguo e precisa ser corrigido.`];
        case "auth": return ["environment", "média", `${quoted}O acesso do usuário de teste foi recusado; confira credenciais e permissões no HML.`];
        case "assertion":
        case "element_state":
          return recurrent
            ? ["product", "média", `${quoted}O mesmo resultado errado aconteceu em ${failedRuns} execuções diferentes, o que reduz a chance de ser instabilidade. Confirme com o desenvolvimento.`]
            : ["investigate", "baixa", `${quoted}${SYMPTOM_HINT[symptom]}`];
        case "api_timeout":
        case "response_timeout":
        case "timeout":
          return recurrent
            ? ["product", "média", `${quoted}O tempo limite estourou em ${failedRuns} execuções diferentes: indica lentidão do sistema, não um pico do ambiente.`]
            : ["investigate", "baixa", `${quoted}${SYMPTOM_HINT[symptom]}`];
        case "element_missing":
          return ["investigate", recurrent ? "média" : "baixa", `${quoted}${SYMPTOM_HINT.element_missing}${recurrent ? ` Aconteceu em ${failedRuns} execuções: priorize a análise.` : ""}`];
        default: return ["investigate", "baixa", `${quoted}${SYMPTOM_HINT.unknown}`];
      }
    })();
    // Sem prova capturada (execução antiga), a mensagem sozinha não sustenta evidência forte.
    const capped: Confidence = f.captured ? confidence : confidence === "alta" ? "média" : confidence;
    const proof = [...(f.captured?.failedStep ? [`Falhou na etapa: ${f.captured.failedStep}`] : []), ...capturedProof];
    return { ...f, nature, symptom, confidence: capped, rule, evidence, incident: false, failedRuns, source: "mensagem", proof };
  });
}

const fmtDay = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export interface NatureCount { nature: FailureNature; label: string; api: number; ui: number; total: number }

/** Contagem por natureza com API e UI separados, na ordem fixa das naturezas. */
export function natureDistribution(rows: ClassifiedFailure[]): NatureCount[] {
  return NATURE_ORDER.map((nature) => {
    const of = rows.filter((r) => r.nature === nature);
    const api = of.filter((r) => r.product === "api").length, ui = of.filter((r) => r.product === "ui").length;
    return { nature, label: NATURE_LABEL[nature], api, ui, total: api + ui };
  });
}

export interface NatureOccurrence { date: string; runId: string; runUrl?: string | undefined; incident: boolean; summary?: string | undefined; proof: string[]; captured?: CapturedEvidence | undefined }
export interface NatureGroup {
  product: Product; nature: FailureNature; symptom: FailureSymptom; confidence: Confidence;
  title: string; testKey: string; error: string; evidence: string; rule: string; source: "evidencia" | "mensagem"; proof: string[]; captured?: CapturedEvidence | undefined;
  occurrences: number; incidentOccurrences: number; firstDate: string; lastDate: string; dataSource: string;
  runs: NatureOccurrence[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { alta: 0, "média": 1, baixa: 2 };

/** Agrupa por teste + natureza + sintoma para a tabela e o detalhe. */
export function groupClassified(rows: ClassifiedFailure[]): NatureGroup[] {
  const groups = new Map<string, NatureGroup>();
  for (const r of rows) {
    const key = JSON.stringify([r.product, r.dataSource, r.testKey, r.nature, r.symptom]);
    const g = groups.get(key) ?? { product: r.product, nature: r.nature, symptom: r.symptom, confidence: r.confidence, title: r.title, testKey: r.testKey, error: r.summary ?? "", evidence: r.evidence, rule: r.rule, source: r.source, proof: r.proof, captured: r.captured, occurrences: 0, incidentOccurrences: 0, firstDate: r.date, lastDate: r.date, dataSource: r.dataSource, runs: [] };
    g.occurrences++;
    if (r.incident) g.incidentOccurrences++;
    g.runs.push({ date: r.date, runId: r.runId, runUrl: r.runUrl, incident: r.incident, summary: r.summary, proof: r.proof, captured: r.captured });
    if (CONFIDENCE_RANK[r.confidence] < CONFIDENCE_RANK[g.confidence]) g.confidence = r.confidence;
    if (r.date < g.firstDate) g.firstDate = r.date;
    if (r.date >= g.lastDate) { g.lastDate = r.date; g.rule = r.rule; g.source = r.source; g.proof = r.proof; g.captured = r.captured; if (r.summary) g.error = r.summary; if (r.evidence) g.evidence = r.evidence; }
    groups.set(key, g);
  }
  for (const g of groups.values()) g.runs.sort((a, b) => b.date.localeCompare(a.date));
  return [...groups.values()].sort((a, b) => NATURE_ORDER.indexOf(a.nature) - NATURE_ORDER.indexOf(b.nature) || b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate));
}

/** "projeto|arquivo|linha|título" → "arquivo:linha". */
export function testLocation(testKey: string): string {
  const [, file, line] = testKey.split("|");
  return file ? `${file}${line ? `:${line}` : ""}` : "";
}

// ---------- Cobertura do contrato da API (Swagger em produção) ----------
//
// Universo mínimo a automatizar = condições do contrato em produção (main): método + rota + status
// documentado. Vários testes da mesma condição contam uma vez; cenários a mais da PBI não inflam a
// cobertura. Respostas que nenhum teste provoca de propósito (5xx e 429) ficam fora da base.

/** Uma condição do contrato: método, rota e status documentados, e se algum teste a comprova. */
export interface ContractCondition { method: string; path: string; status: string; covered: boolean; scenario?: string; testFile?: string }
export interface ContractCoverage {
  generatedAt: string;
  /** Repositório e branch de onde o contrato foi lido (produção = main). */
  sourceRepository: string;
  sourceBranch: string;
  sourceCommit: string;
  conditions: ContractCondition[];
}

export function isTestableStatus(status: string | number): boolean {
  const code = Number(status);
  return Number.isInteger(code) && code < 500 && code !== 429;
}

export interface EndpointCoverage {
  project: string;
  method: string;
  path: string;
  testable: number;
  covered: number;
  /** null quando o endpoint não tem condição testável. */
  percent: number | null;
  coveredStatuses: string[];
  missingStatuses: string[];
  /** Status documentados que ficam fora da base (5xx, 429). */
  excludedStatuses: string[];
  conditions: ContractCondition[];
}

const sortStatus = (list: string[]) => [...new Set(list)].sort((a, b) => Number(a) - Number(b));

/** Cobertura por endpoint (método + rota) de um ou mais projetos. */
export function endpointCoverage(sources: { project: string; coverage: ContractCoverage }[]): EndpointCoverage[] {
  const endpoints = new Map<string, EndpointCoverage>();
  for (const { project, coverage } of sources)
    for (const condition of coverage.conditions) {
      const key = `${project}|${condition.method}|${condition.path}`;
      const endpoint = endpoints.get(key) ?? { project, method: condition.method, path: condition.path, testable: 0, covered: 0, percent: null, coveredStatuses: [], missingStatuses: [], excludedStatuses: [], conditions: [] };
      endpoint.conditions.push(condition);
      if (!isTestableStatus(condition.status)) endpoint.excludedStatuses.push(condition.status);
      else if (condition.covered) { endpoint.testable++; endpoint.covered++; endpoint.coveredStatuses.push(condition.status); }
      else { endpoint.testable++; endpoint.missingStatuses.push(condition.status); }
      endpoints.set(key, endpoint);
    }
  return [...endpoints.values()].map((e) => ({
    ...e,
    percent: e.testable ? Math.round((e.covered / e.testable) * 10000) / 100 : null,
    coveredStatuses: sortStatus(e.coveredStatuses),
    missingStatuses: sortStatus(e.missingStatuses.filter((s) => !e.coveredStatuses.includes(s))),
    excludedStatuses: sortStatus(e.excludedStatuses),
  }));
}

export interface ContractSummary {
  testable: number;
  covered: number;
  percent: number | null;
  /** Condições fora da base (5xx e 429). */
  excluded: number;
  endpoints: number;
  fullyCovered: number;
  partiallyCovered: number;
  notCovered: number;
}

/** Totais da cobertura: a mesma conta que alimenta a série semanal (produto × automatizado). */
export function contractSummary(endpoints: EndpointCoverage[]): ContractSummary {
  const withBase = endpoints.filter((e) => e.testable > 0);
  const testable = withBase.reduce((sum, e) => sum + e.testable, 0);
  const covered = withBase.reduce((sum, e) => sum + e.covered, 0);
  return {
    testable,
    covered,
    percent: testable ? Math.round((covered / testable) * 10000) / 100 : null,
    excluded: endpoints.reduce((sum, e) => sum + e.excludedStatuses.length, 0),
    endpoints: withBase.length,
    fullyCovered: withBase.filter((e) => e.covered === e.testable).length,
    partiallyCovered: withBase.filter((e) => e.covered > 0 && e.covered < e.testable).length,
    notCovered: withBase.filter((e) => e.covered === 0).length,
  };
}

// ---------- Bugs do Azure DevOps ----------
//
// Uma consulta para todos os projetos: work items abaixo da área raiz (ex.: ConectaMarketplace\Development).
// Bugs = tipo Bug; defeitos = Tasks com a tag DEFEITO; PBIs (categoria de requisitos) só entram na
// proporção de bugs e na carga das colunas do quadro. A squad é a primeira subárea abaixo da raiz.
// O estado é agrupado pela categoria do Azure (Proposed, InProgress, Resolved, Completed, Removed):
// Completed conta como concluído e Removed sai das contas.

export type BugKind = "bug" | "defeito" | "pbi";
export const NO_SQUAD = "Sem squad";
export interface BugItem {
  id: number;
  kind: BugKind;
  title: string;
  state: string;
  /** Categoria do estado no Azure DevOps. */
  category: string;
  severity: string;
  priority: string;
  assignedTo: string;
  createdDate: string;
  closedDate: string | null;
  /** Última mudança de estado (para o tempo parado). */
  stateChangeDate: string | null;
  iteration: string;
  areaPath: string;
  squad: string;
  /** Coluna do quadro (vazia quando o item não aparece no quadro, como as Tasks). */
  column: string;
  url: string;
}
export interface BoardColumn { name: string; wip: number | null; done: boolean }

export const isBugDone = (b: BugItem) => b.category === "Completed";
export const isBugRemoved = (b: BugItem) => b.category === "Removed";
const isOpen = (b: BugItem) => !isBugDone(b) && !isBugRemoved(b);
/** Data em que o item foi concluído; sem data de fechamento, considera a criação. */
const doneDate = (b: BugItem) => (isBugDone(b) ? (b.closedDate ?? b.createdDate).slice(0, 10) : null);
const inRange = (date: string | null, from: string | null, to: string) => date != null && (!from || date >= from) && date <= to;

/** Squad = primeira subárea abaixo da área raiz, sem o prefixo "Team". Itens na própria raiz ficam em "Sem squad". */
export function squadOf(areaPath: string, rootArea: string): string {
  const root = rootArea.replace(/\\+$/, "");
  if (!areaPath.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) return NO_SQUAD;
  const first = areaPath.slice(root.length + 1).split("\\")[0]?.trim() ?? "";
  return first.replace(/^team\s+/i, "") || NO_SQUAD;
}

export interface BugSummary { total: number; open: number; done: number; donePercent: number | null; createdInPeriod: number; doneInPeriod: number; projection: string | null }

/**
 * Totais: abertos e concluídos são a foto de hoje (sem itens removidos); criados/concluídos no período
 * seguem o filtro de datas. A projeção de conclusão usa a queda líquida dos abertos no período
 * (concluídos menos criados), como o Azure DevOps: se os abertos não estão caindo, não há previsão.
 */
export function bugSummary(items: BugItem[], from: string | null, to: string): BugSummary {
  const live = items.filter((b) => !isBugRemoved(b));
  const done = live.filter(isBugDone).length;
  const createdInPeriod = live.filter((b) => inRange(b.createdDate.slice(0, 10), from, to)).length;
  const doneInPeriod = live.filter((b) => inRange(doneDate(b), from, to)).length;
  const open = live.length - done;
  const start = from ?? live.map((b) => b.createdDate.slice(0, 10)).sort()[0] ?? to;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(start)) / 86400000) + 1);
  const netPerDay = (doneInPeriod - createdInPeriod) / days;
  const projection = open === 0 || netPerDay <= 0 ? null : new Date(Date.parse(to) + Math.ceil(open / netPerDay) * 86400000).toISOString().slice(0, 10);
  return { total: live.length, open, done, donePercent: live.length ? Math.round((done / live.length) * 1000) / 10 : null, createdInPeriod, doneInPeriod, projection };
}

export interface BurnupPoint { week: string; scope: number; done: number; open: number }

/** Burnup semanal (fim de semana na sexta, como no Azure): escopo acumulado, concluídos acumulados e abertos. */
export function bugBurnup(items: BugItem[], from: string, to: string): BurnupPoint[] {
  const live = items.filter((b) => !isBugRemoved(b));
  const friday = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); };
  const points: BurnupPoint[] = [];
  for (let week = friday(from); ; ) {
    const cut = week > to ? to : week;
    const scope = live.filter((b) => b.createdDate.slice(0, 10) <= cut).length;
    const done = live.filter((b) => { const d = doneDate(b); return d != null && d <= cut; }).length;
    points.push({ week: cut, scope, done, open: scope - done });
    if (week >= to) break;
    const next = new Date(`${week}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 7); week = next.toISOString().slice(0, 10);
  }
  return points;
}

export interface WeeklyFlowPoint { week: string; created: number; done: number; open: number }

/**
 * Fluxo semanal (semana fechando na sexta): quantos itens entraram e quantos foram concluídos em cada
 * semana, e quantos ficaram abertos no fim dela. Mais fácil de ler que o acumulado do burnup.
 */
export function bugWeeklyFlow(items: BugItem[], from: string, to: string): WeeklyFlowPoint[] {
  const live = items.filter((b) => !isBugRemoved(b));
  let previous = "";
  return bugBurnup(items, from, to).map((p) => {
    const start = previous;
    previous = p.week;
    const inWeek = (d: string | null) => d != null && d <= p.week && (start ? d > start : d >= from);
    return { week: p.week, created: live.filter((b) => inWeek(b.createdDate.slice(0, 10))).length, done: live.filter((b) => inWeek(doneDate(b))).length, open: p.open };
  });
}

export interface ClearProjection {
  open: number;
  /** Média de itens concluídos por semana nas últimas `lookbackWeeks` semanas. */
  perWeek: number;
  lookbackWeeks: number;
  /** Semanas para zerar os abertos se não entrar nenhum item novo (null = sem ritmo de conclusão). */
  weeks: number | null;
  date: string | null;
  /** Histórico dos abertos no fim de cada semana e a queda projetada a partir de hoje. */
  points: { week: string; actual: number | null; projected: number | null }[];
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Projeção para zerar os abertos: no ritmo médio de conclusão das últimas semanas e sem novos itens,
 * quantas semanas faltam. O gráfico projetado para em `maxWeeks` para não esticar demais o eixo.
 */
export function clearProjection(items: BugItem[], today: string, lookbackWeeks = 8, maxWeeks = 26): ClearProjection {
  const live = items.filter((b) => !isBugRemoved(b));
  const from = addDays(today, -(lookbackWeeks * 7 - 1));
  const perWeek = Math.round((live.filter((b) => inRange(doneDate(b), from, today)).length / lookbackWeeks) * 10) / 10;
  const history = bugBurnup(items, from, today);
  const open = live.filter(isOpen).length;
  const weeks = open === 0 ? 0 : perWeek > 0 ? Math.ceil(open / perWeek) : null;
  const points: ClearProjection["points"] = history.map((p) => ({ week: p.week, actual: p.open, projected: null }));
  const last = points[points.length - 1];
  if (last) last.projected = last.actual;
  if (weeks) for (let i = 1; i <= Math.min(weeks, maxWeeks); i++) points.push({ week: addDays(today, i * 7), actual: null, projected: Math.max(0, Math.round((open - perWeek * i) * 10) / 10) });
  return { open, perWeek, lookbackWeeks, weeks, date: weeks == null ? null : addDays(today, weeks * 7), points };
}

/** Contagem por um campo (estado, severidade, prioridade, squad), da maior para a menor. */
export function bugDistribution(items: BugItem[], field: "state" | "severity" | "priority" | "squad"): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const b of items) if (!isBugRemoved(b)) counts.set(b[field] || "Não informado", (counts.get(b[field] || "Não informado") ?? 0) + 1);
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Dias no estado atual (desde a última mudança de estado; sem ela, desde a criação). */
export function bugAgeDays(b: BugItem, today: string): number {
  const since = (b.stateChangeDate ?? b.createdDate).slice(0, 10);
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86400000));
}

/** Itens abertos com o tempo parado no estado atual, do mais antigo para o mais recente. */
export function agingOpen(items: BugItem[], today: string): (BugItem & { ageDays: number })[] {
  return items.filter(isOpen).map((b) => ({ ...b, ageDays: bugAgeDays(b, today) })).sort((a, b) => b.ageDays - a.ageDays || a.id - b.id);
}

export interface ColumnLoad { column: string; bugs: number; others: number; total: number; wip: number | null; overWip: boolean }

/**
 * Itens abertos por coluna do quadro, na ordem do quadro e sem a coluna de concluídos. `others` são os
 * demais itens do quadro (PBIs), porque o limite de WIP do Azure vale para a coluna inteira.
 */
export function bugsByColumn(columns: BoardColumn[], bugs: BugItem[], others: BugItem[] = []): ColumnLoad[] {
  const count = (list: BugItem[], name: string) => list.filter((b) => isOpen(b) && b.column === name).length;
  return columns.filter((c) => !c.done).map((c) => {
    const b = count(bugs, c.name);
    const o = count(others, c.name);
    return { column: c.name, bugs: b, others: o, total: b + o, wip: c.wip, overWip: c.wip != null && b + o > c.wip };
  });
}

/** Proporção de bugs: bugs criados ÷ (bugs + PBIs criados) no período, em %. Null quando não houve itens. */
export function bugRatio(bugs: BugItem[], pbis: BugItem[], from: string | null, to: string): number | null {
  const created = (list: BugItem[]) => list.filter((b) => !isBugRemoved(b) && inRange(b.createdDate.slice(0, 10), from, to)).length;
  const b = created(bugs);
  const total = b + created(pbis);
  return total ? Math.round((b / total) * 1000) / 10 : null;
}

export interface SquadRow extends BugSummary { squad: string; avgOpenAgeDays: number | null; bugRatio: number | null }

/** Comparativo por squad: resumo dos bugs, tempo médio parado dos abertos e proporção de bugs. Mais abertos primeiro. */
export function squadComparison(items: BugItem[], from: string | null, to: string): SquadRow[] {
  const bugs = items.filter((b) => b.kind === "bug");
  const pbis = items.filter((b) => b.kind === "pbi");
  const squads = [...new Set(bugs.map((b) => b.squad))];
  return squads.map((squad) => {
    const own = bugs.filter((b) => b.squad === squad);
    const ages = agingOpen(own, to).map((b) => b.ageDays);
    return {
      squad, ...bugSummary(own, from, to),
      // Mesma projeção do gráfico: ritmo das últimas 8 semanas, sem novos itens.
      projection: own.some(isOpen) ? clearProjection(own, to).date : null,
      avgOpenAgeDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
      bugRatio: bugRatio(own, pbis.filter((b) => b.squad === squad), from, to),
    };
  }).sort((a, b) => b.open - a.open || b.total - a.total || a.squad.localeCompare(b.squad));
}
