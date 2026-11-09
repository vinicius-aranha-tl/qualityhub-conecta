import { describe, expect, it } from "vitest";
import { normalizeDatedFailures, scenarioTitle } from "./normalize";

it("exibe somente o título do cenário sem alterar títulos que não contêm hierarquia", () => {
  expect(scenarioTitle("api/rota.spec.js › Cadastro › PBI-123 - Criar objetivo")).toBe("PBI-123 - Criar objetivo");
  expect(scenarioTitle("PBI-123 - Criar objetivo")).toBe("PBI-123 - Criar objetivo");
});

it("preserva datas e categorias apenas de falhas definitivas agendadas na primeira tentativa", () => {
  const base = { generatedAt: "2026-10-30T12:00:00Z", runId: 10, testKey: "a", event: "schedule", runAttempt: 1, status: "failed" };
  const result = normalizeDatedFailures({ retentionDays: 180, results: [{ ...base, failureCategory: "Timeout" }, { ...base, testKey: "b" }, { ...base, testKey: "c", runAttempt: 2 }, { ...base, testKey: "d", event: "push" }, { ...base, testKey: "e", status: "flaky" }] });
  expect(result.failures.map(row => row.cause)).toEqual(["Timeout", "Histórico sem classificação"]);
  expect(result.retentionDays).toBe(180);
});
import { decodeGithubContent, FormatError, normalizeEvolution, normalizeExecutions } from "./normalize";

describe("decodeGithubContent", () => {
  it("decodes base64 content from the GitHub Contents API", () => {
    const content = btoa(JSON.stringify([{ a: 1 }]));
    expect(decodeGithubContent({ content, encoding: "base64" })).toEqual([{ a: 1 }]);
  });
});

describe("normalizeExecutions", () => {
  it("mantém a execução e desconsidera testes ignorados ou pendentes nas métricas", () => {
    const [out] = normalizeExecutions([{ date: "2026-11-04", run: { event: "schedule" }, testResults: [{ title: "Executado", status: "passed" }, { title: "Ignorado", status: "skipped" }, { title: "Pendente", status: "pending" }] }], "api");
    expect(out?.results).toEqual([{ title: "Executado", status: "passed" }]);
    expect(out?.trigger).toBe("scheduled");
    const [summary] = normalizeExecutions([{ date: "2026-11-04", tests: { total: 3, passed: 1, skipped: 1, pending: 1 } }], "api");
    expect(summary?.results).toHaveLength(1);
  });
  it("reconhece a execução do Jenkins sem incluir chamadas manuais de outras contas", () => {
    const entry = (actor: string, origin: string) => ({ generatedAt: "2026-11-03T10:00:00Z", run: { id: actor, event: "workflow_dispatch", actor, origin }, tests: { total: 1, passed: 1 } });
    const out = normalizeExecutions({ executions: [entry("joao-paulo-vertem", "jenkins_schedule"), entry("outra-conta", "jenkins_schedule"), entry("outra-conta", "other")] }, "api");
    expect(out.map(row => row.trigger)).toEqual(["scheduled", "manual", "manual"]);
    const base = { generatedAt: "2026-11-03T10:00:00Z", runId: "1", testKey: "a", title: "Teste", event: "workflow_dispatch", status: "failed", origin: "jenkins_schedule" };
    expect(normalizeDatedFailures({ results: [{ ...base, actor: "joao-paulo-vertem" }, { ...base, testKey: "b", actor: "outra-conta" }] }).failures).toHaveLength(1);
  });
  it("maps aliases, statuses and triggers", () => {
    const out = normalizeExecutions({ runs: [{ run_id: 9, run_attempt: 2, event: "workflow_dispatch", started_at: "2026-10-30T10:00:00Z", tests: [{ name: "x", outcome: "unstable" }] }] }, "api");
    expect(out[0]).toMatchObject({ id: "9", runAttempt: 2, trigger: "manual", date: "2026-10-30", product: "api" });
    expect(out[0]!.results[0]!.status).toBe("flaky");
  });
  it("não classifica execuções com origem ausente como agendadas", () => {
    const [out] = normalizeExecutions([{ date: "2026-10-30", results: [{ title: "x", status: "passed" }] }], "api");
    expect(out?.trigger).toBe("unknown");
  });
  it("rejects unknown status naming the field", () => {
    expect(() => normalizeExecutions([{ date: "2026-10-30", results: [{ title: "x", status: "weird" }] }], "ui")).toThrow(/results\[0\]\.status/);
  });
});

describe("normalizeEvolution", () => {
  it("reads weekly points", () => {
    expect(normalizeEvolution({ weeks: [{ week: "2026-10-30", product: 659, automated: 185 }] })[0]).toMatchObject({ productConditions: 659, automatedConditions: 185 });
  });
  it("throws FormatError when numbers missing", () => {
    expect(() => normalizeEvolution([{ week: "2026-10-30" }])).toThrow(FormatError);
  });
});

describe("formato real Quality Hub", () => {
  const history = { schemaVersion: 1, executions: [{ generatedAt: "2026-10-30T17:03:24.602Z", workflow: "Testes API", run: { id: "41095166285", attempt: 1, event: "schedule" }, tests: { available: true, total: 88, passed: 86, failed: 1, flaky: 1, errors: 0 }, flakyTests: [{ title: "GET /x" }], testResults: [] }] };
  it("rebuilds results from summary counts", () => {
    const [e] = normalizeExecutions(history, "api");
    expect(e).toMatchObject({ id: "41095166285", runAttempt: 1, trigger: "scheduled", date: "2026-10-30" });
    expect(e!.results).toHaveLength(88);
    expect(e!.results.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(e!.results.find((r) => r.status === "flaky")!.title).toBe("GET /x");
  });
  it("reads evolution points", () => {
    expect(normalizeEvolution({ points: [{ week: "2026-10-30", productConditions: 659, automatedConditions: 0 }] })[0]!.productConditions).toBe(659);
  });
});

import { normalizeLifecycle, normalizeReasons, normalizeStability } from "./normalize";
describe("specialized files", () => {
  it("stability keeps real titles and only tests with failures", () => {
    const r = normalizeStability({ tests: [{ title: "Criar planejamento", executions: 25, failureExecutions: 6, successRatePercent: 76 }, { title: "ok", executions: 3, failureExecutions: 0 }] }, "P · UI");
    expect(r).toEqual([{ title: "Criar planejamento", executions: 25, failureExecutions: 6, successRate: 76, dataSource: "P · UI" }]);
  });
  it("reasons donut uses definitive failures only, not flaky breaks", () => {
    const r = normalizeReasons({ reasons: [{ reason: "Seletor", failedOccurrences: 0, breakOccurrences: 7 }, { reason: "Rede", failedOccurrences: 2 }], failures: [] }, "x");
    expect(r.reasons).toEqual([{ cause: "Rede", value: 2 }]);
  });
  it("never invents 'Falha sem detalhe' when error or detail exists", () => {
    const r = normalizeReasons({ reasons: [], failures: [{ error: "Timeout", occurrences: 1 }] }, "x");
    expect(r.failures[0]?.title).toBe("Timeout");
  });
  it("lifecycle sorts by occurrences desc and uses dataSourceName", () => {
    const r = normalizeLifecycle({ tests: [{ testKey: "k", firstSeen: "2026-01-01" }], failures: [{ title: "a", occurrences: 1, testKey: "k" }, { title: "b", occurrences: 5, dataSourceName: "PM API" }] }, "x");
    expect(r.map((x) => x.title)).toEqual(["b", "a"]);
    expect(r[0]?.dataSource).toBe("PM API");
    expect(r[1]?.firstSeen).toBe("2026-01-01");
  });
  it("agrupa somente cenário, erro e detalhe iguais e preserva as datas extremas", () => {
    const base = { title: "cenário", error: "erro", detail: "motivo", occurrences: 1 };
    const r = normalizeLifecycle({ failures: [
      { ...base, firstOccurrence: "2026-10-12", lastOccurrence: "2026-10-12", firstSeen: "2026-10-10" },
      { ...base, firstOccurrence: "2026-10-20", lastOccurrence: "2026-10-20", firstSeen: "2026-10-08" },
      { ...base, detail: "outro motivo" },
    ] }, "API");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ occurrences: 2, firstSeen: "2026-10-08", firstOccurrence: "2026-10-12", lastOccurrence: "2026-10-20" });
  });
  it("missing failures list is a format error", () => {
    expect(() => normalizeLifecycle({ tests: [] }, "x")).toThrow();
  });
});
