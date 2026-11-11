import { describe, expect, it } from "vitest";
import {
  agingOpen,
  currentTests,
  clearProjection,
  bugWeeklyFlow,
  bugRatio,
  bugsByColumn,
  computeProjection,
  squadComparison,
  squadOf,
  countCoveredConditions,
  dailyExecutionVolume,
  dedupeExecutions,
  failureRows,
  filterExecutions,
  flakyTable,
  rateTone,
  summarize,
  summarizeExecutionHealth,
  type EvolutionPoint,
  type Execution,
  classifyFailures,
  detectIncidents,
  failureEvidence,
  failureSymptom,
  groupClassified,
  natureDistribution,
  testLocation,
  bugBurnup,
  bugDistribution,
  bugSummary,
  type BugItem,
  classifyByEvidence,
  contractSummary,
  endpointCoverage,
  isTestableStatus,
  type ContractCoverage,
  type CapturedEvidence,
  type TestOccurrence,
} from "./metrics";

const ex = (o: Partial<Execution>): Execution => ({
  id: "x", product: "api", triggerId: "t1", runAttempt: 1, trigger: "scheduled", date: "2026-10-01", dataSource: "ds", results: [], ...o,
});

it("separa execuções por faixa e calcula a taxa conjunta sem incluir dados ausentes", () => {
  const tests = (passed: number, failed: number) => [...Array.from({ length: passed }, (_, i) => ({ title: `p${i}`, status: "passed" as const })), ...Array.from({ length: failed }, (_, i) => ({ title: `f${i}`, status: "failed" as const }))];
  const result = summarizeExecutionHealth([ex({ id: "critica", results: tests(7, 3) }), ex({ id: "atencao", results: tests(8, 2) }), ex({ id: "boa", results: tests(9, 1) }), ex({ id: "vazia" })]);
  expect(result.critical.map(item => item.execution.id)).toEqual(["critica"]);
  expect(result.attention.map(item => item.execution.id)).toEqual(["atencao"]);
  expect(result.healthySummary.rate).toBe(90);
  expect(result.missing).toHaveLength(1);
});

it("conta ações e cenários por dia sem contar reruns", () => {
  const results = [{ title: "a", status: "passed" as const }, { title: "b", status: "failed" as const }];
  const data = dedupeExecutions([
    ex({ id: "1", triggerId: "projeto-a-1", results }),
    ex({ id: "1", triggerId: "projeto-a-1", runAttempt: 2, results }),
    ex({ id: "2", triggerId: "projeto-b-1", results }),
    ex({ id: "3", triggerId: "projeto-a-2", date: "2026-10-02", results: [] }),
  ]);
  expect(dailyExecutionVolume(data)).toEqual([
    { date: "2026-10-01", ciRuns: 2, scenarioRuns: 4 },
    { date: "2026-10-02", ciRuns: 1, scenarioRuns: null },
  ]);
});

it("filtra 15 dias incluindo hoje e os 14 dias anteriores", () => {
  const rows = [ex({ id: "dentro", date: "2026-10-17" }), ex({ id: "fora", date: "2026-10-16" }), ex({ id: "hoje", date: "2026-10-31" })];
  expect(filterExecutions(rows, { product: "api", origins: ["scheduled"], periodDays: 15, now: new Date("2026-10-31T12:00:00Z") }).map(row => row.id)).toEqual(["dentro", "hoje"]);
});

describe("success rate", () => {
  it("flaky counts as success, definitive failure does not", () => {
    const s = summarize([ex({ results: [{ title: "a", status: "passed" }, { title: "b", status: "flaky" }, { title: "c", status: "failed" }, { title: "d", status: "passed" }] })]);
    expect(s.rate).toBe(75);
    expect(s.flaky).toBe(1);
  });
  it("returns null without data", () => expect(summarize([]).rate).toBeNull());
  it("tone thresholds", () => {
    expect(rateTone(90)).toBe("success");
    expect(rateTone(89.99)).toBe("warning");
    expect(rateTone(80)).toBe("warning");
    expect(rateTone(79.99)).toBe("danger");
  });
});

describe("dedup", () => {
  it("ignores reruns of the same trigger, keeps first attempt", () => {
    const r = dedupeExecutions([
      ex({ id: "a2", runAttempt: 2, results: [{ title: "a", status: "passed" }] }),
      ex({ id: "a1", runAttempt: 1, results: [{ title: "a", status: "failed" }] }),
    ]);
    expect(r.map((e) => e.id)).toEqual(["a1"]);
  });
  it("counts a failure once per execution", () => {
    const rows = failureRows([ex({ results: [{ title: "a", status: "failed", error: "E" }, { title: "a", status: "failed", error: "E" }] })]);
    expect(rows[0]?.occurrences).toBe(1);
  });
  it("separa falhas do mesmo cenário e erro quando os detalhes são diferentes", () => {
    const rows = failureRows([ex({ results: [{ title: "a", status: "failed", error: "E", detail: "motivo 1" }, { title: "a", status: "failed", error: "E", detail: "motivo 2" }] })]);
    expect(rows).toHaveLength(2);
  });
});

it("classifica como instável somente a partir de três execuções com falha", () => {
  const executions = [1, 2, 3].map(i => ex({ id: String(i), triggerId: String(i), results: [{ title: "instável", status: i === 3 ? "failed" : "flaky" }, { title: "com duas falhas", status: i === 3 ? "passed" : "flaky" }] }));
  expect(flakyTable(executions)).toEqual([{ title: "instável", executions: 3, failureExecutions: 3, dataSource: "ds" }]);
});

describe("coverage", () => {
  it("multiple tests on the same condition count once; extras outside contract ignored", () => {
    const c = { route: "/r", method: "GET", status: 200, contract: "R" };
    expect(countCoveredConditions([c, { ...c, status: 400 }], [c, c, { ...c, route: "/x" }])).toBe(1);
  });
});

const pts = (p: number[], a: number[]): EvolutionPoint[] =>
  p.map((v, i) => ({ week: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, "0")}`, productConditions: v, automatedConditions: a[i] ?? 0, projectedAutomatedConditions: null }));

describe("projection", () => {
  it("insufficient history with fewer than 3 weeks", () => {
    expect(computeProjection(pts([10, 11], [1, 2])).status).toBe("insufficient");
  });
  it("preserva os pontos existentes e calcula velocidade pelo tempo entre as datas", () => {
    const two = computeProjection(pts([10, 11], [1, 2]));
    expect(two.series).toHaveLength(2);
    const points = [{ week: "2026-10-01", productConditions: 100, automatedConditions: 10, projectedAutomatedConditions: null }, { week: "2026-10-08", productConditions: 102, automatedConditions: 20, projectedAutomatedConditions: null }, { week: "2026-10-22", productConditions: 106, automatedConditions: 40, projectedAutomatedConditions: null }];
    const result = computeProjection(points);
    expect(result.status).toBe("parity");
    if (result.status === "parity") { expect(result.productVelocity).toBeCloseTo(2); expect(result.automationVelocity).toBeCloseTo(10); }
  });
  it("projeta produto e automação e limita previsões excessivamente longas", () => {
    const result = computeProjection(pts([100, 101, 102], [10, 20, 30]));
    expect(result.status).toBe("parity");
    if (result.status === "parity") {
      const future = result.series.at(-1)!;
      expect(future.projectedProductConditions).toBeGreaterThan(102);
      expect(future.projectedAutomatedConditions).toBeGreaterThan(30);
    }
    expect(computeProjection(pts([10000, 10000, 10000], [1, 2, 3])).status).toBe("beyond-horizon");
  });
  it("no parity when automation grows slower or equal", () => {
    expect(computeProjection(pts([10, 12, 14], [1, 3, 5])).status).toBe("no-parity");
  });
  it("parity weeks = gap / velocity difference", () => {
    const r = computeProjection(pts([100, 101, 102], [10, 20, 30]));
    expect(r.status).toBe("parity");
    if (r.status === "parity") expect(r.weeksRemaining).toBe(Math.ceil(72 / 9));
  });
});

import { coverageWaterfall as _cw, topFailingTests as _tf } from "./metrics";
describe("novos gráficos", () => {
  it("cascata: primeira barra é o total inicial, depois variações semanais", () => {
    const r = _cw([
      { week: "2026-01-05", productConditions: 100, automatedConditions: 10, projectedAutomatedConditions: null },
      { week: "2026-01-12", productConditions: 100, automatedConditions: 15, projectedAutomatedConditions: null },
      { week: "2026-01-19", productConditions: 100, automatedConditions: 12, projectedAutomatedConditions: null },
    ]);
    expect(r.map((x) => x.delta)).toEqual([10, 5, -3]);
    expect(r[2]!.base).toBe(12);
  });
  it("ranking de falhas soma ocorrências por teste e limita a 10", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ title: `t${i % 11}`, error: "", detail: "", cause: "", occurrences: 1, dataSource: "", firstSeen: "", firstOccurrence: "", lastOccurrence: "" }));
    const r = _tf(rows);
    expect(r).toHaveLength(10);
    expect(r[0]).toEqual({ title: "t0", value: 2 });
  });
});

describe("motivo das falhas", () => {
  const occ = (o: Partial<TestOccurrence>): TestOccurrence => ({ product: "api", date: "2026-11-01", runId: "r1", testKey: "|a.spec.js|10|Cenário", title: "Cenário", status: "failed", dataSource: "P · API", ...o });
  const passing = (runId: string, n: number) => Array.from({ length: n }, (_, i) => occ({ runId, testKey: `ok-${i}`, status: "passed" }));

  it("identifica o sintoma pela mensagem e guarda o trecho usado como evidência", () => {
    expect(failureSymptom("TimeoutError: apiRequestContext.get: Timeout 10000ms exceeded.")).toBe("api_timeout");
    expect(failureSymptom("TimeoutError: page.waitForResponse: Timeout 10000ms exceeded while waiting for event \"response\"")).toBe("response_timeout");
    expect(failureSymptom("TimeoutError: locator.selectOption: Timeout 10000ms exceeded.")).toBe("element_missing");
    expect(failureSymptom("Error:  expect(  locator  ). toBeVisible (  )  failed")).toBe("element_missing");
    expect(failureSymptom("Error:  expect(  locator  ).not. toHaveValue (  expected  )  failed")).toBe("element_state");
    expect(failureSymptom("Error: strict mode violation: locator resolved to 2 elements")).toBe("strict_selector");
    expect(failureSymptom("Error: Itens fora da ordem \"label asc\" na posição 516")).toBe("assertion");
    expect(failureSymptom("Error: expected status 200, received 500")).toBe("server_error");
    expect(failureSymptom("Error: status 503 Service Unavailable")).toBe("connection");
    expect(failureSymptom("Error: page.goto: net::ERR_CONNECTION_REFUSED")).toBe("connection");
    expect(failureSymptom("Error: Preparação do objetivo falhou: http://svc/admin/workspaces/6")).toBe("test_data");
    expect(failureSymptom("Error: received 401 Unauthorized")).toBe("auth");
    expect(failureSymptom("Detalhe não registrado no histórico", "Timeout ou sincronização")).toBe("timeout");
    expect(failureSymptom("", "Autenticação ou permissão")).toBe("unknown");
    expect(failureEvidence("Error: expected status 200, received 500").evidence).toBe("received 500");
  });

  it("agrupa falha em massa como um incidente de ambiente", () => {
    const run = [
      ...Array.from({ length: 6 }, (_, i) => occ({ runId: "massa", testKey: `f${i}`, summary: "Error: expect(received).toBe(expected)" })),
      ...passing("massa", 4),
      occ({ runId: "isolada", testKey: "x", summary: "Error: expect(received).toBe(expected)" }),
      ...passing("isolada", 9),
    ];
    expect(detectIncidents(run)).toMatchObject([{ runId: "massa", failed: 6, total: 10 }]);
    const classified = classifyFailures(run);
    expect(classified.filter((r) => r.incident).every((r) => r.nature === "environment" && r.confidence === "alta")).toBe(true);
    expect(classified.find((r) => r.runId === "isolada")).toMatchObject({ nature: "investigate", confidence: "baixa", incident: false });
  });

  it("só aponta bug ou ambiente com evidência; casos ambíguos ficam para análise", () => {
    const rows = classifyFailures([
      ...["r1", "r2", "r3"].map((runId) => occ({ runId, testKey: "lento", summary: "TimeoutError: apiRequestContext.get: Timeout 10000ms exceeded." })),
      occ({ runId: "r1", testKey: "uma-vez", summary: "TimeoutError: apiRequestContext.get: Timeout 10000ms exceeded." }),
      occ({ product: "ui", dataSource: "P · UI", runId: "u1", testKey: "tela", summary: "Error: expect(locator).toBeVisible() failed" }),
      occ({ runId: "r4", testKey: "erro500", summary: "Error: expected status 200, received 500" }),
      occ({ runId: "r4", testKey: "dado", summary: "Error: registro já existe" }),
      occ({ runId: "r4", testKey: "nada" }),
      occ({ runId: "r4", testKey: "dup" }),
      occ({ runId: "r4", testKey: "dup" }),
    ]);
    const byKey = (k: string) => rows.find((r) => r.testKey === k)!;
    expect(byKey("lento")).toMatchObject({ nature: "product", confidence: "média", failedRuns: 3 });
    expect(byKey("uma-vez")).toMatchObject({ nature: "investigate", confidence: "baixa" });
    expect(byKey("tela")).toMatchObject({ nature: "investigate", product: "ui" });
    expect(byKey("tela").rule).toContain("404");
    expect(byKey("erro500")).toMatchObject({ nature: "product", confidence: "média", evidence: "received 500", source: "mensagem" });
    expect(byKey("erro500").rule).toContain("received 500");
    expect(byKey("dado").nature).toBe("test_data");
    expect(byKey("nada").nature).toBe("investigate");
    expect(rows.filter((r) => r.testKey === "dup")).toHaveLength(1);
    expect(natureDistribution(rows).find((d) => d.nature === "investigate")).toMatchObject({ api: 3, ui: 1 });
    const group = groupClassified(rows).find((g) => g.testKey === "lento")!;
    expect(group).toMatchObject({ occurrences: 3, nature: "product" });
    expect(group.runs.map((r) => r.runId)).toEqual(["r1", "r2", "r3"]);
    expect(testLocation("chromium|e2e/a.spec.js|6|Título")).toBe("e2e/a.spec.js:6");
  });
});

describe("motivo pela evidência capturada", () => {
  const ev = (o: Partial<CapturedEvidence>): CapturedEvidence => ({ phase: "verificacao", failedStep: "Então vejo o resultado", timedOut: false, calls: [], httpErrors: [], networkFailures: [], pageErrors: [], consoleErrors: [], ...o });
  const ui = (o: Partial<CapturedEvidence>) => ev({ layer: "ui", pageUrl: "https://app/visitas", ...o });
  const api = (o: Partial<CapturedEvidence>) => ev({ layer: "api", ...o });
  const nature = (c: CapturedEvidence, symptom: Parameters<typeof classifyByEvidence>[1] = "assertion", runs = 1) => classifyByEvidence(c, symptom, runs)?.slice(0, 2);

  it("tela com 404 é bug com evidência forte, não ajuste de teste", () => {
    const verdict = classifyByEvidence(ui({ httpErrors: [{ method: "GET", url: "https://app/visitas", status: 404, type: "document" }] }), "element_missing", 1)!;
    expect(verdict.slice(0, 2)).toEqual(["product", "alta"]);
    expect(verdict[3]).toEqual(["GET /visitas → 404"]);
    expect(nature(ui({ httpErrors: [{ method: "GET", url: "https://app/api/visitas", status: 404, type: "fetch" }] }), "element_missing")).toEqual(["product", "média"]);
    expect(nature(ui({ httpErrors: [{ method: "GET", url: "https://app/api/me", status: 401, type: "xhr" }] }), "element_missing")).toEqual(["environment", "média"]);
  });

  it("separa ambiente, sistema e credencial pelas chamadas", () => {
    expect(nature(ui({ networkFailures: [{ method: "GET", url: "https://app/visitas", error: "net::ERR_CONNECTION_REFUSED" }] }))).toEqual(["environment", "alta"]);
    expect(nature(api({ calls: [{ method: "GET", url: "https://api/x", status: 503 }] }))).toEqual(["environment", "alta"]);
    expect(nature(api({ calls: [{ method: "PUT", url: "https://api/x", status: null, error: "connect ECONNREFUSED" }] }))).toEqual(["environment", "alta"]);
    const server = classifyByEvidence(api({ calls: [{ method: "POST", url: "https://api/objectives", status: 201 }, { method: "GET", url: "https://api/workspaces/1/objectives", status: 500, detail: "Mongo timeout" }] }), "assertion", 1)!;
    expect(server.slice(0, 2)).toEqual(["product", "alta"]);
    expect(server[3]).toEqual(["GET /workspaces/1/objectives → 500 (Mongo timeout)"]);
    expect(nature(api({ phase: "preparacao", calls: [{ method: "POST", url: "https://login/realms/x/protocol/openid-connect/token", status: 401 }] }))).toEqual(["environment", "alta"]);
  });

  it("4xx de negócio na API não decide sozinho: testes negativos esperam 4xx", () => {
    expect(classifyByEvidence(api({ calls: [{ method: "POST", url: "https://api/objectives", status: 400 }] }), "assertion", 1)).toBeNull();
  });

  it("falha na preparação sem erro de sistema é massa de teste", () => {
    expect(nature(api({ phase: "preparacao", failedStep: "Dado que existe uma visita", calls: [{ method: "GET", url: "https://api/visits", status: 200 }] }))).toEqual(["test_data", "média"]);
  });

  it("elemento ausente numa tela sem erros é ajuste no teste ou tela alterada", () => {
    expect(nature(ui({}), "element_missing")).toEqual(["automation", "média"]);
    expect(nature(ui({}), "strict_selector")).toEqual(["automation", "alta"]);
    expect(nature(ui({ pageErrors: ["TypeError: x is undefined"] }), "element_missing")).toEqual(["product", "média"]);
    expect(classifyByEvidence(ui({}), "element_state", 1)).toBeNull();
  });

  it("tempo limite isolado fica a confirmar; recorrente indica lentidão do sistema", () => {
    const slow = api({ calls: [{ method: "GET", url: "https://api/x", status: null, error: "apiRequestContext.get: Timeout 10000ms exceeded." }] });
    expect(nature(slow, "api_timeout", 1)).toEqual(["investigate", "baixa"]);
    expect(nature(slow, "api_timeout", 3)).toEqual(["product", "média"]);
  });

  it("classifyFailures usa a evidência quando existe e marca a origem da decisão", () => {
    const occ = (o: Partial<TestOccurrence>): TestOccurrence => ({ product: "ui", date: "2026-11-09", runId: "r1", testKey: "k", title: "Agendar visita", status: "failed", dataSource: "P · UI", summary: "Error: expect(locator).toBeVisible() failed", ...o });
    const [withEvidence] = classifyFailures([occ({ captured: ui({ httpErrors: [{ method: "GET", url: "https://app/visitas", status: 404, type: "document" }] }) })]);
    expect(withEvidence).toMatchObject({ nature: "product", confidence: "alta", source: "evidencia", proof: ["GET /visitas → 404"] });
    const [withoutEvidence] = classifyFailures([occ({ testKey: "k2" })]);
    expect(withoutEvidence).toMatchObject({ nature: "investigate", source: "mensagem", proof: [] });
  });
});

it("só cita a categoria publicada quando realmente não há mensagem", () => {
  const base = { product: "api" as const, date: "2026-11-05", runId: "r", title: "T", status: "failed" as const, dataSource: "P · API", cause: "Resposta ou regra divergente" };
  const [comMensagem] = classifyFailures([{ ...base, testKey: "a", summary: "Error: Itens fora da ordem \"label asc\" na posição 16" }]);
  expect(comMensagem!.rule).not.toContain("Sem mensagem");
  const [semMensagem] = classifyFailures([{ ...base, testKey: "b" }]);
  expect(semMensagem!.rule).toContain("Sem mensagem");
});

describe("cobertura do contrato da API", () => {
  const coverage = (conditions: ContractCoverage["conditions"]): ContractCoverage => ({ generatedAt: "2026-11-10", sourceRepository: "Conecta-ag/x", sourceBranch: "main", sourceCommit: "abc", conditions });
  const c = (method: string, path: string, status: string, covered = false) => ({ method, path, status, covered });

  it("o endpoint com todas as condições testáveis cobertas fica com 100%, sem contar 5xx e 429", () => {
    const [endpoint] = endpointCoverage([{ project: "P", coverage: coverage([
      c("GET", "/visits", "200", true), c("GET", "/visits", "400", true), c("GET", "/visits", "401", true),
      c("GET", "/visits", "403", true), c("GET", "/visits", "404", true), c("GET", "/visits", "422", true),
      c("GET", "/visits", "500"), c("GET", "/visits", "429"),
    ]) }]);
    expect(endpoint).toMatchObject({ testable: 6, covered: 6, percent: 100, missingStatuses: [], excludedStatuses: ["429", "500"] });
    expect(isTestableStatus("502")).toBe(false);
    expect(isTestableStatus(409)).toBe(true);
  });

  it("lista o que falta e soma vários projetos sem misturar endpoints", () => {
    const endpoints = endpointCoverage([
      { project: "A", coverage: coverage([c("POST", "/visits", "201", true), c("POST", "/visits", "400"), c("POST", "/visits", "401"), c("GET", "/health", "500")]) },
      { project: "B", coverage: coverage([c("POST", "/visits", "201"), c("DELETE", "/visits/{id}", "204", true)]) },
    ]);
    const a = endpoints.find((e) => e.project === "A" && e.method === "POST")!;
    expect(a).toMatchObject({ testable: 3, covered: 1, percent: 33.33, coveredStatuses: ["201"], missingStatuses: ["400", "401"] });
    expect(endpoints.find((e) => e.path === "/health")).toMatchObject({ testable: 0, percent: null });
    expect(contractSummary(endpoints)).toEqual({ testable: 5, covered: 2, percent: 40, excluded: 1, endpoints: 3, fullyCovered: 1, partiallyCovered: 1, notCovered: 1 });
    expect(contractSummary([])).toMatchObject({ testable: 0, percent: null });
  });
});

it("rota do gateway sem backend (status default) fica fora da base", () => {
  const [endpoint] = endpointCoverage([{ project: "P", coverage: { generatedAt: "", sourceRepository: "", sourceBranch: "main", sourceCommit: "", conditions: [
    { method: "GET", path: "/recomenda/legado", status: "default", covered: false },
  ] } }]);
  expect(endpoint).toMatchObject({ testable: 0, percent: null, excludedStatuses: ["default"] });
  expect(isTestableStatus("default")).toBe(false);
});

describe("bugs do Azure DevOps", () => {
  const bug = (id: number, created: string, category = "Proposed", closed: string | null = null, extra: Partial<BugItem> = {}): BugItem => ({
    id, kind: "bug", title: `Bug ${id}`, state: category === "Completed" ? "Done" : "New", category, severity: "3 - Medium", priority: "2", assignedTo: "", createdDate: `${created}T10:00:00Z`, closedDate: closed ? `${closed}T10:00:00Z` : null, stateChangeDate: null, iteration: "", areaPath: "", squad: "Titans", column: "", url: "", ...extra,
  });
  const items = [
    bug(1, "2026-09-01", "Completed", "2026-09-10"),
    bug(2, "2026-09-03", "Completed", "2026-09-20"),
    bug(3, "2026-09-15"),
    bug(4, "2026-09-18", "InProgress", null, { severity: "1 - Critical" }),
    bug(5, "2026-09-19", "Removed"),
  ];

  it("resume abertos e concluídos sem contar removidos e projeta a conclusão pelo ritmo do período", () => {
    // Criou 4 e concluiu 2 no período: os abertos não estão caindo, então não há previsão.
    expect(bugSummary(items, "2026-09-01", "2026-09-30")).toEqual({ total: 4, open: 2, done: 2, donePercent: 50, createdInPeriod: 4, doneInPeriod: 2, projection: null });
    // Nenhum criado e 2 concluídos em 30 dias: 1 aberto restante cai em 15 dias.
    const draining = [bug(10, "2026-08-01", "Completed", "2026-09-10"), bug(11, "2026-08-02", "Completed", "2026-09-12"), bug(12, "2026-08-03")];
    expect(bugSummary(draining, "2026-09-01", "2026-09-30").projection).toBe("2026-10-15");
    expect(bugSummary(items, "2026-09-16", "2026-09-30")).toMatchObject({ createdInPeriod: 1, doneInPeriod: 1 });
    expect(bugSummary([], null, "2026-09-30")).toMatchObject({ total: 0, donePercent: null, projection: null });
  });

  it("monta o burnup semanal fechando na sexta", () => {
    expect(bugBurnup(items, "2026-09-01", "2026-09-22")).toEqual([
      { week: "2026-09-04", scope: 2, done: 0, open: 2 },
      { week: "2026-09-11", scope: 2, done: 1, open: 1 },
      { week: "2026-09-18", scope: 4, done: 1, open: 3 },
      { week: "2026-09-22", scope: 4, done: 2, open: 2 },
    ]);
  });

  it("conta criados e concluídos em cada semana e os abertos no fim dela", () => {
    expect(bugWeeklyFlow(items, "2026-09-01", "2026-09-22")).toEqual([
      { week: "2026-09-04", created: 2, done: 0, open: 2 },
      { week: "2026-09-11", created: 0, done: 1, open: 1 },
      { week: "2026-09-18", created: 2, done: 0, open: 3 },
      { week: "2026-09-22", created: 0, done: 1, open: 2 },
    ]);
  });

  it("projeta as semanas para zerar os abertos pelo ritmo de conclusão, sem novos itens", () => {
    // 8 concluídos nas últimas 8 semanas = 1 por semana; 3 abertos zeram em 3 semanas.
    const done = Array.from({ length: 8 }, (_, i) => bug(100 + i, "2026-08-01", "Completed", `2026-09-${String(10 + i * 2).padStart(2, "0")}`));
    const open = [bug(200, "2026-09-01"), bug(201, "2026-09-02"), bug(202, "2026-09-03")];
    const p = clearProjection([...done, ...open], "2026-09-30");
    expect(p).toMatchObject({ open: 3, perWeek: 1, weeks: 3, date: "2026-10-21" });
    expect(p.points.slice(-4).map((x) => [x.week, x.actual, x.projected])).toEqual([["2026-09-30", 3, 3], ["2026-10-07", null, 2], ["2026-10-14", null, 1], ["2026-10-21", null, 0]]);
    expect(clearProjection(open, "2026-09-30")).toMatchObject({ perWeek: 0, weeks: null, date: null });
    expect(clearProjection(done, "2026-09-30")).toMatchObject({ open: 0, weeks: 0 });
  });

  it("distribui por campo, do maior para o menor, sem removidos", () => {
    expect(bugDistribution(items, "severity")).toEqual([{ label: "3 - Medium", value: 3 }, { label: "1 - Critical", value: 1 }]);
    expect(bugDistribution(items, "squad")).toEqual([{ label: "Titans", value: 4 }]);
  });

  it("identifica a squad pela primeira subárea abaixo da raiz", () => {
    const root = String.raw`ConectaMarketplace\Development`;
    expect(squadOf(String.raw`ConectaMarketplace\Development\Team Titans`, root)).toBe("Titans");
    expect(squadOf(String.raw`ConectaMarketplace\Development\Team Vanguard\Mobile`, root + "\\")).toBe("Vanguard");
    expect(squadOf(String.raw`ConectaMarketplace\Development`, root)).toBe("Sem squad");
    expect(squadOf(String.raw`ConectaMarketplace\Discovery`, root)).toBe("Sem squad");
  });

  it("conta os abertos por coluna do quadro e marca o WIP estourado com os PBIs da coluna", () => {
    const columns = [{ name: "A", wip: null, done: false }, { name: "D", wip: 2, done: false }, { name: "Done", wip: null, done: true }];
    const bugs = [bug(1, "2026-09-01", "Proposed", null, { column: "A" }), bug(2, "2026-09-01", "InProgress", null, { column: "D" }), bug(3, "2026-09-01", "Completed", "2026-09-02", { column: "Done" })];
    const pbis = [bug(4, "2026-09-01", "InProgress", null, { kind: "pbi", column: "D" }), bug(5, "2026-09-01", "InProgress", null, { kind: "pbi", column: "D" })];
    expect(bugsByColumn(columns, bugs, pbis)).toEqual([
      { column: "A", bugs: 1, others: 0, total: 1, wip: null, overWip: false },
      { column: "D", bugs: 1, others: 2, total: 3, wip: 2, overWip: true },
    ]);
  });

  it("ordena os abertos pelo tempo parado no estado atual", () => {
    const list = [bug(1, "2026-09-01", "Proposed", null, { stateChangeDate: "2026-09-25T08:00:00Z" }), bug(2, "2026-09-10"), bug(3, "2026-09-01", "Completed", "2026-09-05")];
    expect(agingOpen(list, "2026-09-30").map((b) => [b.id, b.ageDays])).toEqual([[2, 20], [1, 5]]);
  });

  it("compara as squads e calcula a proporção de bugs sobre bugs + PBIs criados no período", () => {
    const list = [
      bug(1, "2026-09-02"), bug(2, "2026-09-03", "Completed", "2026-09-04"),
      bug(3, "2026-09-05", "Proposed", null, { squad: "Vanguard" }),
      bug(10, "2026-09-02", "Proposed", null, { kind: "pbi" }), bug(11, "2026-09-02", "Proposed", null, { kind: "pbi" }), bug(12, "2026-08-02", "Proposed", null, { kind: "pbi" }),
    ];
    const rows = squadComparison(list, "2026-09-01", "2026-09-30");
    expect(rows.map((r) => [r.squad, r.open, r.total, r.bugRatio, r.avgOpenAgeDays])).toEqual([["Titans", 1, 2, 50, 28], ["Vanguard", 1, 1, 100, 25]]);
    expect(bugRatio([], [], null, "2026-09-30")).toBeNull();
  });
});

describe("testes atuais", () => {
  const run = (dataSource: string, date: string, titles: string[], id = date): Execution => ({ id: dataSource + id, product: "api", triggerId: id, runAttempt: 1, trigger: "scheduled", date, dataSource, results: titles.map((title) => ({ title, status: "passed" })) });
  it("conta os cenários da última execução de cada projeto e soma os projetos, sem os nomes antigos", () => {
    const execs = [
      run("Recomenda · API", "2026-11-10", ["a - HTTP 201", "b - HTTP 400"]),
      run("Recomenda · API", "2026-11-11", ["a - SUCESSO", "b - ERRO 400"]),
      run("Recomenda · API", "2026-11-11", ["c - SUCESSO"], "shard-2"),
      run("Visitas · API", "2026-11-09", ["v1", "v2", "v3"]),
    ];
    expect(currentTests(execs, "api")).toEqual({ total: 6, projects: [{ dataSource: "Recomenda · API", date: "2026-11-11", count: 3 }, { dataSource: "Visitas · API", date: "2026-11-09", count: 3 }] });
    expect(currentTests(execs, "ui")).toEqual({ total: 0, projects: [] });
  });
});
