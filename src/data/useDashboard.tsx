import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { aggregateEvolution, classifyFailures, daysAgoISO, dedupeExecutions, detectIncidents, failureRows, filterExecutions, flakyTable, causeDistribution, groupFailureOccurrences, type ClassifiedFailure, type ContractCoverage, type FailureIncident, type Product, type TestOccurrence, type Trigger } from "@/lib/metrics";
import { scenarioTitle, type ReasonRow, type SpecialFailureRow, type StabilityRow } from "@/lib/normalize";
import type { ProjectData } from "@/lib/sources.functions";
import { loadBugs, loadDashboardData } from "@/lib/sources.functions";

export type PeriodKey = "7" | "15" | "30" | "90" | "all";
export const PERIOD_LABEL: Record<PeriodKey, string> = { "7": "Últimos 7 dias", "15": "Últimos 15 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias", all: "Todo o histórico" };
export const ORIGIN_LABEL: Record<Trigger, string> = { scheduled: "Agendada", "post-merge": "Pós-merge", manual: "Manual", unknown: "Desconhecida" };

interface Filters {
  period: PeriodKey;
  origins: Trigger[];
}

const Ctx = createContext<{ filters: Filters; setFilters: (f: Filters) => void } | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>({ period: "15", origins: ["scheduled"] });
  return <Ctx.Provider value={{ filters, setFilters }}>{children}</Ctx.Provider>;
}

export function useFilters() {
  const c = useContext(Ctx);
  if (!c) throw new Error("FiltersProvider ausente");
  return c;
}

/** "Atualizar dados" bypasses the 5-min server cache on the next loads (window of a few seconds). */
let forceUntil = 0;
export function requestForcedRefresh() {
  forceUntil = Date.now() + 5000;
}

/** Data for one project (slug) or all projects (null), already deduped and filtered for one product. */
export function useDashboardData(slug: string | null, product: Product) {
  const { filters } = useFilters();
  const load = useServerFn(loadDashboardData);
  const q = useQuery({ queryKey: ["dataset", slug], queryFn: () => load({ data: { slug, force: Date.now() < forceUntil } }), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });
  const d = useMemo(() => {
    if (!q.data) return null;
    const now = new Date();
    const all = q.data.flatMap((p) => p.executions);
    const valid = dedupeExecutions(all).filter((e) => e.product === product && e.trigger === "scheduled");
    const periodDays = filters.period === "all" ? null : Number(filters.period);
    const base = { product, origins: filters.origins, now };
    return {
      projects: q.data,
      valid,
      inPeriod: filterExecutions(valid, { ...base, periodDays }),
      allHistory: filterExecutions(valid, { ...base, periodDays: null }),
      evolution: aggregateEvolution(q.data.map((p) => p.evolution[product])),
      periodDays,
      special: buildSpecial(q.data, now, undefined, periodDays),
      specialByProduct: buildSpecial(q.data, now, product, periodDays),
      nature: buildNature(q.data, now, periodDays),
      contract: buildContract(q.data),
    };
  }, [q.data, filters, product]);
  return { ...q, d, periodLabel: PERIOD_LABEL[filters.period] };
}

/** Bugs do Azure DevOps (configuração única, todas as squads). Mesmo ciclo de 5 min e o mesmo botão "Atualizar dados". */
export function useBugs() {
  const load = useServerFn(loadBugs);
  return useQuery({ queryKey: ["dataset", "bugs"], queryFn: () => load({ data: { force: Date.now() < forceUntil } }), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });
}

export type DashData = NonNullable<ReturnType<typeof useDashboardData>["d"]>;

/** Where a specialized panel's rows came from, per product. */
export interface SourceUse { product: Product; file: string; fallback: boolean; reason?: string | undefined }
export interface SpecialData {
  flaky: { rows: StabilityRow[]; used: SourceUse[] };
  failures: { rows: SpecialFailureRow[]; used: SourceUse[] };
  reasons: { rows: ReasonRow[]; used: SourceUse[] };
  lifecycle: { rows: SpecialFailureRow[]; used: SourceUse[] };
}

/** API + UI grouped. Specialized file is primary; history.json is the labeled real-data fallback when a specialized file is unavailable. */
export function buildSpecial(projects: ProjectData[], now: Date, selectedProduct?: Product, periodDays: number | null = 30): SpecialData {
  const out: SpecialData = { flaky: { rows: [], used: [] }, failures: { rows: [], used: [] }, reasons: { rows: [], used: [] }, lifecycle: { rows: [], used: [] } };
  const origins: Trigger[] = ["scheduled"];
  const trackSource = (list: SourceUse[], u: SourceUse) => { if (!list.some((x) => x.product === u.product && x.file === u.file && x.fallback === u.fallback && x.reason === u.reason)) list.push(u); };
  for (const p of projects)
    for (const product of ["api", "ui"] as const) {
      if (selectedProduct && selectedProduct !== product) continue;
      const sp = p.special?.[product];
      const mine = dedupeExecutions(p.executions).filter((e) => e.product === product);
      const d30 = filterExecutions(mine, { product, origins, periodDays, now });
      const reason = (s?: { status: { mode: string; message?: string } }) => (s?.status.mode === "error" || s?.status.mode === "unavailable" ? s.status.message : undefined);
      const fb = (f: SpecialData[keyof SpecialData]["used"], s: { status: { mode: string; message?: string } } | undefined) => trackSource(f, { product, file: "history.json", fallback: true, reason: reason(s) });
      const dated = sp?.testHistory?.data;
      const hasDetailedTests = Array.isArray(dated?.tests);
      if (dated) {
        const from = periodDays == null ? null : daysAgoISO(now, periodDays - 1), end = daysAgoISO(now, 0);
        const seen = new Set<string>();
        for (const failure of dated.failures) {
          if ((from && failure.date < from) || failure.date > end) continue;
          const key = JSON.stringify([failure.runId, failure.testKey]);
          if (seen.has(key)) continue;
          seen.add(key);
          out.reasons.rows.push({ cause: failure.cause, value: 1 });
        }
        const limited = dated.retentionDays != null && (periodDays == null || periodDays > dated.retentionDays);
        trackSource(out.reasons.used, { product, file: sp!.testHistory!.file, fallback: false, ...(limited ? { reason: `Histórico limitado aos últimos ${dated.retentionDays} dias.` } : {}) });
        if (hasDetailedTests) {
          const source = `${p.project.name} · ${product.toUpperCase()}`;
          const rows = new Map<string, { title: string; executions: number; failureExecutions: number }>();
          const seenTests = new Set<string>();
          const detailedFailures: SpecialFailureRow[] = [];
          for (const test of dated.tests) {
            if ((from && test.date < from) || test.date > end) continue;
            const key = JSON.stringify([test.runId, test.testKey]);
            if (seenTests.has(key)) continue;
            seenTests.add(key);
            const stats = rows.get(test.testKey) ?? { title: scenarioTitle(test.title), executions: 0, failureExecutions: 0 };
            stats.executions++;
            if (test.status === "failed" || test.status === "flaky") stats.failureExecutions++;
            rows.set(test.testKey, stats);
            if (test.status !== "failed") continue;
            const candidates = (sp?.lifecycle?.data ?? []).filter(row => row.testKey === test.testKey);
            const match = candidates.length === 1 && candidates[0]!.occurrences === 1 && candidates[0]!.firstOccurrence.slice(0, 10) === test.date && candidates[0]!.lastOccurrence.slice(0, 10) === test.date ? candidates[0] : undefined;
            detailedFailures.push({ title: scenarioTitle(test.title), testKey: test.testKey, error: match?.error || "Detalhe não publicado para esta execução", detail: match?.detail || test.cause || "Causa não classificada", occurrences: 1, dataSource: source, firstSeen: match?.firstSeen || "", firstOccurrence: test.date, lastOccurrence: test.date });
          }
          for (const row of rows.values()) if (row.failureExecutions >= 3) out.flaky.rows.push({ ...row, dataSource: source, successRate: Math.round(((row.executions - row.failureExecutions) / row.executions) * 10000) / 100 });
          const grouped = groupFailureOccurrences(detailedFailures);
          out.failures.rows.push(...grouped);
          out.lifecycle.rows.push(...grouped);
          for (const entry of [out.flaky, out.failures, out.lifecycle]) trackSource(entry.used, { product, file: sp!.testHistory!.file, fallback: false, ...(limited ? { reason: `Histórico limitado aos últimos ${dated.retentionDays} dias.` } : {}) });
        }
      }
      if (hasDetailedTests) continue;

      if (periodDays !== 30) {
        const executionSource = p.sources?.[product]?.executions;
        if (executionSource && executionSource.mode !== "github") {
          for (const entry of [out.flaky, out.failures, out.lifecycle, ...(!dated ? [out.reasons] : [])]) trackSource(entry.used, { product, file: "history.json", fallback: true, reason: "Histórico de execuções indisponível para este período." });
          continue;
        }
        const failures = d30.flatMap(run => run.results.filter(result => result.status === "failed"));
        const incomplete = d30.some(run => !run.results.length || run.results.some(result => result.title.startsWith("Falha sem detalhe")));
        const missingDetail = incomplete || failures.some(result => !result.error && !result.detail);
        const missingCause = incomplete || failures.some(result => !result.cause);
        const unavailable = (f: SourceUse[], message: string) => trackSource(f, { product, file: "history.json", fallback: true, reason: message });
        if (incomplete) unavailable(out.flaky.used, "O histórico não contém detalhes suficientes para este período.");
        else { out.flaky.rows.push(...flakyTable(d30).map(r => ({ ...r, successRate: r.executions ? Math.round(((r.executions - r.failureExecutions) / r.executions) * 10000) / 100 : null }))); fb(out.flaky.used, undefined); }
        if (missingDetail) { unavailable(out.failures.used, "Detalhes de falhas indisponíveis para este período."); unavailable(out.lifecycle.used, "Detalhes de falhas indisponíveis para este período."); }
        else { const rows = failureRows(d30); out.failures.rows.push(...rows); out.lifecycle.rows.push(...rows); fb(out.failures.used, undefined); fb(out.lifecycle.used, undefined); }
        if (!dated) {
          if (missingCause) unavailable(out.reasons.used, "Classificação das causas indisponível para este período.");
          else { out.reasons.rows.push(...causeDistribution(failureRows(d30))); fb(out.reasons.used, undefined); }
        }
        continue;
      }

      if (sp?.stability.data) { out.flaky.rows.push(...sp.stability.data); trackSource(out.flaky.used, { product, file: sp.stability.file, fallback: false }); }
      else { out.flaky.rows.push(...flakyTable(d30).map((r) => ({ ...r, successRate: r.executions ? Math.round(((r.executions - r.failureExecutions) / r.executions) * 10000) / 100 : null }))); fb(out.flaky.used, sp?.stability); }

      if (sp?.reasons.data) {
        out.failures.rows.push(...groupFailureOccurrences(sp.reasons.data.failures)); if (!dated) out.reasons.rows.push(...sp.reasons.data.reasons);
        trackSource(out.failures.used, { product, file: sp.reasons.file, fallback: false }); if (!dated) trackSource(out.reasons.used, { product, file: sp.reasons.file, fallback: false });
      } else {
        const rows = failureRows(d30); out.failures.rows.push(...rows); if (!dated) out.reasons.rows.push(...causeDistribution(rows));
        fb(out.failures.used, sp?.reasons); if (!dated) fb(out.reasons.used, sp?.reasons);
      }

      const missingHistoryDetail = d30.some(run => !run.results.length || run.results.some(result => result.status === "failed" && (!result.error && !result.detail)));
      if (missingHistoryDetail) trackSource(out.lifecycle.used, { product, file: "history.json", fallback: true, reason: "Detalhes de falhas indisponíveis para este período." });
      else { out.lifecycle.rows.push(...failureRows(d30)); fb(out.lifecycle.used, undefined); }
    }
  const merged = new Map<string, number>();
  out.reasons.rows.forEach((r) => merged.set(r.cause, (merged.get(r.cause) ?? 0) + r.value));
  out.reasons.rows = [...merged.entries()].map(([cause, value]) => ({ cause, value })).sort((a, b) => b.value - a.value);
  out.lifecycle.rows.sort((a, b) => b.occurrences - a.occurrences);
  return out;
}

export interface ContractData {
  /** Contrato de cada projeto de API que publica api-swagger-coverage-current.json. */
  sources: { project: string; coverage: ContractCoverage }[];
  /** Projetos sem o arquivo de contrato (ou com erro), com o motivo. */
  missing: { project: string; reason: string }[];
}

/** Cobertura do contrato de todos os projetos de API, sem depender de período (é a foto mais recente). */
export function buildContract(projects: ProjectData[]): ContractData {
  const out: ContractData = { sources: [], missing: [] };
  for (const p of projects) {
    const contract = p.special?.api?.contract;
    if (contract?.data) out.sources.push({ project: p.project.name, coverage: contract.data });
    else out.missing.push({ project: p.project.name, reason: contract?.status && "message" in contract.status && contract.status.message ? String(contract.status.message) : "Contrato ainda não sincronizado. Atualize os dados." });
  }
  return out;
}

export interface NatureData {
  rows: ClassifiedFailure[];
  incidents: FailureIncident[];
  /** Produtos sem histórico de testes no período (nada a classificar). */
  missing: Product[];
  used: SourceUse[];
}

/**
 * Falhas definitivas de API e UI classificadas por natureza. Fonte principal: test-history.json
 * (todos os testes de cada execução agendada, para detectar falhas em massa). Quando a mensagem
 * não foi sincronizada, usa o erro do failure-lifecycle do mesmo teste e dia; sem test-history,
 * usa o history.json.
 */
export function buildNature(projects: ProjectData[], now: Date, periodDays: number | null): NatureData {
  const tests: TestOccurrence[] = [];
  const used: SourceUse[] = [];
  const has = new Set<Product>();
  const from = periodDays == null ? null : daysAgoISO(now, periodDays - 1), end = daysAgoISO(now, 0);
  const inPeriod = (date: string) => (!from || date >= from) && date <= end;
  for (const p of projects)
    for (const product of ["api", "ui"] as const) {
      const dataSource = `${p.project.name} · ${product.toUpperCase()}`;
      const dated = p.special?.[product]?.testHistory?.data;
      if (dated && Array.isArray(dated.tests)) {
        const lifecycle = p.special?.[product]?.lifecycle?.data ?? [];
        const errorFor = (testKey: string, date: string) => {
          const matches = lifecycle.filter((row) => row.testKey === testKey && row.error && row.firstOccurrence.slice(0, 10) <= date && date <= row.lastOccurrence.slice(0, 10));
          return matches.length === 1 ? matches[0]!.error : undefined;
        };
        for (const t of dated.tests) {
          if (!inPeriod(t.date)) continue;
          has.add(product);
          tests.push({ product, date: t.date, runId: t.runId, testKey: t.testKey, title: scenarioTitle(t.title), status: t.status, summary: t.status === "failed" ? t.summary ?? errorFor(t.testKey, t.date) : undefined, cause: t.cause, runUrl: t.runUrl, captured: t.captured, dataSource });
        }
        if (!used.some((u) => u.product === product && !u.fallback)) used.push({ product, file: p.special![product]!.testHistory!.file, fallback: false });
        continue;
      }
      const runs = filterExecutions(dedupeExecutions(p.executions).filter((e) => e.product === product), { product, origins: ["scheduled"], periodDays, now });
      for (const run of runs)
        for (const r of run.results) {
          has.add(product);
          tests.push({ product, date: run.date, runId: run.id, testKey: r.title, title: scenarioTitle(r.title), status: r.status, summary: r.error, cause: r.cause, dataSource });
        }
      if (runs.length && !used.some((u) => u.product === product && u.fallback)) used.push({ product, file: "history.json", fallback: true, reason: "Sem test-history.json: falhas em massa detectadas pelo histórico de execuções." });
    }
  return { rows: classifyFailures(tests), incidents: detectIncidents(tests), missing: (["api", "ui"] as const).filter((product) => !has.has(product)), used };
}
