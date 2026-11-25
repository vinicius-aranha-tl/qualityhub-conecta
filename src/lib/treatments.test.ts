import { describe, expect, it } from "vitest";
import { summarizeTreatments, treatmentFor, treatmentLine, type Treatment } from "@/lib/metrics";
import { FormatError, normalizeTreatments } from "@/lib/normalize";

const ds = "Conecta Recomenda · UI";
const base = { tests: ["UI-VISITAS-012"], runs: [], justification: "", correction: "", product: "ui" as const, dataSource: ds };

describe("normalizeTreatments", () => {
  it("lê { tratativas: [...] } e ignora itens inválidos sem derrubar o arquivo", () => {
    const out = normalizeTreatments({ tratativas: [
      { id: "a", testes: ["UI-VISITAS-012"], classificacao: "massa", justificativa: "Massa mudou de estado.", correcao: "Massa exclusiva.", status: "corrigido", data: "2026-11-20" },
      { testes: ["UI-X-001"], classificacao: "desconhecida", status: "corrigido", data: "2026-11-20" },
      { testes: [], classificacao: "massa", status: "corrigido", data: "2026-11-20" },
      { testes: "UI-X-002", classificacao: "codificacao", status: "recorrente", data: "2026-11-21T10:00:00Z" },
    ] }, "ui", ds);
    expect(out.map((t) => [t.id, t.classification, t.status, t.date])).toEqual([
      ["a", "massa", "corrigido", "2026-11-20"],
      ["2026-11-21-UI-X-002", "codificacao", "recorrente", "2026-11-21"],
    ]);
    expect(out[0]).toMatchObject({ product: "ui", dataSource: ds, justification: "Massa mudou de estado.", correction: "Massa exclusiva." });
  });

  it("aceita a lista direto e rejeita estrutura errada", () => {
    expect(normalizeTreatments([], "api", ds)).toEqual([]);
    expect(() => normalizeTreatments({ itens: [] }, "api", ds)).toThrow(FormatError);
  });
});

describe("treatmentFor", () => {
  const list: Treatment[] = [
    { ...base, id: "1", classification: "massa", status: "em-investigacao", date: "2026-11-10" },
    { ...base, id: "2", classification: "massa", status: "corrigido", date: "2026-11-20" },
    { ...base, id: "3", classification: "codificacao", status: "corrigido", date: "2026-11-21", dataSource: "Outro · UI" },
  ];
  it("casa pelo testId dentro da chave e devolve a mais recente da mesma fonte", () => {
    expect(treatmentFor({ title: "PBI-1 - Agendar", testKey: "chromium|UI-VISITAS-012", dataSource: ds, product: "ui" }, list)?.id).toBe("2");
  });
  it("casa pelo título (API) e não mistura frente ou fonte", () => {
    const api: Treatment = { ...base, id: "4", tests: ["PBI-9 - Criar objetivo - HTTP 201"], product: "api", dataSource: "X · API", classification: "infra-ambiente", status: "corrigido", date: "2026-11-01" };
    expect(treatmentFor({ title: "PBI-9 - Criar objetivo - HTTP 201", testKey: "chromium|arquivo|3|t", dataSource: "X · API", product: "api" }, [api])?.id).toBe("4");
    expect(treatmentFor({ title: "PBI-9 - Criar objetivo - HTTP 201", testKey: "k", dataSource: "X · API", product: "ui" }, [api])).toBeUndefined();
  });
});

describe("summarizeTreatments e treatmentLine", () => {
  it("conta por causa, separa resolvidas, em aberto e recorrentes e traz a correção mais recente", () => {
    const list: Treatment[] = [
      { ...base, id: "1", classification: "massa", status: "corrigido", correction: "Before que confere o estado.", date: "2026-11-10" },
      { ...base, id: "2", classification: "massa", status: "corrigido", correction: "Massa exclusiva com data distante.", date: "2026-11-20" },
      { ...base, id: "3", classification: "massa", status: "em-investigacao", date: "2026-11-21" },
      { ...base, id: "4", classification: "bug-produto", status: "aguardando-produto", correction: "Bug aberto no Azure.", date: "2026-11-18" },
    ];
    const s = summarizeTreatments(list);
    expect(s.map((x) => x.classification)).toEqual(["bug-produto", "massa"]);
    const massa = s.find((x) => x.classification === "massa")!;
    expect(massa).toMatchObject({ total: 3, fixed: 2, open: 1, recurring: 0, corrections: ["Massa exclusiva com data distante.", "Before que confere o estado."] });
    expect(treatmentLine(massa)).toBe("Massa de teste: 3 falhas, 2 corrigidas, 1 em aberto — Massa exclusiva com data distante.");
    expect(treatmentLine(s[0]!)).toBe("Bug do produto: 1 falha, 0 corrigidas, 1 em aberto — Bug aberto no Azure.");
  });
});
