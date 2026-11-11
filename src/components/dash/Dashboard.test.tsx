import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard";

const access = vi.hoisted(() => ({ canEdit: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => access }));
vi.mock("@/lib/backend-client", () => ({ backend: { widgets: async () => [] } }));
vi.mock("@/data/useDashboard", () => ({
  ORIGIN_LABEL: { scheduled: "Agendada" }, PERIOD_LABEL: { "30": "Últimos 30 dias" },
  useFilters: () => ({ filters: { period: "30", origins: ["scheduled"] } }),
  useDashboardData: () => ({ d: { projects: [{ project: { name: "Projeto" }, sources: { api: { executions: { mode: "github" }, evolution: { mode: "github" } }, ui: { executions: { mode: "github" }, evolution: { mode: "github" } } } }], special: { flaky: { used: [] }, lifecycle: { used: [] } }, specialByProduct: { flaky: { used: [] }, lifecycle: { used: [] }, failures: { used: [] }, reasons: { used: [] } } }, isLoading: false, periodLabel: "Últimos 30 dias" }),
}));
vi.mock("./SourceBadges", () => ({ SourceBadges: () => null }));
vi.mock("./widgets", () => ({
  DEFAULT_WIDGETS: [{ widget_type: "success_gauge", width: "half" }],
  WIDGET_CATALOG: { success_gauge: { defaultTitle: "Taxa de sucesso", description: "Taxa", info: "Informações" }, project_ranking: { defaultTitle: "Projetos", description: "Projetos" } },
  WidgetBody: () => <div>Gráfico</div>,
  HIDDEN_WIDGETS: [],
  orderPanels: <T,>(widgets: T[]) => widgets,
}));

afterEach(() => { cleanup(); access.canEdit = true; });
function showDashboard(onSources?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Dashboard projectId="projeto" slug="projeto" onSources={onSources} /></QueryClientProvider>);
}
describe("modo de edição do painel", () => {
  it("mostra os controles somente enquanto a edição estiver ativada", async () => {
    showDashboard();
    const toggle = await screen.findByRole("button", { name: "Editar painel" });
    await screen.findAllByText("Gráfico");
    expect(screen.getAllByRole("heading", { name: "Taxa de sucesso" })).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Taxa de sucesso — API" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar gráfico" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar gráfico" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getAllByRole("button", { name: "Adicionar gráfico" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Editar gráfico" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Concluir edição" }));
    expect(screen.queryByRole("button", { name: "Excluir gráfico" })).not.toBeInTheDocument();
  });
  it("não oferece edição a quem tem acesso somente de visualização", async () => {
    access.canEdit = false;
    showDashboard(vi.fn());
    await screen.findAllByText("Gráfico");
    expect(screen.queryByRole("button", { name: "Editar painel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fontes do GitHub" })).not.toBeInTheDocument();
  });
  it("mostra a configuração de fontes apenas para administrador no modo de edição", async () => {
    const openSources = vi.fn();
    showDashboard(openSources);
    const toggle = await screen.findByRole("button", { name: "Editar painel" });
    expect(screen.queryByRole("button", { name: "Fontes do GitHub" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Fontes do GitHub" }));
    expect(openSources).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Concluir edição" }));
    expect(screen.queryByRole("button", { name: "Fontes do GitHub" })).not.toBeInTheDocument();
  });
});
