import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { DashData } from "@/data/useDashboard";
import type { Execution, Product } from "./metrics";
import { availableSections, dailyBars, drawReport, natureCounts, rankingRows, summaryNumbers } from "./reportPdf";

const run = (date: string, product: Product, failed: number, total: number): Execution => ({
  id: `${product}-${date}`, product, triggerId: `p1-${product}-${date}`, runAttempt: 1, trigger: "scheduled", date, dataSource: "P",
  results: Array.from({ length: total }, (_, i) => ({ title: `t${i}`, status: i < failed ? "failed" : "passed" })),
});

function dash(product: Product): DashData {
  const runs = [run("2026-11-08", product, 0, 10), run("2026-11-09", product, 6, 10), run("2026-11-10", product, 1, 10)];
  const sources = { executions: { mode: "github" }, evolution: { mode: "unavailable" } };
  const empty = { rows: [], used: [] };
  const failure = (testKey: string, date: string, incident: boolean) => ({ product, date, runId: date, testKey, title: `Cenário ${testKey}`, status: "failed" as const, dataSource: "P", nature: incident ? "environment" as const : "investigate" as const, symptom: "assertion" as const, confidence: "baixa" as const, rule: "", evidence: "", source: "mensagem" as const, proof: [], incident, failedRuns: 1 });
  return {
    projects: [{ project: { id: "p1", name: "Projeto 1", slug: "p1" }, sources: { api: sources, ui: sources }, executions: runs, evolution: { api: [], ui: [] }, special: {}, fetchedAt: "" }],
    valid: runs, inPeriod: runs, allHistory: runs, evolution: [], periodDays: 3,
    special: { flaky: empty, failures: empty, reasons: empty, lifecycle: empty },
    specialByProduct: { flaky: { rows: [{ title: "Instável", executions: 3, failureExecutions: 3, successRate: 0, dataSource: "P" }], used: [] }, failures: empty, reasons: empty, lifecycle: empty },
    nature: { rows: [...["a", "b", "c", "d", "e", "f"].map((k) => failure(k, "2026-11-09", true)), failure("g", "2026-11-10", false)], incidents: [{ product, date: "2026-11-09", runId: "2026-11-09", failed: 6, total: 10, dataSource: "P" }], missing: [], used: [] },
    contract: { sources: [], missing: [] },
  } as unknown as DashData;
}

describe("relatório em PDF", () => {
  it("o comparativo por projeto só existe na visão geral", () => {
    expect(availableSections(false)).not.toContain("ranking");
    expect(availableSections(true)).toEqual(["summary", "volume", "ranking", "nature", "details", "flaky", "history"]);
  });

  it("calcula os números de cada seção a partir dos dados do painel", () => {
    const d = dash("api");
    expect(summaryNumbers(d, "api")).toMatchObject({ ready: true, executions: 3, failed: 7, flaky: 1 });
    expect(dailyBars(d, new Date("2026-11-10T12:00:00Z")).map((b) => `${b.date}:${b.results}:${b.rate}`)).toEqual(["2026-11-08:10:100", "2026-11-09:10:40", "2026-11-10:10:90"]);
    expect(natureCounts(d, "api")).toMatchObject({ total: 7, natures: [{ nature: "environment", count: 6 }, { nature: "investigate", count: 1 }] });
    const [ranking] = rankingRows({ api: d, ui: dash("ui") });
    expect(ranking).toMatchObject({ project: "Projeto 1", api: { failed: 7, executions: 3 }, ui: { failed: 7, executions: 3 } });
    expect(ranking!.api!.rate).toBeCloseTo((23 / 30) * 100);
  });

  it("gera capa + uma página por seção escolhida, com API e UI na mesma página", () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    drawReport(pdf, { projectName: "Projeto 1", periodLabel: "Últimos 3 dias", isOverview: false, products: { api: dash("api"), ui: dash("ui") }, include: ["summary", "volume", "details"], generatedAt: new Date("2026-11-10T12:00:00Z") });
    expect(pdf.getNumberOfPages()).toBe(4);
    const one = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    drawReport(one, { projectName: "Visitas", periodLabel: "Últimos 3 dias", isOverview: false, products: { api: dash("api") }, include: ["summary", "nature", "flaky", "history"], generatedAt: new Date("2026-11-10T12:00:00Z") });
    expect(one.getNumberOfPages()).toBe(5);
  });
});
