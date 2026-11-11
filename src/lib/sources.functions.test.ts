import { describe, expect, it } from "vitest";
import { bugQueries, mapLimit, pickBoard, wiqlString } from "@/lib/sources.functions";

describe("mapLimit", () => {
  it("preserves order and never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([30, 10, 20, 5, 15], 2, async (ms) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active--;
      return ms * 2;
    });
    expect(result).toEqual([60, 20, 40, 10, 30]);
    expect(peak).toBe(2);
  });

  it("returns an empty list without calling fn", async () => {
    expect(await mapLimit([], 3, async () => { throw new Error("não deveria rodar"); })).toEqual([]);
  });
});

describe("consultas do Azure DevOps", () => {
  it("escapa aspas e monta as consultas de bugs, defeitos e PBIs na área raiz", () => {
    expect(wiqlString("O'Brien")).toBe("'O''Brien'");
    const q = bugQueries("ConectaMarketplace", String.raw`ConectaMarketplace\Development`);
    expect(q.bug).toContain(String.raw`[System.AreaPath] UNDER 'ConectaMarketplace\Development'`);
    expect(q.bug).toContain("[System.WorkItemType] = 'Bug'");
    expect(q.defeito).toContain("[System.Tags] CONTAINS 'DEFEITO'");
    expect(q.pbi).toContain("IN GROUP 'Microsoft.RequirementCategory'");
  });

  it("escolhe o quadro de requisitos do time", () => {
    expect(pickBoard([{ name: "Epics", url: "" }, { name: "Backlog items", url: "" }, { name: "Features", url: "" }])?.name).toBe("Backlog items");
    expect(pickBoard([{ name: "Epics", url: "" }, { name: "Custom", url: "" }])?.name).toBe("Custom");
    expect(pickBoard([])).toBeNull();
  });
});
