import { describe, expect, it } from "vitest";
import { frontProducts, mapProject, projectInput } from "./backend-client";

const backendProject = (fronts?: string | null) => ({
  id: "1", name: "Visitas", slug: "visitas", description: "", ...(fronts === undefined ? {} : { fronts }),
  apiRepoOwner: "Conecta-ag", apiRepoName: "api-automation-visitas-test", apiBranch: "automation-metrics",
  uiRepoOwner: null, uiRepoName: null, uiBranch: "automation-metrics",
  apiExecutionsUrl: null, apiEvolutionUrl: null, uiExecutionsUrl: null, uiEvolutionUrl: null,
  createdAt: "2026-11-10T00:00:00Z", lastSyncedAt: null, lastSyncError: null,
});

describe("frentes do projeto", () => {
  it("projetos antigos, sem o campo, continuam com API e UI", () => {
    expect(mapProject(backendProject()).fronts).toBe("api-ui");
    expect(mapProject(backendProject(null)).fronts).toBe("api-ui");
    expect(mapProject(backendProject("outra")).fronts).toBe("api-ui");
  });

  it("só API mostra só a aba de API e envia as frentes ao salvar", () => {
    const project = mapProject(backendProject("api"));
    expect(project.fronts).toBe("api");
    expect(frontProducts(project.fronts)).toEqual(["api"]);
    expect(frontProducts("ui")).toEqual(["ui"]);
    expect(frontProducts("api-ui")).toEqual(["api", "ui"]);
    expect(projectInput(project)).toMatchObject({ fronts: "api" });
  });
});
