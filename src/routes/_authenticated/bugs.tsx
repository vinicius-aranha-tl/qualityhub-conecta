import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBugs, useFilters, PERIOD_LABEL } from "@/data/useDashboard";
import { agingOpen, bugDistribution, bugsByColumn, isBugDone, isBugRemoved, bugAgeDays, type BugKind } from "@/lib/metrics";
import { DataTable } from "@/components/dash/DataTable";
import { EmptyState, PageTitle, Panel, fmtDate, fmtInt } from "@/components/dash/primitives";
import { AzureSettingsDialog, BugClearProjection, BugFlow, BugCards, BugsStatus, ColumnLoadBars, CountBars, bugPeriod, squadsOf } from "@/components/dash/bugs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingOverlay } from "@/components/dash/LoadingOverlay";

export const Route = createFileRoute("/_authenticated/bugs")({
  head: () => ({ meta: [{ title: "Bugs — Quality Hub" }, { name: "description", content: "Bugs e defeitos registrados no Azure DevOps, por squad." }] }),
  component: BugsPage,
});

type Tracked = Exclude<BugKind, "pbi">;
const KIND_LABEL: Record<Tracked, string> = { bug: "Bugs", defeito: "Defeitos" };
const day = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : "—");
const ALL = "__all__";

function BugsPage() {
  const { canEdit, isAdmin, loading } = useAuth();
  const { filters } = useFilters();
  const q = useBugs();
  const [squad, setSquad] = useState(ALL);
  const [kind, setKind] = useState<Tracked>("bug");
  const all = useMemo(() => q.data?.dataset?.items ?? [], [q.data]);
  const squads = useMemo(() => squadsOf(all.filter((b) => b.kind !== "pbi")), [all]);
  const bySquad = useMemo(() => (squad === ALL ? all : all.filter((b) => b.squad === squad)), [all, squad]);
  const items = bySquad.filter((b) => b.kind === kind);
  const pbis = bySquad.filter((b) => b.kind === "pbi");

  if (loading) return null;
  if (!canEdit) return <p>Acesso disponível apenas para administradores.</p>;

  const periodDays = filters.period === "all" ? null : Number(filters.period);
  const { from, to } = bugPeriod(periodDays);
  const label = KIND_LABEL[kind];
  const lower = label.toLowerCase();
  const onBoard = kind === "bug" && (q.data?.dataset?.columns.length ?? 0) > 0;
  const aging = agingOpen(items, to);
  const where = squad === ALL ? "todas as squads" : `a squad ${squad}`;

  return (
    <>
      <PageTitle title="Bugs" subtitle="Bugs e defeitos do Azure DevOps de todos os projetos, por squad, no período selecionado." />
      {q.error ? <EmptyState>Não foi possível carregar os bugs: {(q.error as Error).message}</EmptyState> : q.isLoading || !q.data ? (
        <LoadingOverlay message="Carregando bugs…" />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={kind} onValueChange={(v) => setKind(v as Tracked)}>
                <TabsList>{(["bug", "defeito"] as const).map((k) => <TabsTrigger key={k} value={k}>{KIND_LABEL[k]}</TabsTrigger>)}</TabsList>
              </Tabs>
              {squads.length > 0 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="bugs-squad" className="text-sm">Squad</Label>
                  <Select value={squad} onValueChange={setSquad}>
                    <SelectTrigger id="bugs-squad" className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as squads</SelectItem>
                      {squads.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {isAdmin && <AzureSettingsDialog settings={q.data.settings} />}
          </div>

          <BugsStatus result={q.data} isAdmin={isAdmin} />

          {!q.data.dataset ? null : !items.length ? (
            <EmptyState>Nenhum {kind === "bug" ? "bug" : "defeito"} encontrado para {where}.{kind === "defeito" ? " Defeitos são Tasks com a tag DEFEITO na área raiz." : ""}</EmptyState>
          ) : (
            <>
              <BugCards items={items} {...(kind === "bug" ? { pbis } : {})} from={from} to={to} label={label} />

              <Panel title={`Evolução dos ${lower}`} info="Semana a semana (fechando na sexta-feira): a barra laranja é quantos entraram e a verde quantos foram concluídos. Se a verde passa a laranja, a fila está diminuindo.">
                <p className="mb-3 text-xs text-muted-foreground">{PERIOD_LABEL[filters.period]} · {squad === ALL ? "todas as squads" : squad} · semanas fechando na sexta-feira</p>
                <BugFlow items={items} from={from} to={to} />
              </Panel>

              <Panel title="Projeção para zerar os abertos" info="Média de itens concluídos por semana nas últimas 8 semanas, aplicada aos abertos de hoje, supondo que não entre nenhum item novo. A linha vermelha é o histórico real dos abertos no fim de cada semana; a tracejada é a queda prevista. Não depende do período selecionado.">
                <BugClearProjection items={items} to={to} label={label} />
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                {onBoard ? (
                  <Panel title="Abertos por etapa do quadro" info={<><p>Onde os bugs abertos estão no quadro do time, coluna a coluna, na ordem do fluxo.</p><p>O limite de WIP do Azure vale para a coluna inteira (bugs e PBIs de todas as squads), por isso a comparação com o limite aparece só em “Todas as squads”.</p></>}>
                    <ColumnLoadBars rows={bugsByColumn(q.data.dataset.columns, items, pbis)} label={label} showOthers={squad === ALL} />
                  </Panel>
                ) : (
                  <Panel title="Por estado"><CountBars data={bugDistribution(items, "state")} /></Panel>
                )}
                <Panel title="Tempo parado" info="Dias desde a última mudança de estado de cada item aberto. Os mais antigos aparecem primeiro: são os que estão parados há mais tempo.">
                  {!aging.length ? <EmptyState>Nenhum {kind === "bug" ? "bug" : "defeito"} aberto.</EmptyState> : (
                    <ul className="grid gap-2">
                      {aging.slice(0, 8).map((b, i) => (
                        <li key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                          <span className={`w-16 shrink-0 text-right font-display text-xl font-semibold tabular-nums ${i < 3 && b.ageDays >= 7 ? "text-danger" : b.ageDays >= 7 ? "text-warning" : "text-card-foreground"}`}>{fmtInt(b.ageDays)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">d</span></span>
                          <div className="min-w-0 flex-1">
                            <a href={b.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">#{b.id} · {b.title}</a>
                            <p className="truncate text-xs text-muted-foreground">{b.state}{b.column ? ` · ${b.column}` : ""} · {b.squad}</p>
                          </div>
                        </li>
                      ))}
                      {aging.length > 8 && <li className="text-xs text-muted-foreground">e mais {fmtInt(aging.length - 8)} na lista abaixo.</li>}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {(squad === ALL ? (["squad", "state", "severity"] as const) : (["state", "severity", "priority"] as const)).map((field) => {
                  const dist = bugDistribution(items, field);
                  const title = { squad: "Por squad", state: "Por estado", severity: "Por severidade", priority: "Por prioridade" }[field];
                  return (
                    <Panel key={field} title={title}>
                      {dist.length === 1 && (field === "severity" || field === "priority") && <p className="mb-3 text-xs text-warning">Todos os {lower} têm o mesmo valor: o campo parece não estar sendo preenchido no Azure DevOps.</p>}
                      <CountBars data={dist.map((x) => ({ label: field === "priority" && x.label !== "Não informado" ? `Prioridade ${x.label}` : x.label, value: x.value }))} />
                    </Panel>
                  );
                })}
              </div>

              <Panel title={`Lista de ${lower}`} info="Itens do Azure DevOps da área raiz configurada. Clique no número para abrir o item no Azure DevOps.">
                <DataTable rows={items.filter((b) => !isBugRemoved(b)).map((b) => ({ ...b, done: isBugDone(b) ? 1 : 0, ageDays: isBugDone(b) ? -1 : bugAgeDays(b, to) })) as unknown as Record<string, unknown>[]} initialSort={{ key: "id", dir: "desc" }} empty="Nenhum item." columns={[
                  { key: "id", label: "ID", numeric: true, render: (r) => <a href={String(r["url"])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[color:var(--conecta-color-brand-content)] hover:underline">{String(r["id"])} <ExternalLink aria-hidden className="h-3 w-3" /></a> },
                  { key: "title", label: "Título" },
                  { key: "squad", label: "Squad" },
                  { key: "state", label: "Estado", render: (r) => <span className={r["done"] ? "text-success" : "text-warning"}>{String(r["state"])}</span> },
                  ...(kind === "bug" ? [{ key: "column", label: "Etapa", render: (r: Record<string, unknown>) => String(r["column"] || "—") }] : []),
                  { key: "ageDays", label: "Dias no estado", numeric: true, render: (r) => (Number(r["ageDays"]) < 0 ? "—" : fmtInt(Number(r["ageDays"]))) },
                  { key: "assignedTo", label: "Responsável", render: (r) => String(r["assignedTo"] || "—") },
                  { key: "createdDate", label: "Criado em", render: (r) => day(String(r["createdDate"])) },
                  { key: "closedDate", label: "Concluído em", render: (r) => day((r["closedDate"] as string | null) ?? null) },
                ]} />
              </Panel>
            </>
          )}
        </div>
      )}
    </>
  );
}
