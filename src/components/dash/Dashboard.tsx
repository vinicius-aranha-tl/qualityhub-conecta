import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileDown, Pencil, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { backend } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { PERIOD_LABEL, useDashboardData, useFilters } from "@/data/useDashboard";
import { exportReportPdf, type ReportSectionKey } from "@/lib/reportPdf";
import { ReportDialog } from "./ReportDialog";
import { CHART_KINDS, ChartIcon } from "./chartKinds";
import type { Product } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { EmptyState, Panel } from "./primitives";
import { SourceBadges } from "./SourceBadges";
import { DEFAULT_WIDGETS, HIDDEN_WIDGETS, orderPanels, WIDGET_CATALOG, WidgetBody, type WidgetType } from "./widgets";
import { LoadingOverlay } from "@/components/dash/LoadingOverlay";

const ALL_PRODUCTS: Product[] = ["api", "ui"];

interface Widget {
  id: string | null;
  widget_type: string;
  title: string;
  width: "half" | "full";
  position: number;
}

function defaultsFor(isOverview: boolean): Omit<Widget, "id">[] {
  const list = [...DEFAULT_WIDGETS];
  if (isOverview) list.splice(list.findIndex((w) => w.widget_type === "daily_execution_volume") + 1, 0, { widget_type: "project_ranking", width: "full" });
  return list.map((w, i) => ({ ...w, title: WIDGET_CATALOG[w.widget_type].defaultTitle, position: i }));
}

function MetricExplanation({ type }: { type: string }) {
  const item = WIDGET_CATALOG[type as WidgetType];
  if (!item) return null;
  const paragraphs = type === "summary_cards"
    ? (item.info ?? "").split(/(?=Testes:|Execuções válidas:|Falhas definitivas:|Flaky tests:)/).filter(Boolean)
    : (item.info ?? "").split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/u).filter(Boolean);
  return <><div><p className="font-semibold">O que mostra</p><p>{item.description}</p></div>{paragraphs.length > 0 && <div className="space-y-2"><p className="font-semibold">Como interpretar</p>{paragraphs.map((paragraph, index) => {
    const match = paragraph.match(/^([^:]{1,35}):\s+(.+)$/s);
    return <p key={index}>{match ? <><strong>{match[1]}:</strong> {match[2]}</> : paragraph}</p>;
  })}</div>}</>;
}

export function Dashboard({ projectId, slug, name, onSources, products = ALL_PRODUCTS }: { projectId: string | null; slug: string | null; name?: string; onSources?: (() => void) | undefined; /** Frentes do projeto: só as abas delas aparecem. */ products?: Product[] }) {
  const [product, setProduct] = useState<Product>(products[0] ?? "api");
  useEffect(() => { if (!products.includes(product)) setProduct(products[0] ?? "api"); }, [products, product]);
  const [exporting, setExporting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const { canEdit } = useAuth();
  const { filters } = useFilters();
  const apiData = useDashboardData(slug, "api");
  const uiData = useDashboardData(slug, "ui");
  useEffect(() => { setEditMode(false); }, [projectId]);

  async function exportPdf(sections: ReportSectionKey[]) {
    setExporting(true);
    try {
      if (!apiData.d || !uiData.d) throw new Error("Aguarde os dados de API e UI terminarem de carregar.");
      await exportReportPdf({
        projectName: name ?? "Visão geral — todos os projetos",
        periodLabel: PERIOD_LABEL[filters.period],
        isOverview: !projectId,
        products: Object.fromEntries(products.map((p) => [p, p === "api" ? apiData.d! : uiData.d!])),
        include: sections,
        generatedAt: new Date(),
      }, `${slug ?? "visao-geral"}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF gerado");
      setReportOpen(false);
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {products.length > 1 ? (
          <Tabs value={product} onValueChange={(v) => setProduct(v as Product)}>
            <TabsList>
              {products.map((p) => <TabsTrigger key={p} value={p}>{p.toUpperCase()}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        ) : <span className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">{product === "api" ? "API (back-end)" : "UI (front-end)"}</span>}
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button size="sm" variant={editMode ? "secondary" : "outline"} aria-pressed={editMode} onClick={() => setEditMode((current) => !current)}><Pencil className="h-4 w-4" /> {editMode ? "Concluir edição" : "Editar painel"}</Button>}
          {canEdit && editMode && onSources && <Button size="sm" variant="outline" onClick={onSources}><Settings2 className="h-4 w-4" /> Fontes do GitHub</Button>}
          <span className="self-center rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground">Monitoramento de testes: HML</span>
          <Button size="sm" disabled={exporting} onClick={() => setReportOpen(true)}><FileDown className="h-4 w-4" /> {exporting ? "Gerando relatório…" : "Exportar relatório"}</Button>
        </div>
      </div>
      {products.map((p) => (
        <div key={p} className={cn(p !== product && "hidden")}>
          <ProductDashboard projectId={projectId} slug={slug} product={p} editMode={editMode} />
        </div>
      ))}
      {reportOpen && <ReportDialog isOverview={!projectId} products={products} generating={exporting} onClose={() => setReportOpen(false)} onGenerate={exportPdf} />}
    </div>
  );
}

function ProductDashboard({ projectId, slug, product, editMode }: { projectId: string | null; slug: string | null; product: Product; editMode: boolean }) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const { d, error, isLoading, periodLabel } = useDashboardData(slug, product);
  const widgetsKey = ["widgets", projectId, product];
  const wq = useQuery({
    queryKey: widgetsKey,
    queryFn: async () => {
      return backend.widgets(projectId, product);
    },
  });
  const stored = wq.data ?? [];
  const widgets: Widget[] = stored.length ? stored : defaultsFor(!projectId).map((w) => ({ ...w, id: null }));
  // Fora da edição, os painéis seguem a ordem padrão (PANEL_ORDER) e os ocultos não aparecem.
  const displayedWidgets = editMode ? widgets.filter((widget) => !HIDDEN_WIDGETS.includes(widget.widget_type as WidgetType)) : orderPanels(widgets);
  const [editing, setEditing] = useState<Widget | "new" | null>(null);
  useEffect(() => { if (!editMode) setEditing(null); }, [editMode]);

  /** Defaults are virtual until the first edit; persist them so edits have rows to act on. */
  async function materialize(): Promise<Widget[]> {
    if (stored.length) return stored;
    const rows = defaultsFor(!projectId).map((w) => ({ ...w, product, project_id: projectId }));
    const data = await Promise.all(rows.map((row) => backend.createWidget(row)));
    return data.sort((a, b) => a.position - b.position);
  }

  const mutate = useMutation({
    mutationFn: async (op: (rows: Widget[]) => Promise<void>) => op(await materialize()),
    onSuccess: () => qc.invalidateQueries({ queryKey: widgetsKey }),
    onError: (e) => toast.error((e as Error).message),
  });

  const findRow = (rows: Widget[], w: Widget) => rows.find((r) => (w.id ? r.id === w.id : r.position === w.position))!;
  const move = (w: Widget, dir: -1 | 1) =>
    mutate.mutate(async (rows) => {
      const i = rows.indexOf(findRow(rows, w));
      const j = i + dir;
      if (j < 0 || j >= rows.length) return;
      const a = rows[i]!, b = rows[j]!;
      await backend.updateWidget({ ...a, id: a.id!, product, project_id: projectId, position: b.position });
      await backend.updateWidget({ ...b, id: b.id!, product, project_id: projectId, position: a.position });
    });
  const remove = (w: Widget) =>
    mutate.mutate(async (rows) => {
      await backend.deleteWidget(findRow(rows, w).id!);
    });
  const reset = () =>
    mutate.mutate(async () => {
      await backend.deleteWidgets(projectId, product);
    });
  const save = (form: { widget_type: string; title: string; width: "half" | "full" }) =>
    mutate.mutate(async (rows) => {
      if (editing === "new") {
        const position = Math.max(-1, ...rows.map((r) => r.position)) + 1;
        await backend.createWidget({ ...form, position, product, project_id: projectId });
      } else if (editing) {
        const row = findRow(rows, editing);
        await backend.updateWidget({ ...row, ...form, id: row.id!, product, project_id: projectId });
      }
      setEditing(null);
    });

  if (error) return <EmptyState>Não foi possível carregar os dados: {(error as Error).message}</EmptyState>;
  if (wq.error) return <EmptyState><div className="grid justify-items-center gap-3"><span>Não foi possível carregar a configuração dos gráficos.</span><Button variant="outline" onClick={() => wq.refetch()}>Tentar novamente</Button></div></EmptyState>;
  if (isLoading || !d || wq.isLoading)
    return <LoadingOverlay />;
  if (!d.projects.length) return <EmptyState>Nenhum projeto cadastrado ainda. Crie um em Projetos.</EmptyState>;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 empty:hidden">
        <SourceBadges projects={d.projects} product={product} />
        {canEdit && editMode && (
          <div className="flex gap-2">
            {stored.length > 0 && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="h-4 w-4" /> Restaurar padrão</Button>}
            <Button variant="secondary" size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Adicionar gráfico</Button>
          </div>
        )}
      </div>
      {widgets.length === 0 ? (
        <EmptyState>Nenhum gráfico neste painel.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {displayedWidgets.map((w, i) => (
            <Panel
              key={w.id ?? `d${i}`}
              title={w.widget_type === "evolution" && w.title === "Evolução do produto versus automação" ? WIDGET_CATALOG.evolution.defaultTitle : ["flaky_table", "failure_details", "failure_history"].includes(w.widget_type) ? w.title.replace(/\s*[—-]\s*últimos 30 dias/iu, "").replace(/\s*[—-]\s*ciclo de vida/iu, "") : w.title}
              info={<><MetricExplanation type={w.widget_type} /><div className="space-y-1"><p className="font-semibold">Fontes de dados</p>{(w.widget_type === "flaky_table" ? d.specialByProduct.flaky.used : w.widget_type === "failure_details" ? d.nature.used : w.widget_type === "cause_donut" ? d.specialByProduct.reasons.used : w.widget_type === "failure_history" ? d.specialByProduct.lifecycle.used : w.widget_type === "failure_nature" ? d.nature.used : []).map((u, index) => <p key={index}>{u.product.toUpperCase()}: {u.file}{u.fallback ? ` (alternativa${u.reason ? `: ${u.reason}` : ""})` : ""}</p>)}{!["flaky_table", "failure_details", "cause_donut", "failure_history", "failure_nature"].includes(w.widget_type) && d.projects.map(p => <p key={p.project.id}>{p.project.name}: {product.toUpperCase()} — {w.widget_type === "evolution" || w.widget_type === "coverage_waterfall" ? "evolução" : "execuções"} ({(w.widget_type === "evolution" || w.widget_type === "coverage_waterfall" ? p.sources[product].evolution : p.sources[product].executions).mode})</p>)}</div></>}
              className={cn(w.width === "full" && "lg:col-span-2")}
              pdfInfo={`${WIDGET_CATALOG[w.widget_type as WidgetType]?.description ?? ""} ${WIDGET_CATALOG[w.widget_type as WidgetType]?.info ?? ""}`.trim()}
              action={
                canEdit && editMode && (
                  <div className="flex gap-0.5" data-pdf-ignore>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(w, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mover para baixo" disabled={i === widgets.length - 1} onClick={() => move(w, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar gráfico" onClick={() => setEditing(w)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" aria-label="Excluir gráfico" onClick={() => remove(w)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )
              }
            >
              <WidgetBody type={w.widget_type} d={d} product={product} periodLabel={periodLabel} />
            </Panel>
          ))}
        </div>
      )}
      {canEdit && editMode && editing && <WidgetDialog initial={editing === "new" ? null : editing} isOverview={!projectId} onClose={() => setEditing(null)} onSave={save} saving={mutate.isPending} />}
    </div>
  );
}

function WidgetDialog({ initial, isOverview, onClose, onSave, saving }: { initial: Widget | null; isOverview: boolean; onClose: () => void; onSave: (f: { widget_type: string; title: string; width: "half" | "full" }) => void; saving: boolean }) {
  const [type, setType] = useState<WidgetType>((initial?.widget_type as WidgetType) ?? "success_gauge");
  const [title, setTitle] = useState(initial?.title ?? WIDGET_CATALOG.success_gauge.defaultTitle);
  const [width, setWidth] = useState<"half" | "full">(initial?.width ?? "half");
  const types = (Object.keys(WIDGET_CATALOG) as WidgetType[]).filter((t) => (isOverview || t !== "project_ranking") && !HIDDEN_WIDGETS.includes(t));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{initial ? "Editar gráfico" : "Adicionar gráfico"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Tipo de gráfico</Label>
            <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {types.map((t) => {
                const c = WIDGET_CATALOG[t];
                return (
                  <button key={t} type="button" onClick={() => { setType(t); if (!initial) { setTitle(c.defaultTitle); setWidth(c.defaultWidth); } }}
                    className={cn("flex flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors", type === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                    <ChartIcon kind={c.kind} className="h-8 w-10" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{CHART_KINDS[c.kind].label}</span>
                    <span className="text-xs font-medium leading-tight">{c.label}</span>
                  </button>
                );
              })}
              <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border p-2 opacity-50" title={CHART_KINDS.map.when}>
                <ChartIcon kind="map" className="h-8 w-10" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mapa</span>
                <span className="text-xs leading-tight">Não se aplica</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground"><b>{CHART_KINDS[WIDGET_CATALOG[type].kind].label}:</b> {CHART_KINDS[WIDGET_CATALOG[type].kind].when} {WIDGET_CATALOG[type].description}</p>
          </div>
          <div className="grid gap-2"><Label htmlFor="wt">Título</Label><Input id="wt" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid gap-2">
            <Label>Largura</Label>
            <Select value={width} onValueChange={(v) => setWidth(v as "half" | "full")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="half">Metade</SelectItem><SelectItem value="full">Inteira</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!title.trim() || saving} onClick={() => onSave({ widget_type: type, title: title.trim(), width })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
