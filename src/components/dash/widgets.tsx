import { DataTable } from "./DataTable";
import { FailureDetailsTable, FailureNaturePanel } from "./FailureNature";
import { ContractCoveragePanel } from "./ContractCoverage";
import { CauseBars, CauseDonut, CoverageWaterfall, DailyChart, DailyColumns, DailyExecutionVolumeChart, EvolutionChart, FailureHeatmap, FailureTreemap, Gauge, OriginRadar, QualityFunnel, RankingBars, RateBands, StabilityScatter } from "./charts";
import type { ChartKind } from "./chartKinds";
import { buildSpecial, ORIGIN_LABEL } from "@/data/useDashboard";
import { EmptyState, StatCard, fmtDate, fmtInt, fmtPct } from "./primitives";
import type { DashData, SourceUse } from "@/data/useDashboard";
import { causeDistribution, computeProjection, currentTests, coverageWaterfall, dailyRate, dailyResults, failureHeatmap, qualityFunnel, rateByOrigin, testStability, topFailingTests, failureRows, flakyTable, summarize, testCount, type Product, type Projection } from "@/lib/metrics";

export const RATE_INFO = "Taxa = (aprovados + flaky) ÷ total de resultados. Flaky terminou aprovado após retry interno e não reduz o sucesso. Falha = teste que falhou definitivamente. Reruns da mesma Action são ignorados; só conta a primeira tentativa de cada gatilho. Verde ≥ 90%, amarelo 80–89,99%, vermelho < 80%.";
export const PROJECTION_INFO = "Velocidade = inclinação (regressão linear) das últimas até 8 semanas. A projeção só é desenhada quando a automação cresce mais rápido que o produto e há pelo menos 3 semanas de histórico. Semanas restantes = diferença atual ÷ (velocidade automação − velocidade produto). Condições duplicadas contam uma vez; cenários extras fora do contrato não contam.";

export type WidgetType = "success_gauge" | "summary_cards" | "daily_results" | "daily_columns" | "daily_execution_volume" | "rate_trend" | "evolution" | "top_failures" | "stability_scatter" | "origin_radar" | "quality_funnel" | "failure_treemap" | "failure_heatmap" | "coverage_waterfall" | "flaky_table" | "failure_details" | "failure_history" | "cause_donut" | "failure_nature" | "contract_coverage" | "project_ranking";

export const WIDGET_CATALOG: Record<WidgetType, { kind: ChartKind; label: string; description: string; defaultTitle: string; defaultWidth: "half" | "full"; info?: string }> = {
  success_gauge: { kind: "gauge", label: "Taxa de sucesso", description: "Velocímetro com faixas verde/amarelo/vermelho em relação à meta.", defaultTitle: "Taxa de sucesso", defaultWidth: "half", info: RATE_INFO },
  summary_cards: { kind: "card", label: "Números principais", description: "Resumo das execuções agendadas e da estabilidade dos testes.", defaultTitle: "Resumo", defaultWidth: "half", info: "Testes: cada título de cenário é um teste. Conta os cenários da execução agendada mais recente de cada projeto e, na visão geral, soma os projetos. Teste renomeado ou removido sai da conta na execução seguinte. Execuções válidas: execuções agendadas no período selecionado, contando apenas a primeira tentativa de cada execução da Action. Falhas definitivas: resultados de testes que continuaram falhando ao final das tentativas; o mesmo cenário pode contar mais de uma vez em execuções diferentes. Flaky tests: testes distintos que apresentaram falha em pelo menos três execuções no período selecionado, incluindo falhas recuperadas por retentativa ou definitivas. A classificação acompanha o período escolhido." },
  evolution: { kind: "line", label: "Produto vs automação", description: "Cenários planejados representam condições documentadas pelo coletor da API; cenários automatizados são as condições com evidência correspondente. A contagem não representa produtos nem simplesmente a quantidade de testes.", defaultTitle: "Cruzamento de métricas: cenários planejados vs. automatizados", defaultWidth: "full", info: PROJECTION_INFO },
  rate_trend: { kind: "bands", label: "Taxa de sucesso por dia", description: "Linha da taxa diária sobre as faixas da meta (≥ 90% verde).", defaultTitle: "Taxa de sucesso diária vs meta", defaultWidth: "full", info: RATE_INFO },
  daily_columns: { kind: "column", label: "Resultados diários (colunas)", description: "Aprovados, flaky e falhas por dia em colunas empilhadas.", defaultTitle: "Resultados diários", defaultWidth: "full", info: "Soma diária considerando apenas a primeira tentativa de cada gatilho." },
  daily_results: { kind: "line", label: "Resultados diários (área)", description: "Área empilhada de aprovados, flaky e falhas por dia.", defaultTitle: "Resultados diários (área)", defaultWidth: "full", info: "Soma diária considerando apenas a primeira tentativa de cada gatilho." },
  daily_execution_volume: { kind: "column", label: "Volume diário de execuções", description: "Uma barra por execução agendada do CI, agrupada por dia no período selecionado.", defaultTitle: "Volume diário de execuções", defaultWidth: "full", info: "A altura representa a quantidade de resultados de testes na execução. A cor representa a taxa de sucesso, incluindo flaky recuperados: verde a partir de 90%, amarelo de 80% a menos de 90% e vermelho abaixo de 80%. Resultados indisponíveis não recebem classificação. Considera a primeira tentativa de cada execução agendada; o período acompanha o filtro superior." },
  top_failures: { kind: "bar", label: "Testes que mais falham", description: "Ranking dos 10 testes com mais falhas definitivas.", defaultTitle: "Testes que mais falham", defaultWidth: "half", info: "Soma das ocorrências de falha definitiva por teste no período." },
  cause_donut: { kind: "bar", label: "Falhas por causa", description: "Quantidade de falhas definitivas por causa, da mais frequente para a menos frequente.", defaultTitle: "Falhas por causa", defaultWidth: "half" },
  failure_nature: { kind: "card", label: "Motivo das falhas", description: "Testes de API e UI que falharam, separados pelo provável motivo e por quem precisa resolver: sistema, ambiente, massa de teste ou teste automatizado.", defaultTitle: "Motivo das falhas e quem resolve", defaultWidth: "full", info: "O que é contado: cada falha definitiva da primeira tentativa de uma execução agendada — o mesmo número do card Falhas definitivas. Cada falha entra em um único motivo, então a soma dos motivos é sempre igual ao total. De onde vem o motivo: da evidência que a automação grava quando o teste falha (chamadas HTTP e status, erros de rede e de JavaScript da tela, URL da tela e a etapa Dado, Quando ou Então em que falhou). As regras valem nesta ordem: queda do ambiente (5 ou mais testes e 30% da execução falhando juntos); serviço inacessível ou 502/503/504; erro 5xx do sistema; login do usuário de teste recusado; tela com 401/403 (acesso), 404/4xx na própria tela ou nas chamadas da tela; falha na preparação (Dado) sem erro de sistema, que é massa de teste; seletor ambíguo; erro de JavaScript na página; elemento ausente numa tela que carregou sem erros, que é ajuste no teste ou tela alterada; tempo limite de chamada, que é lentidão do sistema quando se repete em 3 ou mais execuções. Sem evidência capturada (execuções antigas), a classificação usa só a mensagem de erro e nunca recebe evidência forte. O que não tem prova fica em Precisa de análise, com o link da execução." },
  contract_coverage: { kind: "matrix", label: "Cobertura do contrato (Swagger)", description: "Quanto do contrato da API em produção (endpoints e status documentados no Swagger) tem teste automatizado, com o que falta em cada endpoint.", defaultTitle: "Cobertura do contrato da API (Swagger em produção)", defaultWidth: "full", info: "Universo: o contrato da API na branch de produção (main), lido dos controllers. Cada combinação de método, rota e status documentado é uma condição; é o mínimo a automatizar. Coberta: um teste aprovado em execução agendada exercitou a condição nos últimos 14 dias. Vários testes da mesma condição contam uma vez, então cenários a mais da PBI não aumentam a cobertura. Fora da base: respostas 5xx e 429, que nenhum teste provoca de propósito. Endpoint 100%: todas as condições testáveis cobertas. A medição é semanal e é a mesma que alimenta o gráfico de cenários planejados × automatizados. Projetos de API novos entram automaticamente quando publicam o arquivo api-swagger-coverage-current.json." },
  quality_funnel: { kind: "funnel", label: "Funil de qualidade", description: "Condições do produto → automatizadas → testes executados → sem falha.", defaultTitle: "Funil de qualidade", defaultWidth: "half", info: "Condições = última semana do período. Testes executados e sem falha definitiva = testes distintos no período." },
  coverage_waterfall: { kind: "waterfall", label: "Ganho semanal de automação", description: "Quanto a automação cresceu ou caiu a cada semana.", defaultTitle: "Variação semanal das condições automatizadas", defaultWidth: "half", info: "Primeira barra = total inicial do período. Verde = ganho na semana, vermelho = perda." },
  failure_heatmap: { kind: "heatmap", label: "Mapa de calor de falhas", description: "Falhas definitivas por dia da semana ao longo das semanas.", defaultTitle: "Mapa de calor de falhas", defaultWidth: "full" },
  stability_scatter: { kind: "scatter", label: "Estabilidade dos testes", description: "Cada ponto é um teste: execuções × vezes que não passou de primeira.", defaultTitle: "Estabilidade dos testes", defaultWidth: "half" },
  origin_radar: { kind: "radar", label: "Taxa por origem", description: "Taxa de sucesso por origem: agendada, pós-merge e manual.", defaultTitle: "Taxa de sucesso por origem", defaultWidth: "half", info: RATE_INFO },
  failure_treemap: { kind: "treemap", label: "Falhas por causa e teste", description: "Hierarquia: causa → testes, proporcional às ocorrências.", defaultTitle: "Falhas por causa e teste", defaultWidth: "full" },
  flaky_table: { kind: "matrix", label: "Tabela de flaky tests", description: "Testes instáveis no período selecionado.", defaultTitle: "Flaky tests — período selecionado", defaultWidth: "full", info: "Um teste é considerado instável quando apresenta falha em pelo menos três execuções no período selecionado. Cada execução conta uma vez, incluindo falhas recuperadas por retentativa ou definitivas. O contador representa testes distintos por origem." },
  failure_details: { kind: "matrix", label: "Detalhamento das falhas", description: "Cada falha definitiva do período, agrupada por cenário e erro, com o motivo provável e quem resolve.", defaultTitle: "Detalhamento das falhas — período selecionado", defaultWidth: "full", info: "Lista para investigar: cada linha é um cenário com o mesmo erro e motivo. O motivo é o mesmo do painel Motivo das falhas (evidência capturada na execução ou, nas execuções antigas, a mensagem de erro). Use o filtro por motivo; clique no cenário ou no erro para ver a prova, a etapa que falhou e o link de cada execução. Falhas que ocorreram durante uma queda do ambiente aparecem marcadas nas ocorrências. Este painel usa o período selecionado." },
  failure_history: { kind: "matrix", label: "Histórico de falhas", description: "Falhas registradas no período selecionado.", defaultTitle: "Histórico de falhas — ciclo de vida", defaultWidth: "full", info: "A primeira execução exibida é a mais antiga registrada no período e pode não ser a data de criação do teste. Primeira e última ocorrência referem-se a falhas definitivas." },
  project_ranking: { kind: "matrix", label: "Comparativo por projeto", description: "Taxa de sucesso, falhas e cobertura de cada projeto.", defaultTitle: "Comparativo por projeto", defaultWidth: "full" },
};

/** Suggested starting dashboard, following the chart-type legend. */
export const DEFAULT_WIDGETS: { widget_type: WidgetType; width: "half" | "full" }[] = [
  { widget_type: "success_gauge", width: "half" },
  { widget_type: "summary_cards", width: "half" },
  { widget_type: "daily_execution_volume", width: "full" },
  { widget_type: "failure_nature", width: "full" },
  { widget_type: "failure_details", width: "full" },
  { widget_type: "flaky_table", width: "full" },
  { widget_type: "failure_history", width: "full" },
];

/**
 * Painéis ocultos: continuam salvos (no banco e no catálogo), mas não aparecem nem podem ser adicionados.
 * "evolution" (cruzamento planejado × automatizado) fica oculto até haver medição; para voltar, tire daqui.
 * "cause_donut" (falhas por causa, categorias antigas da automação) foi substituído pelo motivo das falhas.
 * "contract_coverage" fica oculto até a medição por execução estar publicada: hoje o arquivo de cobertura
 * não liga os testes ao contrato e mostraria 0%, o que não é verdade.
 */
export const HIDDEN_WIDGETS: WidgetType[] = ["evolution", "cause_donut", "contract_coverage"];

/** Ordem de exibição fora da edição, mesmo quando a configuração salva está em outra ordem. */
export const PANEL_ORDER: WidgetType[] = [
  "success_gauge", "summary_cards", "daily_execution_volume", "project_ranking", "failure_nature", "failure_details",
  "flaky_table", "failure_history", "contract_coverage",
];

/** Tira os ocultos e ordena pela PANEL_ORDER; painéis fora da lista vêm depois, na ordem salva. */
export function orderPanels<T extends { widget_type: string }>(widgets: T[]): T[] {
  const rank = (w: T) => { const i = PANEL_ORDER.indexOf(w.widget_type as WidgetType); return i < 0 ? PANEL_ORDER.length : i; };
  return widgets
    .filter((w) => !HIDDEN_WIDGETS.includes(w.widget_type as WidgetType))
    .map((w, index) => ({ w, index }))
    .sort((x, y) => rank(x.w) - rank(y.w) || x.index - y.index)
    .map(({ w }) => w);
}

export function ProjectionSummary({ projection }: { projection: Projection }) {
  if (projection.status === "empty") return null;
  const gap = (
    <div><div className="text-xs text-muted-foreground">Diferença atual</div><div className="font-mono text-lg">{fmtInt(projection.currentGap)}</div></div>
  );
  if (projection.status === "beyond-horizon")
    return <div className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm text-warning">A estimativa ultrapassa 520 semanas; não é possível apresentá-la neste gráfico com confiabilidade.</div>;
  if (projection.status === "insufficient" || projection.status === "no-parity")
    return (
      <div className="mt-4 flex flex-wrap items-center gap-6 rounded-lg border border-dashed border-border p-3 text-sm">
        <span className="text-warning">{projection.status === "insufficient" ? "Histórico insuficiente para calcular a projeção" : "Na velocidade atual, não há previsão de paridade."}</span>
        {gap}
      </div>
    );
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg border border-projection/40 bg-projection/10 p-3">
      <div><div className="text-xs text-muted-foreground">Semana estimada de paridade</div><div className="font-mono text-lg text-projection">{fmtDate(projection.parityWeek)}</div></div>
      <div><div className="text-xs text-muted-foreground">Semanas restantes</div><div className="font-mono text-lg">{projection.weeksRemaining}</div></div>
      {gap}
    </div>
  );
}

function filterWeeks<T extends { week: string }>(pts: T[], periodDays: number | null): T[] {
  if (periodDays == null) return pts;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - periodDays + 1);
  const iso = from.toISOString().slice(0, 10);
  return pts.filter((p) => p.week >= iso);
}

type Row = Record<string, unknown>;
const mono = "font-mono text-xs";
const emptySourceMessage = (used: SourceUse[], empty: string) =>
  used.length > 0 && used.every((source) => source.fallback && source.reason)
    ? "Sem dados disponíveis para esta consulta. Confira as informações do gráfico."
    : empty;
const sourceWarnings = (used: SourceUse[]) => [...new Set(used.flatMap(source => source.reason ? [source.reason] : []))];

export function WidgetBody({ type, d, product, periodLabel }: { type: string; d: DashData; product: Product; periodLabel: string }) {
  switch (type as WidgetType) {
    case "success_gauge":
      return <Gauge rate={summarize(d.inPeriod).rate} label={product.toUpperCase()} />;
    case "summary_cards": {
      if (!d.projects.some((p) => p.sources[product].executions.mode === "github")) {
        return <EmptyState>Sem dados de execução disponíveis para esta fonte.</EmptyState>;
      }
      const s = summarize(d.inPeriod);
      const flaky = d.specialByProduct.flaky;
      const flakyUnavailable = flaky.used.length > 0 && flaky.used.every((source) => source.fallback && source.reason);
      const flakyCount = new Set(flaky.rows.map((r) => `${r.dataSource}|${r.title}`)).size;
      const tests = currentTests(d.valid, product);
      return (
        <div className="grid grid-cols-2 gap-3">
          <StatCard prominent label="Testes" value={fmtInt(tests.total)} tone="product" hint={tests.projects.length === 1 ? `Cenários da execução de ${fmtDate(tests.projects[0]!.date)}` : tests.projects.length ? `Soma da última execução de ${tests.projects.length} projetos` : ""} />
          <StatCard prominent label="Execuções válidas" value={fmtInt(d.inPeriod.length)} hint="Reruns ignorados" />
          <StatCard prominent label="Falhas definitivas" value={fmtInt(s.failed)} tone={s.failed ? "danger" : "success"} />
          <StatCard prominent label="Flaky tests" value={flakyUnavailable ? "—" : fmtInt(flakyCount)} tone={flakyUnavailable ? undefined : flakyCount ? "warning" : "success"} />
        </div>
      );
    }
    case "daily_results":
      return <DailyChart data={dailyResults(d.inPeriod)} />;
    case "daily_execution_volume":
      return <DailyExecutionVolumeChart data={d.inPeriod} periodDays={d.periodDays} />;
    case "evolution": {
      const proj = computeProjection(filterWeeks(d.evolution, d.periodDays));
      const last = proj.series.filter((p) => p.productConditions != null).at(-1);
      const unverified = Boolean(last && last.automatedConditions === 0);
      return (
        <>
          <p className="mb-3 text-sm text-muted-foreground">Evolução e tendências de automação de cenários</p>
          <EvolutionChart projection={proj} hideAutomation={unverified} />
          {unverified ? (
            <div className="mt-4 rounded-lg border border-warning/40 p-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div><div className="text-xs text-muted-foreground">Condições no inventário preliminar</div><div className="font-mono text-lg">{fmtInt(last!.productConditions)}</div></div>
                <div><div className="text-xs text-muted-foreground">Testes na última execução</div><div className="font-mono text-lg">{fmtInt(testCount(d.valid, product))}</div></div>
                <div><div className="text-xs text-muted-foreground">Cobertura do contrato</div><div className="text-lg">Ainda não apurada</div></div>
              </div>
              <p className="mt-3 text-warning">O inventário inclui respostas estimadas e ainda precisa ser validado contra o Swagger da versão implantada. A quantidade de testes não indica quantas condições estão cobertas; a projeção depende desse mapeamento e do histórico.</p>
            </div>
          ) : <ProjectionSummary projection={proj} />}
          {!unverified && last && last.productConditions > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Cobertura comprovada: {fmtPct((last.automatedConditions / last.productConditions) * 100)}. Um resultado zero indica ausência de correspondências comprovadas na fonte, não ausência de testes automatizados.</p>
          )}
        </>
      );
    }
    case "daily_columns":
      return <DailyColumns data={dailyResults(d.inPeriod)} />;
    case "rate_trend":
      return <RateBands data={dailyRate(d.inPeriod)} />;
    case "top_failures":
      return <RankingBars data={topFailingTests(failureRows(d.inPeriod))} empty="Nenhuma falha definitiva no período." />;
    case "stability_scatter":
      return <StabilityScatter data={testStability(d.inPeriod)} />;
    case "origin_radar":
      return <OriginRadar data={rateByOrigin(d.inPeriod).map((r) => ({ label: ORIGIN_LABEL[r.origin], rate: r.rate }))} />;
    case "quality_funnel":
      return <QualityFunnel data={qualityFunnel(filterWeeks(d.evolution, d.periodDays), d.inPeriod)} />;
    case "coverage_waterfall":
      return <CoverageWaterfall data={coverageWaterfall(filterWeeks(d.evolution, d.periodDays))} />;
    case "failure_heatmap":
      return <FailureHeatmap data={failureHeatmap(d.inPeriod)} />;
    case "failure_treemap": {
      const m = new Map<string, Map<string, number>>();
      failureRows(d.inPeriod).forEach((r) => { const c = m.get(r.cause) ?? new Map(); c.set(r.title, (c.get(r.title) ?? 0) + r.occurrences); m.set(r.cause, c); });
      return <FailureTreemap data={[...m.entries()].map(([name, c]) => ({ name, children: [...c.entries()].map(([n, size]) => ({ name: n, size })) }))} />;
    }
    case "flaky_table": {
      const f = d.specialByProduct.flaky;
      const unavailable = f.used.length > 0 && f.used.every((source) => source.fallback && source.reason);
      return (
        <>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <DataTable detailView rows={f.rows as unknown as Row[]} empty={emptySourceMessage(f.used, "Nenhum flaky test no período selecionado.")} initialSort={{ key: "failureExecutions", dir: "desc" }} columns={[
              { key: "title", label: "Cenário", width: 360 },
              { key: "executions", label: "Execuções", numeric: true, width: 150 },
              { key: "failureExecutions", label: "Execuções com falha", numeric: true, width: 210 },
              { key: "successRate", label: "Taxa de sucesso", numeric: true, width: 170, render: (r) => (r["successRate"] == null ? "—" : fmtPct(Number(r["successRate"]))) },
              { key: "dataSource", label: "Origem", width: 250, className: "text-muted-foreground" },
            ]} />
            <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-border p-4 text-center"><span className="text-sm text-muted-foreground">Total de testes flaky distintos</span><strong className="mt-3 text-5xl">{unavailable ? "—" : fmtInt(new Set(f.rows.map((r) => `${r.dataSource}|${r.title}`)).size)}</strong></div>
          </div>
        </>
      );
    }
    case "failure_details":
      return <FailureDetailsTable data={d.nature} product={product} />;
    case "contract_coverage":
      return <ContractCoveragePanel data={d.contract} product={product} />;
    case "failure_nature":
      return <FailureNaturePanel data={d.nature} product={product} />;
    case "cause_donut":
      return (<>{sourceWarnings(d.specialByProduct.reasons.used).map(warning => <p key={warning} className="mb-3 text-xs text-warning">{warning}</p>)}{!d.specialByProduct.reasons.rows.length && d.specialByProduct.reasons.used.length > 0 && d.specialByProduct.reasons.used.every((source) => source.fallback && source.reason) ? <EmptyState>Sem dados de falhas disponíveis para esta consulta.</EmptyState> : <CauseBars data={d.specialByProduct.reasons.rows} />}</>);
    case "failure_history": {
      const f = d.specialByProduct.lifecycle;
      return (
        <>
          <p className="mb-3 text-xs text-muted-foreground">A primeira execução é a mais antiga registrada no período, não necessariamente a data de criação do teste.</p>
          <DataTable detailView rows={f.rows as unknown as Row[]} empty={emptySourceMessage(f.used, "Nenhuma falha registrada.")} initialSort={{ key: "occurrences", dir: "desc" }} columns={[
            { key: "title", label: "Cenário", width: 340 },
            { key: "error", label: "Erro", width: 340, className: mono },
            { key: "detail", label: "Motivo do erro", width: 360, className: "text-muted-foreground" },
            { key: "occurrences", label: "Ocorrências", numeric: true, width: 150 },
            { key: "firstSeen", label: "Primeira execução registrada", width: 240, render: (r) => (r["firstSeen"] ? fmtDate(String(r["firstSeen"]).slice(0, 10)) : "—") },
            { key: "firstOccurrence", label: "Primeira ocorrência", width: 190, render: (r) => (r["firstOccurrence"] ? fmtDate(String(r["firstOccurrence"]).slice(0, 10)) : "—") },
            { key: "lastOccurrence", label: "Última ocorrência", width: 190, render: (r) => (r["lastOccurrence"] ? fmtDate(String(r["lastOccurrence"]).slice(0, 10)) : "—") },
          ]} />
        </>
      );
    }
    case "project_ranking": {
      const rows = d.projects.map((p) => {
        const ex = d.inPeriod.filter((e) => e.triggerId.startsWith(p.project.id));
        const s = summarize(ex);
        const evo = p.evolution[product].at(-1);
        const flaky = buildSpecial([p], new Date(), product, d.periodDays).flaky;
        const flakyUnavailable = flaky.used.length > 0 && flaky.used.every(source => source.fallback && source.reason);
        const coverageUnverified = evo?.automatedConditions === 0 && ex.some(run => run.results.length > 0);
        return {
          project: p.project.name,
          rate: s.rate == null ? -1 : Math.round(s.rate * 100) / 100,
          failed: p.sources[product].executions.mode === "github" ? s.failed : null,
          flaky: p.sources[product].executions.mode === "github" && !flakyUnavailable ? new Set(flaky.rows.map(row => `${row.dataSource}|${row.title}`)).size : null,
          coverage: evo && evo.productConditions && !coverageUnverified ? Math.round((evo.automatedConditions / evo.productConditions) * 10000) / 100 : -1,
        };
      });
      return (
        <DataTable rows={rows} initialSort={{ key: "rate", dir: "asc" }} columns={[
          { key: "project", label: "Projeto" },
          { key: "rate", label: "Taxa de sucesso", numeric: true, render: (r) => (r.rate < 0 ? "—" : fmtPct(r.rate)) },
          { key: "failed", label: "Falhas definitivas", numeric: true },
          { key: "flaky", label: "Flaky", numeric: true },
          { key: "coverage", label: "Cobertura", numeric: true, render: (r) => (r.coverage < 0 ? "—" : fmtPct(r.coverage)) },
        ]} />
      );
    }
    default:
      return <EmptyState>Tipo de gráfico desconhecido: {type}</EmptyState>;
  }
}
