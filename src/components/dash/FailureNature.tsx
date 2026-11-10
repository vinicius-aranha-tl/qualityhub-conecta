import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { NatureData } from "@/data/useDashboard";
import { groupClassified, NATURE_LABEL, NATURE_MEANING, NATURE_ORDER, NATURE_OWNER, PHASE_LABEL, SYMPTOM_LABEL, testLocation, type CapturedEvidence, type ClassifiedFailure, type Confidence, type FailureNature, type NatureGroup, type Product } from "@/lib/metrics";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "./DataTable";
import { EmptyState, fmtDate, fmtInt } from "./primitives";

/** Cor de cada categoria (tokens do Conecta DS). */
export const NATURE_COLOR: Record<FailureNature, string> = {
  product: "var(--danger)",
  environment: "var(--warning)",
  test_data: "var(--conecta-color-brand-institutional)",
  automation: "var(--conecta-color-info)",
  investigate: "var(--muted-foreground)",
};

/** Quão certo é o motivo, em palavras simples (só no detalhe da falha). */
const CONFIDENCE: Record<Confidence, { label: string; variant: "success" | "warning" | "secondary"; help: string }> = {
  alta: { label: "Motivo confirmado", variant: "success", help: "A própria execução comprova o motivo (por exemplo, o sistema respondeu erro 500 ou o ambiente caiu)." },
  "média": { label: "Motivo provável", variant: "warning", help: "O motivo é o mais provável porque a falha se repete do mesmo jeito, mas vale confirmar na execução." },
  baixa: { label: "Motivo a confirmar", variant: "secondary", help: "Sabemos o que falhou, mas não o porquê. Abra a execução (tela, vídeo e rede) para descobrir." },
};

const MAX_ITEMS = 4;
const testId = (r: ClassifiedFailure) => `${r.product}|${r.dataSource}|${r.testKey}`;
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function ConfidenceBadge({ value }: { value: Confidence }) {
  return <Badge variant={CONFIDENCE[value].variant} title={CONFIDENCE[value].help}>{CONFIDENCE[value].label}</Badge>;
}

export function FailureNaturePanel({ data, product }: { data: NatureData; product: Product }) {

  const [selected, setSelected] = useState<NatureGroup | null>(null);
  const rows = useMemo(() => data.rows.filter((r) => r.product === product), [data.rows, product]);
  const groups = useMemo(() => groupClassified(rows), [rows]);
  const incidents = data.incidents.filter((i) => i.product === product);
  const totalTests = new Set(rows.map(testId)).size;
  const present = NATURE_ORDER.filter((n) => rows.some((r) => r.nature === n));
  const absent = NATURE_ORDER.filter((n) => !present.includes(n));

  return (
    <div className="grid min-w-0 gap-5">
      {rows.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm text-card-foreground">
            <strong>{plural(rows.length, "falha definitiva", "falhas definitivas")}</strong> no período, em {plural(totalTests, "teste", "testes")} — o mesmo total do card "Falhas definitivas". Cada falha está em um único motivo:
          </p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {present.map((nature) => <div key={nature} style={{ width: `${(rows.filter((r) => r.nature === nature).length / rows.length) * 100}%`, backgroundColor: NATURE_COLOR[nature] }} />)}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Soma das falhas por motivo">
            {present.map((nature, index) => (
              <span key={nature} className="inline-flex items-center gap-1.5">
                {index > 0 && <span className="text-muted-foreground">+</span>}
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NATURE_COLOR[nature] }} />
                {NATURE_LABEL[nature]} <strong>{fmtInt(rows.filter((r) => r.nature === nature).length)}</strong>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground">=</span> <strong>{fmtInt(rows.length)}</strong></span>
          </p>
          <p className="text-xs text-muted-foreground">
            Clique em um teste para ver o motivo, o erro e o link da execução.
          </p>
        </div>
      )}

      {data.missing.includes(product) && <p className="text-xs text-warning">Sem histórico de testes de {product.toUpperCase()} no período.</p>}

      {rows.length === 0 ? <EmptyState>Nenhum teste falhou no período.</EmptyState> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {present.map((nature) => {
              const of = rows.filter((r) => r.nature === nature);
              const tests = new Set(of.map(testId)).size;
              const natureIncidents = nature === "environment" ? incidents : [];
              const isolated = groups.filter((g) => g.nature === nature && g.incidentOccurrences < g.occurrences);
              const items = isolated.slice(0, MAX_ITEMS);
              return (
                <article key={nature} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border border-l-4 p-4" style={{ borderLeftColor: NATURE_COLOR[nature] }}>
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-card-foreground">{NATURE_LABEL[nature]}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Quem age: <strong className="text-card-foreground">{NATURE_OWNER[nature]}</strong></p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-3xl font-semibold leading-none" style={{ color: NATURE_COLOR[nature] }}>{fmtInt(of.length)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{of.length === 1 ? "falha" : "falhas"} · {plural(tests, "teste", "testes")}</div>
                    </div>
                  </header>
                  <p className="text-sm text-muted-foreground">{NATURE_MEANING[nature]}</p>
                  <ul className="grid gap-1 border-t border-border pt-3 text-sm">
                    {natureIncidents.map((i) => (
                      <li key={`${i.dataSource}-${i.runId}`} className="mb-1 rounded-md bg-warning-subtle px-3 py-2">
                        <strong>{fmtDate(i.date)}:</strong> {fmtInt(i.failed)} de {fmtInt(i.total)} testes falharam na mesma execução — sinal de queda do ambiente.
                        {i.runUrl && <a href={i.runUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 font-semibold text-[color:var(--conecta-color-brand-content)] hover:underline">Abrir execução <ExternalLink aria-hidden className="h-3 w-3" /></a>}
                      </li>
                    ))}
                    {items.map((g) => (
                      <li key={`${g.dataSource}-${g.testKey}-${g.symptom}`}>
                        <button type="button" onClick={() => setSelected(g)} className="flex w-full min-w-0 items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-subtle focus-visible:outline focus-visible:outline-2">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-card-foreground" title={g.title}>{g.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{SYMPTOM_LABEL[g.symptom]}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{g.occurrences === 1 ? "1 vez" : `${fmtInt(g.occurrences)} vezes`}</span>
                        </button>
                      </li>
                    ))}
                    {isolated.length > MAX_ITEMS && <li className="px-2 text-xs text-muted-foreground">e mais {plural(isolated.length - MAX_ITEMS, "teste", "testes")} no Detalhamento das falhas.</li>}
                  </ul>
                </article>
              );
            })}
          </div>

          {absent.length > 0 && <p className="text-xs text-muted-foreground">Sem falhas no período: {absent.map((n) => NATURE_LABEL[n]).join(", ")}.</p>}

          <p className="text-xs text-muted-foreground">O motivo vem do que foi registrado na execução (chamadas, erros da tela, etapa que falhou) e da mensagem de erro. A lista de todas as falhas está no Detalhamento das falhas.</p>
        </>
      )}

      <FailureDetail group={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/**
 * Detalhamento das falhas: lista de cada falha definitiva (teste + erro) com o mesmo motivo do painel
 * "Motivo das falhas", filtro por motivo e o detalhe com a prova e o link da execução.
 */
export function FailureDetailsTable({ data, product }: { data: NatureData; product: Product }) {
  const [selected, setSelected] = useState<NatureGroup | null>(null);
  const [filter, setFilter] = useState<FailureNature | "all">("all");
  const rows = useMemo(() => data.rows.filter((r) => r.product === product), [data.rows, product]);
  const groups = useMemo(() => groupClassified(rows), [rows]);
  const present = NATURE_ORDER.filter((n) => groups.some((g) => g.nature === n));
  const visible = filter === "all" ? groups : groups.filter((g) => g.nature === filter);
  const count = (nature: FailureNature | "all") => (nature === "all" ? rows : rows.filter((r) => r.nature === nature)).length;

  if (data.missing.includes(product) && !rows.length) return <EmptyState>Sem histórico de testes de {product.toUpperCase()} no período.</EmptyState>;
  return (
    <div className="grid min-w-0 gap-3">
      {present.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="filtro-motivo" className="text-sm">Motivo</Label>
          <Select value={filter} onValueChange={(value) => setFilter(value as FailureNature | "all")}>
            <SelectTrigger id="filtro-motivo" className="w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os motivos ({fmtInt(count("all"))})</SelectItem>
              {present.map((value) => (
                <SelectItem key={value} value={value}>
                  <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NATURE_COLOR[value] }} />{NATURE_LABEL[value]} ({fmtInt(count(value))})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DataTable detailView onRowSelect={(row) => setSelected(row as unknown as NatureGroup)} empty="Nenhuma falha definitiva no período selecionado."
        rows={visible.map((g) => ({ ...g, natureLabel: NATURE_LABEL[g.nature], symptomLabel: SYMPTOM_LABEL[g.symptom] })) as unknown as Record<string, unknown>[]}
        initialSort={{ key: "occurrences", dir: "desc" }} columns={[
          { key: "title", label: "Cenário", width: 320 },
          { key: "error", label: "Erro", width: 320, className: "font-mono text-xs", render: (r) => String(r["error"] || "Mensagem não registrada") },
          { key: "natureLabel", label: "Motivo provável", width: 250, render: (r) => <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: NATURE_COLOR[r["nature"] as FailureNature] }} />{String(r["natureLabel"])}</span> },
          { key: "occurrences", label: "Ocorrências", numeric: true, width: 150, render: (r) => <>{fmtInt(Number(r["occurrences"]))}{Number(r["incidentOccurrences"]) > 0 && <span className="ml-1 text-xs text-muted-foreground">({fmtInt(Number(r["incidentOccurrences"]))} na queda do ambiente)</span>}</> },
          { key: "lastDate", label: "Última vez", width: 150, render: (r) => fmtDate(String(r["lastDate"])) },
        ]} />
      <FailureDetail group={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{children}</dd></div>;
}

/** Evidência bruta da última ocorrência: etapa, tela e chamadas. */
function CapturedDetails({ captured }: { captured: CapturedEvidence }) {
  const path = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };
  return (
    <>
      {(captured.phase || captured.failedStep) && <Field label="Etapa que falhou">{captured.phase ? PHASE_LABEL[captured.phase] : "Etapa não identificada"}{captured.failedStep ? ` — "${captured.failedStep}"` : ""}</Field>}
      {captured.pageUrl && <Field label="Tela no momento da falha">{path(captured.pageUrl)}{captured.pageTitle ? ` — ${captured.pageTitle}` : ""}</Field>}
      {captured.calls.length > 0 && (
        <Field label={`Chamadas da API (últimas ${captured.calls.length})`}>
          <ul className="grid gap-1 font-mono text-xs">
            {captured.calls.map((call, index) => (
              <li key={index} className={call.status == null || call.status >= 400 ? "text-danger" : "text-muted-foreground"}>
                {call.method} {path(call.url)} → {call.status ?? "sem resposta"}{call.ms != null ? ` · ${fmtInt(call.ms)} ms` : ""}{call.detail ? ` · ${call.detail}` : ""}{call.error ? ` · ${call.error}` : ""}
              </li>
            ))}
          </ul>
        </Field>
      )}
      {(captured.httpErrors.length > 0 || captured.networkFailures.length > 0) && (
        <Field label="Erros de rede da tela">
          <ul className="grid gap-1 font-mono text-xs text-danger">
            {captured.httpErrors.map((e, index) => <li key={`h${index}`}>{e.method} {path(e.url)} → {e.status}{e.type ? ` (${e.type})` : ""}</li>)}
            {captured.networkFailures.map((n, index) => <li key={`n${index}`}>{n.method} {path(n.url)} → {n.error}</li>)}
          </ul>
        </Field>
      )}
      {(captured.pageErrors.length > 0 || captured.consoleErrors.length > 0) && (
        <Field label="Erros da página e do console">
          <ul className="grid gap-1 font-mono text-xs">{[...captured.pageErrors, ...captured.consoleErrors].map((e, index) => <li key={index}>{e}</li>)}</ul>
        </Field>
      )}
    </>
  );
}

function FailureDetail({ group, onClose }: { group: NatureGroup | null; onClose: () => void }) {
  return (
    <Dialog open={group !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {group && (
          <>
            <DialogHeader>
              <DialogTitle>{group.title}</DialogTitle>
              <DialogDescription>{group.product.toUpperCase()} · {group.dataSource}{testLocation(group.testKey) ? ` · ${testLocation(group.testKey)}` : ""}</DialogDescription>
            </DialogHeader>
            <dl className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border border-l-4 p-3" style={{ borderLeftColor: NATURE_COLOR[group.nature] }}>
                <span className="font-semibold">{NATURE_LABEL[group.nature]}</span>
                <ConfidenceBadge value={group.confidence} />
                <span className="basis-full text-xs text-muted-foreground">{CONFIDENCE[group.confidence].help}</span>
                <span className="text-xs text-muted-foreground">Quem age: {NATURE_OWNER[group.nature]}</span>
              </div>
              <Field label="O que aconteceu">{SYMPTOM_LABEL[group.symptom]}</Field>
              <Field label="Por que este motivo">{group.rule}</Field>
              <Field label="Prova">
                {group.proof.length
                  ? <ul className="grid gap-1">{group.proof.map((line) => <li key={line}><code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs">{line}</code></li>)}</ul>
                  : <span className="text-muted-foreground">{group.source === "evidencia" ? "O motivo veio da etapa que falhou e do tipo de erro." : "Execução antiga, de antes do registro detalhado: só a mensagem de erro está disponível."}</span>}
                <span className="mt-1 block text-xs text-muted-foreground">{group.source === "evidencia" ? "Decidido pelo que a execução registrou." : "Decidido só pela mensagem de erro."}</span>
              </Field>
              {group.captured && <CapturedDetails captured={group.captured} />}
              <Field label="Mensagem de erro"><code className="block rounded-md bg-subtle p-2 font-mono text-xs">{group.error || "A execução não registrou a mensagem de erro."}</code></Field>
              <Field label={`Execuções com falha (${fmtInt(group.occurrences)})`}>
                <ul className="grid gap-1">
                  {group.runs.map((run) => (
                    <li key={run.runId} className="flex flex-wrap items-center gap-x-2">
                      <span>{fmtDate(run.date)}</span>
                      {run.incident && <span className="text-xs text-warning">· durante queda do ambiente</span>}
                      {run.runUrl ? <a href={run.runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--conecta-color-brand-content)] hover:underline">Abrir execução no GitHub <ExternalLink aria-hidden className="h-3 w-3" /></a> : <span className="text-xs text-muted-foreground">· link indisponível</span>}
                    </li>
                  ))}
                </ul>
              </Field>
              <p className="text-xs text-muted-foreground">Na execução do GitHub, o relatório do Playwright tem captura de tela, vídeo e chamadas de rede do momento da falha — é onde se confirma, por exemplo, se a tela estava com erro 404.</p>
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
