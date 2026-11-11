import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Dashboard } from "@/components/dash/Dashboard";
import { EmptyState, PageTitle, Panel } from "@/components/dash/primitives";
import { BugFlow, BugClearProjection, BugCards, BugsStatus, SquadTable, bugPeriod } from "@/components/dash/bugs";
import { useBugs, useFilters, PERIOD_LABEL } from "@/data/useDashboard";
import { useAuth } from "@/hooks/useAuth";
import { squadComparison } from "@/lib/metrics";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingOverlay } from "@/components/dash/LoadingOverlay";

type Aba = "automacao" | "bugs";

export const Route = createFileRoute("/_authenticated/visao-geral")({
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } => (s["aba"] === "bugs" ? { aba: "bugs" } : {}),
  head: () => ({
    meta: [
      { title: "Visão geral — Quality Hub" },
      { name: "description", content: "Automação de API e UI e bugs de todos os projetos integrados." },
      { property: "og:title", content: "Visão geral — Quality Hub" },
      { property: "og:description", content: "Automação de API e UI e bugs de todos os projetos integrados." },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const { aba = "automacao" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { canEdit } = useAuth();
  const tab: Aba = aba === "bugs" && canEdit ? "bugs" : "automacao";
  return (
    <>
      <PageTitle title="Visão geral" subtitle={tab === "bugs" ? "Bugs do Azure DevOps de todas as squads" : "Todas as automações de todos os projetos integrados"} />
      {canEdit && (
        <Tabs value={tab} onValueChange={(v) => navigate({ search: v === "bugs" ? { aba: "bugs" } : {} })} className="mb-5">
          <TabsList>
            <TabsTrigger value="automacao">Visão geral · Automação</TabsTrigger>
            <TabsTrigger value="bugs">Visão geral · Bugs</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {tab === "bugs" ? <BugsOverview /> : <Dashboard projectId={null} slug={null} />}
    </>
  );
}

function BugsOverview() {
  const { isAdmin } = useAuth();
  const { filters } = useFilters();
  const q = useBugs();
  if (q.error) return <EmptyState>Não foi possível carregar os bugs: {(q.error as Error).message}</EmptyState>;
  if (q.isLoading || !q.data) return <LoadingOverlay message="Carregando bugs…" />;
  const items = q.data.dataset?.items ?? [];
  const bugs = items.filter((b) => b.kind === "bug");
  const pbis = items.filter((b) => b.kind === "pbi");
  const { from, to } = bugPeriod(filters.period === "all" ? null : Number(filters.period));
  return (
    <div className="grid gap-4">
      <BugsStatus result={q.data} isAdmin={isAdmin} />
      {q.data.dataset && (!bugs.length ? <EmptyState>Nenhum bug encontrado no Azure DevOps.</EmptyState> : (
        <>
          <BugCards items={bugs} pbis={pbis} from={from} to={to} label="Bugs" />
          <Panel title="Comparativo por squad" info={<><p>Bugs de cada squad (subárea da área raiz no Azure DevOps). Abertos e % concluídos são a foto de hoje; criados, concluídos e proporção seguem o período selecionado.</p><p>Tempo médio parado: média de dias desde a última mudança de estado dos bugs abertos. Proporção de bugs: bugs ÷ (bugs + PBIs) criados no período.</p></>} action={<Link to="/bugs" className="text-sm font-medium text-[color:var(--conecta-color-brand-content)] hover:underline">Ver detalhes</Link>}>
            <SquadTable rows={squadComparison(items, from, to)} />
          </Panel>
          <Panel title="Evolução dos bugs" info="Semana a semana (fechando na sexta-feira): a barra laranja é quantos entraram e a verde quantos foram concluídos. Se a verde passa a laranja, a fila está diminuindo.">
            <p className="mb-3 text-xs text-muted-foreground">{PERIOD_LABEL[filters.period]} · todas as squads · semanas fechando na sexta-feira</p>
            <BugFlow items={bugs} from={from} to={to} />
          </Panel>
          <Panel title="Projeção para zerar os abertos" info="Média de itens concluídos por semana nas últimas 8 semanas, aplicada aos abertos de hoje, supondo que não entre nenhum item novo. A linha vermelha é o histórico real dos abertos no fim de cada semana; a tracejada é a queda prevista. Não depende do período selecionado.">
            <BugClearProjection items={bugs} to={to} label="Bugs" />
          </Panel>
        </>
      ))}
    </div>
  );
}
