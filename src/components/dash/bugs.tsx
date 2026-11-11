import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { backend } from "@/lib/backend-client";
import { bugRatio, bugSummary, bugWeeklyFlow, clearProjection, daysAgoISO, NO_SQUAD, type BugItem, type ColumnLoad, type SquadRow } from "@/lib/metrics";
import type { AzureSettings, BugsResult } from "@/lib/sources.functions";
import { requestForcedRefresh } from "@/data/useDashboard";
import { DataTable } from "@/components/dash/DataTable";
import { EmptyState, StatCard, fmtDate, fmtInt } from "@/components/dash/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 };
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false };
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR")}%`);

/** Período do filtro global: `from` null = todo o histórico. */
export function bugPeriod(periodDays: number | null, now = new Date()) {
  return { from: periodDays == null ? null : daysAgoISO(now, periodDays - 1), to: daysAgoISO(now, 0) };
}

/** Squads presentes nos itens, em ordem alfabética, com "Sem squad" por último. */
export function squadsOf(items: BugItem[]): string[] {
  return [...new Set(items.map((b) => b.squad))].sort((a, b) => (a === NO_SQUAD ? 1 : b === NO_SQUAD ? -1 : a.localeCompare(b, "pt-BR")));
}

/** Cartões do resumo; a proporção de bugs aparece quando há PBIs para comparar. */
export function BugCards({ items, pbis, from, to, label }: { items: BugItem[]; pbis?: BugItem[]; from: string | null; to: string; label: string }) {
  const s = bugSummary(items, from, to);
  const ratio = pbis ? bugRatio(items, pbis, from, to) : undefined;
  const clear = clearProjection(items, to);
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${ratio === undefined ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}>
      <StatCard prominent label={`${label} abertos`} value={fmtInt(s.open)} tone={s.open ? "warning" : "success"} hint="Situação de hoje, sem removidos" />
      <StatCard prominent label="Concluídos" value={pct(s.donePercent)} tone="success" hint={`${fmtInt(s.done)} de ${fmtInt(s.total)}`} />
      <StatCard prominent label="Criados no período" value={fmtInt(s.createdInPeriod)} hint={`${fmtInt(s.doneInPeriod)} concluídos no período`} />
      <StatCard prominent label="Projeção para zerar" value={!s.open ? "Concluído" : clear.date ? fmtDate(clear.date) : "—"} hint={!s.open ? `Todos os ${label.toLowerCase()} concluídos` : clear.weeks != null ? `~${fmtInt(clear.weeks)} ${clear.weeks === 1 ? "semana" : "semanas"} no ritmo atual, sem novos itens` : "Sem conclusões nas últimas 8 semanas"} />
      {ratio !== undefined && <StatCard prominent label="Proporção de bugs" value={pct(ratio)} tone={ratio != null && ratio >= 30 ? "danger" : ratio != null && ratio >= 15 ? "warning" : undefined} hint="Bugs ÷ (bugs + PBIs) criados no período" info="De tudo o que entrou no quadro no período (bugs e itens de backlog), quanto foi bug. Quanto menor, mais tempo do time vai para evolução e menos para correção." />}
    </div>
  );
}

/** Fluxo semanal: barras de criados e concluídos em cada semana. */
export function BugFlow({ items, from, to }: { items: BugItem[]; from: string | null; to: string }) {
  const first = items.map((b) => b.createdDate.slice(0, 10)).sort()[0];
  const data = items.length ? bugWeeklyFlow(items, from ?? first ?? to, to) : [];
  if (!data.length) return <EmptyState>Nenhum item no período.</EmptyState>;
  const label = (week: string, i: number) => (i === data.length - 1 && week === to ? `até ${fmtDate(week).slice(0, 5)}` : `sem. ${fmtDate(week).slice(0, 5)}`);
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.map((p, i) => ({ ...p, label: label(p.week, i) }))} barGap={2}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Bar dataKey="created" name="Criados na semana" fill="var(--warning)" radius={[3, 3, 0, 0]} maxBarSize={36} />
          <Bar dataKey="done" name="Concluídos na semana" fill="var(--success)" radius={[3, 3, 0, 0]} maxBarSize={36} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Projeção para zerar os abertos: histórico dos abertos e a queda prevista sem novos itens. */
export function BugClearProjection({ items, to, label }: { items: BugItem[]; to: string; label: string }) {
  const p = clearProjection(items, to);
  const lower = label.toLowerCase();
  const headline = p.open === 0 ? "Nenhum item aberto."
    : p.weeks == null ? `Nenhum item foi concluído nas últimas ${p.lookbackWeeks} semanas: sem ritmo para projetar.`
    : `${fmtInt(p.open)} abertos ÷ ${p.perWeek.toLocaleString("pt-BR")} concluídos por semana (média das últimas ${p.lookbackWeeks} semanas) = cerca de ${fmtInt(p.weeks)} ${p.weeks === 1 ? "semana" : "semanas"}, se não entrarem novos ${lower}.`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Zera em</div>
          <div className="font-display text-3xl font-semibold text-card-foreground">{p.open === 0 ? "Concluído" : p.weeks == null ? "—" : `${fmtInt(p.weeks)} ${p.weeks === 1 ? "semana" : "semanas"}`}</div>
          {p.date && p.open > 0 && <div className="text-xs text-muted-foreground">por volta de {fmtDate(p.date)}</div>}
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">{headline}</p>
      </div>
      {p.open > 0 && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={p.points.map((x) => ({ ...x, label: fmtDate(x.week).slice(0, 5) }))}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line dataKey="actual" name="Abertos (real)" stroke="var(--danger)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line dataKey="projected" name="Projeção sem novos itens" stroke="var(--conecta-color-brand-institutional)" strokeWidth={2.5} strokeDasharray="6 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {p.weeks != null && p.weeks > 26 && <p className="mt-2 text-xs text-muted-foreground">O gráfico mostra só as próximas 26 semanas.</p>}
    </div>
  );
}

/** Barras horizontais simples: quantidade e participação no total. */
export function CountBars({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <EmptyState>Nenhum item.</EmptyState>;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <ul className="grid gap-3">
      {data.map((d) => {
        const share = total ? (d.value / total) * 100 : 0;
        return (
          <li key={d.label} className="min-w-0">
            <div className="mb-1 flex justify-between gap-2 text-sm"><span className="break-words">{d.label}</span><span className="shrink-0 font-semibold tabular-nums">{fmtInt(d.value)} <span className="font-normal text-muted-foreground">· {share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span></span></div>
            <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-[color:var(--conecta-color-brand-institutional)]" style={{ width: `${share}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

/** Carga das colunas do quadro: bugs abertos, demais itens e o limite de WIP da coluna. */
export function ColumnLoadBars({ rows, label, showOthers }: { rows: ColumnLoad[]; label: string; showOthers: boolean }) {
  if (!rows.length) return <EmptyState>O quadro do time não foi lido. Confira o time na configuração do Azure DevOps.</EmptyState>;
  const max = Math.max(1, ...rows.map((r) => Math.max(showOthers ? r.total : r.bugs, r.wip ?? 0)));
  return (
    <div>
      <ul className="grid gap-4">
        {rows.map((r) => {
          const over = showOthers && r.overWip;
          return (
            <li key={r.column} className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.column}</span>
                <span className="text-xs text-muted-foreground">
                  <strong className="text-sm text-card-foreground tabular-nums">{fmtInt(r.bugs)}</strong> {label.toLowerCase()}
                  {showOthers && <> · {fmtInt(r.total)} itens na coluna{r.wip != null && <> · WIP {fmtInt(r.wip)}</>}</>}
                  {over && <span className="ml-1 font-semibold text-danger">acima do limite</span>}
                </span>
              </div>
              <div className="relative flex h-6 overflow-hidden rounded bg-muted">
                <div className="h-full bg-[color:var(--danger)]" style={{ width: `${(r.bugs / max) * 100}%` }} title={`${r.bugs} ${label.toLowerCase()}`} />
                {showOthers && <div className="h-full bg-[color:var(--conecta-color-info)] opacity-60" style={{ width: `${(r.others / max) * 100}%` }} title={`${r.others} outros itens`} />}
                {showOthers && r.wip != null && <div aria-hidden className="absolute inset-y-0 w-0.5 bg-card-foreground" style={{ left: `${(r.wip / max) * 100}%` }} />}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[color:var(--danger)]" /> {label}</span>
        {showOthers && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[color:var(--conecta-color-info)] opacity-60" /> Outros itens (PBIs)</span>}
        {showOthers && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-card-foreground" /> Limite de WIP</span>}
      </p>
    </div>
  );
}

/** Comparativo por squad. */
export function SquadTable({ rows }: { rows: SquadRow[] }) {
  return (
    <DataTable rows={rows as unknown as Record<string, unknown>[]} initialSort={{ key: "open", dir: "desc" }} empty="Nenhum bug encontrado." columns={[
      { key: "squad", label: "Squad", render: (r) => <span className="font-semibold">{String(r["squad"])}</span> },
      { key: "open", label: "Abertos", numeric: true, render: (r) => <span className={Number(r["open"]) ? "font-semibold text-warning" : "text-success"}>{fmtInt(Number(r["open"]))}</span> },
      { key: "total", label: "Total", numeric: true, render: (r) => fmtInt(Number(r["total"])) },
      { key: "donePercent", label: "% concluídos", numeric: true, render: (r) => pct(r["donePercent"] as number | null) },
      { key: "createdInPeriod", label: "Criados no período", numeric: true, render: (r) => fmtInt(Number(r["createdInPeriod"])) },
      { key: "doneInPeriod", label: "Concluídos no período", numeric: true, render: (r) => fmtInt(Number(r["doneInPeriod"])) },
      { key: "avgOpenAgeDays", label: "Tempo médio parado", numeric: true, render: (r) => (r["avgOpenAgeDays"] == null ? "—" : `${fmtInt(Number(r["avgOpenAgeDays"]))} dias`) },
      { key: "bugRatio", label: "Proporção de bugs", numeric: true, render: (r) => pct(r["bugRatio"] as number | null) },
      { key: "projection", label: "Projeção", render: (r) => (r["projection"] ? fmtDate(String(r["projection"])) : Number(r["open"]) ? "—" : "Concluído") },
    ]} />
  );
}

/** Situação da leitura: falta de configuração, de token ou erro na última atualização. */
export function BugsStatus({ result, isAdmin }: { result: BugsResult; isAdmin: boolean }) {
  const notes: string[] = [];
  if (!result.settings) notes.push(isAdmin ? "Configure a organização, o projeto, a área raiz e o time do Azure DevOps em “Configurar Azure DevOps”." : "O Azure DevOps ainda não foi configurado por um administrador.");
  else if (isAdmin && !result.tokenConfigured) notes.push("O token do Azure DevOps (AZURE_DEVOPS_PAT, leitura de Work Items) não está configurado no servidor.");
  if (result.message) notes.push(result.message);
  if (result.dataset?.refreshError) notes.push(result.dataset.refreshError);
  return (
    <>
      {notes.length > 0 && <div role="status" className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">{notes.map((n) => <p key={n}>{n}</p>)}</div>}
      {result.dataset && <p className="text-xs text-muted-foreground">Leitura do Azure DevOps em {new Date(result.dataset.fetchedAt).toLocaleString("pt-BR")} · área {result.settings?.rootArea}{result.dataset.boardName ? ` · quadro ${result.settings?.team} / ${result.dataset.boardName}` : ""}</p>}
    </>
  );
}

const EMPTY: AzureSettings = { organization: "", project: "", rootArea: "", team: "" };

/** Configuração única do Azure DevOps (todas as squads). Só administradores. */
export function AzureSettingsDialog({ settings }: { settings: AzureSettings | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AzureSettings>(settings ?? EMPTY);
  useEffect(() => { if (open) setForm(settings ?? EMPTY); }, [open, settings]);
  const save = useMutation({
    mutationFn: () => backend.saveAzureSettings({ organization: form.organization.trim(), project: form.project.trim(), rootArea: form.rootArea.trim(), team: form.team.trim() }),
    onSuccess: () => {
      toast.success("Configuração do Azure DevOps salva");
      setOpen(false);
      requestForcedRefresh();
      qc.invalidateQueries({ queryKey: ["dataset", "bugs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const field = (key: keyof AzureSettings, label: string, placeholder: string, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`az-${key}`}>{label}</Label>
      <Input id={`az-${key}`} value={form[key]} placeholder={placeholder} maxLength={key === "rootArea" ? 250 : 100} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  const valid = Object.values(form).every((v) => v.trim());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Settings2 className="h-4 w-4" /> Configurar Azure DevOps</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Azure DevOps</DialogTitle>
          <DialogDescription>Uma configuração para todas as squads. O token de leitura fica só no servidor (AZURE_DEVOPS_PAT).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {field("organization", "Organização", "minha-org", "Como aparece em dev.azure.com/<organização>.")}
          {field("project", "Projeto", "MeuProjeto")}
          {field("rootArea", "Área raiz", String.raw`MeuProjeto\Development`, "Bugs e defeitos abaixo desta área. Cada subárea é uma squad.")}
          {field("team", "Time do quadro", "Development", "Time dono do quadro de Backlog items (colunas e limites de WIP).")}
        </div>
        <DialogFooter><Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
