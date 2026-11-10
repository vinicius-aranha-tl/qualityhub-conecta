import { useMemo, useState } from "react";
import type { ContractData } from "@/data/useDashboard";
import { contractSummary, endpointCoverage, isTestableStatus, type EndpointCoverage, type Product } from "@/lib/metrics";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DataTable } from "./DataTable";
import { EmptyState, StatCard, fmtDate, fmtInt, fmtPct } from "./primitives";

type Filter = "all" | "none" | "partial" | "full";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "none", label: "Sem teste" },
  { value: "partial", label: "Parciais" },
  { value: "full", label: "100%" },
];

const coverageTone = (percent: number | null) => (percent == null ? "var(--muted-foreground)" : percent >= 100 ? "var(--success)" : percent > 0 ? "var(--warning)" : "var(--danger)");

function Bar({ percent }: { percent: number | null }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full" style={{ width: `${percent ?? 0}%`, backgroundColor: coverageTone(percent) }} />
    </div>
  );
}

/** Cobertura do contrato da API em produção: universo mínimo do Swagger × condições com teste. */
export function ContractCoveragePanel({ data, product }: { data: ContractData; product: Product }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<EndpointCoverage | null>(null);
  const endpoints = useMemo(() => endpointCoverage(data.sources), [data.sources]);
  const summary = contractSummary(endpoints);
  const multiProject = data.sources.length > 1;

  if (product === "ui") return <EmptyState>A cobertura de UI não usa contrato: será medida pelas jornadas críticas de cada produto, a definir com os POs.</EmptyState>;
  if (!data.sources.length) return <EmptyState>{data.missing.length ? `Nenhum projeto publicou o contrato de cobertura ainda (${data.missing.map((m) => m.project).join(", ")}).` : "Nenhum projeto de API cadastrado."}</EmptyState>;

  const withBase = endpoints.filter((e) => e.testable > 0);
  const visible = withBase.filter((e) => filter === "all" || (filter === "none" ? e.covered === 0 : filter === "full" ? e.covered === e.testable : e.covered > 0 && e.covered < e.testable));

  return (
    <div className="grid min-w-0 gap-5">
      <p className="text-sm text-card-foreground">
        O universo mínimo a automatizar é o contrato da API <strong>em produção</strong> (Swagger da branch {[...new Set(data.sources.map((s) => s.coverage.sourceBranch || "main"))].join(", ")}): cada combinação de endpoint e status documentado é uma condição. Uma condição conta como coberta quando um teste aprovado a exercitou; cenários a mais da PBI não aumentam o número.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard prominent label="Cobertura do contrato" value={summary.percent == null ? "—" : fmtPct(summary.percent)} tone={summary.percent == null ? undefined : summary.percent >= 80 ? "success" : summary.percent > 0 ? "warning" : "danger"} />
        <StatCard prominent label="Condições cobertas" value={<>{fmtInt(summary.covered)}<span className="text-xl text-muted-foreground"> / {fmtInt(summary.testable)}</span></>} hint={`${fmtInt(summary.excluded)} respostas de erro do servidor não entram na conta`} />
        <StatCard prominent label="Endpoints 100%" value={<>{fmtInt(summary.fullyCovered)}<span className="text-xl text-muted-foreground"> / {fmtInt(summary.endpoints)}</span></>} tone={summary.fullyCovered ? "success" : undefined} />
        <StatCard prominent label="Endpoints sem teste" value={fmtInt(summary.notCovered)} tone={summary.notCovered ? "danger" : "success"} hint={`${fmtInt(summary.partiallyCovered)} parcialmente cobertos`} />
      </div>
      <Bar percent={summary.percent} />

      {data.missing.length > 0 && <p className="text-xs text-warning">Sem contrato publicado: {data.missing.map((m) => `${m.project} (${m.reason})`).join("; ")}.</p>}

      <div role="radiogroup" aria-label="Filtrar endpoints" className="inline-flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
        {FILTERS.map((f) => {
          const count = f.value === "all" ? withBase.length : f.value === "none" ? summary.notCovered : f.value === "full" ? summary.fullyCovered : summary.partiallyCovered;
          return (
            <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}
              className={cn("min-h-9 rounded-md px-3 text-sm font-semibold transition-colors hover:bg-subtle", filter === f.value ? "bg-card text-on-brand-subtle shadow-sm" : "text-[color:var(--conecta-color-content-secondary)]")}>
              {f.label} ({fmtInt(count)})
            </button>
          );
        })}
      </div>

      <DataTable detailView onRowSelect={(row) => setSelected(row as unknown as EndpointCoverage)} empty="Nenhum endpoint neste filtro."
        initialSort={{ key: "percent", dir: "asc" }}
        rows={visible.map((e) => ({ ...e, title: `${e.method} ${e.path}`, coverage: `${e.covered} de ${e.testable}`, missing: e.missingStatuses.join(", ") || "—" })) as unknown as Record<string, unknown>[]}
        columns={[
          ...(multiProject ? [{ key: "project", label: "Projeto", width: 170 }] : []),
          { key: "title", label: "Endpoint", width: 420, className: "font-mono text-xs" },
          { key: "coverage", label: "Condições cobertas", width: 190 },
          { key: "percent", label: "Cobertura", numeric: true, width: 170, render: (r) => <span className="inline-flex w-full items-center justify-end gap-2"><span className="w-20"><Bar percent={r["percent"] as number} /></span>{fmtPct(Number(r["percent"]))}</span> },
          { key: "missing", label: "Status sem teste", width: 230, className: "font-mono text-xs" },
        ]} />

      <p className="text-xs text-muted-foreground">
        Contrato gerado em {[...new Set(data.sources.map((s) => (s.coverage.generatedAt ? fmtDate(s.coverage.generatedAt.slice(0, 10)) : "data desconhecida")))].join(", ")}, a partir de {data.sources.map((s) => `${s.coverage.sourceRepository || s.project}@${s.coverage.sourceCommit.slice(0, 7) || s.coverage.sourceBranch}`).join(", ")}. A medição é semanal. Não entram na conta as respostas que só acontecem quando o servidor falha — erro interno (500), serviço indisponível (502/503/504) e excesso de requisições (429) —, porque um teste não deve provocá-las de propósito.
      </p>

      <EndpointDetail endpoint={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function EndpointDetail({ endpoint, onClose }: { endpoint: EndpointCoverage | null; onClose: () => void }) {
  const conditions = endpoint ? [...endpoint.conditions].sort((a, b) => Number(a.status) - Number(b.status)) : [];
  return (
    <Dialog open={endpoint !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {endpoint && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{endpoint.method} {endpoint.path}</DialogTitle>
              <DialogDescription>{endpoint.project} · {fmtInt(endpoint.covered)} de {fmtInt(endpoint.testable)} condições cobertas{endpoint.percent != null ? ` (${fmtPct(endpoint.percent)})` : ""}</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2">
              {conditions.map((condition, index) => {
                const testable = isTestableStatus(condition.status);
                return (
                  <li key={index} className="flex items-start gap-3 rounded-md border border-border p-3">
                    <span className={cn("rounded-md px-2 py-0.5 font-mono text-sm font-semibold", !testable ? "bg-muted text-muted-foreground" : condition.covered ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger")}>{condition.status}</span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">{!testable ? "Não entra na conta (erro do servidor)" : condition.covered ? "Coberta" : "Sem teste"}</p>
                      {condition.covered && (condition.scenario || condition.testFile) && <p className="break-words text-xs text-muted-foreground">{condition.scenario}{condition.testFile ? ` — ${condition.testFile}` : ""}</p>}
                      {testable && !condition.covered && <p className="text-xs text-muted-foreground">Nenhum teste aprovado recebeu este status neste endpoint.</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
