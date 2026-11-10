import type { jsPDF } from "jspdf";
import type { DashData } from "@/data/useDashboard";
import { daysAgoISO, groupClassified, NATURE_LABEL, NATURE_ORDER, NATURE_OWNER, summarize, testCount, type FailureNature, type Product } from "@/lib/metrics";

/** Seções que podem entrar no relatório, na ordem em que aparecem. */
export const REPORT_SECTIONS = [
  { key: "summary", label: "Resumo (números principais)" },
  { key: "volume", label: "Volume diário de execuções" },
  { key: "ranking", label: "Comparativo por projeto", overviewOnly: true },
  { key: "nature", label: "Motivo das falhas e quem resolve" },
  { key: "details", label: "Detalhamento das falhas" },
  { key: "flaky", label: "Flaky tests" },
  { key: "history", label: "Histórico de falhas" },
] as const;
export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];

/** Seções disponíveis para a página: o comparativo só existe na visão geral. */
export function availableSections(isOverview: boolean): ReportSectionKey[] {
  return REPORT_SECTIONS.filter((s) => isOverview || !("overviewOnly" in s)).map((s) => s.key);
}

type RGB = [number, number, number];
/** Cores do Conecta Design System (tema negócios); no navegador, lidas dos tokens da página. */
export interface Palette { brand: RGB; brandSubtle: RGB; institutional: RGB; ink: RGB; text: RGB; muted: RGB; page: RGB; surface: RGB; border: RGB; success: RGB; warning: RGB; danger: RGB; info: RGB; successSubtle: RGB; warningSubtle: RGB; dangerSubtle: RGB }

const hex = (value: string): RGB | null => {
  const m = value.trim().match(/^#([0-9a-f]{6})$/i);
  return m ? [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)] : null;
};
const DEFAULT_PALETTE: Palette = {
  brand: [116, 3, 1], brandSubtle: [247, 234, 234], institutional: [7, 48, 50], ink: [26, 26, 26], text: [77, 77, 77], muted: [102, 102, 102],
  page: [242, 242, 242], surface: [255, 255, 255], border: [229, 229, 229], success: [1, 101, 73], warning: [154, 91, 0], danger: [179, 38, 30],
  info: [15, 111, 168], successSubtle: [227, 242, 236], warningSubtle: [251, 240, 223], dangerSubtle: [251, 234, 233],
};
const TOKENS: Record<keyof Palette, string> = {
  brand: "brand", brandSubtle: "brand-subtle", institutional: "brand-institutional", ink: "content-primary", text: "content-secondary", muted: "content-muted",
  page: "background-page", surface: "background-surface", border: "border-subtle", success: "success", warning: "warning", danger: "danger", info: "info",
  successSubtle: "success-subtle", warningSubtle: "warning-subtle", dangerSubtle: "danger-subtle",
};
export function readPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const style = getComputedStyle(document.documentElement);
  const out = { ...DEFAULT_PALETTE };
  for (const key of Object.keys(TOKENS) as (keyof Palette)[]) out[key] = hex(style.getPropertyValue(`--conecta-color-${TOKENS[key]}`)) ?? DEFAULT_PALETTE[key];
  return out;
}

export interface ReportInput {
  projectName: string;
  periodLabel: string;
  isOverview: boolean;
  products: Partial<Record<Product, DashData>>;
  include: ReportSectionKey[];
  generatedAt: Date;
  logo?: Uint8Array | undefined;
  palette?: Palette;
}

// ---------- Dados de cada seção (puros, testáveis) ----------

const ready = (d: DashData, product: Product) => d.projects.some((p) => p.sources[product].executions.mode === "github");

export function summaryNumbers(d: DashData, product: Product) {
  const s = summarize(d.inPeriod);
  const flaky = d.specialByProduct.flaky;
  const flakyUnavailable = flaky.used.length > 0 && flaky.used.every((u) => u.fallback && u.reason);
  return {
    ready: ready(d, product),
    rate: s.rate,
    tests: testCount(d.valid, product),
    executions: d.inPeriod.length,
    failed: s.failed,
    flaky: flakyUnavailable ? null : new Set(flaky.rows.map((r) => `${r.dataSource}|${r.title}`)).size,
  };
}

export interface DayBar { date: string; executions: number; results: number; rate: number | null }
/** Um ponto por dia do período: resultados de testes, execuções do CI e taxa de sucesso do dia. */
export function dailyBars(d: DashData, now: Date): DayBar[] {
  const end = daysAgoISO(now, 0);
  const earliest = d.inPeriod.map((e) => e.date).sort()[0];
  const count = d.periodDays ?? (earliest ? Math.floor((Date.parse(end) - Date.parse(earliest)) / 86400000) + 1 : 1);
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const date = daysAgoISO(now, count - 1 - i);
    const runs = d.inPeriod.filter((e) => e.date === date);
    const s = summarize(runs);
    return { date, executions: runs.length, results: runs.reduce((sum, e) => sum + e.results.length, 0), rate: s.rate };
  });
}

export function natureCounts(d: DashData, product: Product) {
  const rows = d.nature.rows.filter((r) => r.product === product);
  return {
    total: rows.length,
    natures: NATURE_ORDER.map((nature) => ({ nature, count: rows.filter((r) => r.nature === nature).length })).filter((n) => n.count > 0),
    incidents: d.nature.incidents.filter((i) => i.product === product),
    groups: groupClassified(rows),
  };
}

export function rankingRows(products: Partial<Record<Product, DashData>>) {
  const base = products.api ?? products.ui;
  if (!base) return [];
  return base.projects.map((p) => {
    const by = (product: Product) => {
      const d = products[product];
      if (!d) return null;
      const runs = d.inPeriod.filter((e) => e.triggerId.startsWith(p.project.id));
      const s = summarize(runs);
      return { rate: s.rate, failed: s.failed, executions: runs.length };
    };
    return { project: p.project.name, api: by("api"), ui: by("ui") };
  });
}

// ---------- Desenho ----------

const W = 297, H = 210, M = 16, GAP = 8, TOP = 46, BOTTOM = 192;
const COL = (W - 2 * M - GAP) / 2;

export function drawReport(pdf: jsPDF, input: ReportInput) {
  const c = input.palette ?? DEFAULT_PALETTE;
  const products = (["api", "ui"] as const).filter((p) => input.products[p]);
  const clean = (v: unknown) => String(v ?? "—").replace(/[–—]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/…/g, "...").replace(/→/g, "->").replace(/[^\x20-\xFF\n]/g, "");
  const num = (n: number) => n.toLocaleString("pt-BR");
  const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const day = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
  const shortDay = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const rateColor = (r: number | null): RGB => (r == null ? c.muted : r >= 90 ? c.success : r >= 80 ? c.warning : c.danger);
  const natureColor: Record<FailureNature, RGB> = { product: c.danger, environment: c.warning, test_data: c.institutional, automation: c.info, investigate: c.muted };
  const font = (size: number, style: "normal" | "bold" = "normal", color: RGB = c.ink) => pdf.setFont("helvetica", style).setFontSize(size).setTextColor(...color);
  const fit = (text: string, width: number) => {
    let t = clean(text);
    if (pdf.getTextWidth(t) <= width) return t;
    while (t.length > 1 && pdf.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  const box = (x: number, y: number, w: number, h: number, fill: RGB = c.surface) => {
    pdf.setFillColor(...fill).setDrawColor(...c.border).setLineWidth(0.3).roundedRect(x, y, w, h, 3, 3, "FD");
  };

  // ----- Capa -----
  pdf.setFillColor(...c.institutional).rect(0, 0, W, H, "F");
  pdf.setFillColor(...c.brand).rect(0, 0, 10, H, "F");
  if (input.logo) {
    pdf.setFillColor(...c.surface).roundedRect(M + 6, 22, 92, 32, 4, 4, "F");
    pdf.addImage(input.logo, "PNG", M + 12, 26, 80, 24, undefined, "FAST");
  }
  font(14, "bold", [255, 255, 255]).text("RELATÓRIO DE QUALIDADE", M + 6, 82);
  font(38, "bold", [255, 255, 255]).text(fit(input.projectName, W - 2 * M - 10), M + 6, 100);
  font(16, "normal", [230, 230, 230]).text(clean(`${input.periodLabel} · Monitoramento de testes em HML`), M + 6, 113);
  font(12, "normal", [210, 210, 210]).text(clean(`Gerado em ${input.generatedAt.toLocaleString("pt-BR")}`), M + 6, 122);
  const included = REPORT_SECTIONS.filter((s) => input.include.includes(s.key));
  font(12, "bold", [255, 255, 255]).text("Neste relatório", M + 6, 145);
  included.forEach((s, i) => font(12, "normal", [230, 230, 230]).text(clean(`${i + 1}. ${s.label}`), M + 6 + Math.floor(i / 4) * 110, 154 + (i % 4) * 8));

  // ----- Páginas -----
  const page = (title: string, subtitle: string) => {
    pdf.addPage();
    pdf.setFillColor(...c.page).rect(0, 0, W, H, "F");
    pdf.setFillColor(...c.brand).rect(0, 0, W, 3, "F");
    font(10, "bold", c.brand).text(clean(`QUALIDADE · ${input.projectName}`.toUpperCase()), M, 15);
    font(24, "bold", c.ink).text(clean(title), M, 27);
    font(12, "normal", c.muted).text(clean(subtitle), M, 35);
    if (input.logo) pdf.addImage(input.logo, "PNG", W - M - 54, 9, 54, 16, undefined, "FAST");
  };
  /** Divide a página em uma coluna por produto (API e UI lado a lado). */
  const columns = (draw: (product: Product, d: DashData, x: number, width: number) => void) => {
    const width = products.length > 1 ? COL : W - 2 * M;
    products.forEach((product, i) => {
      const x = M + i * (COL + GAP);
      box(x, TOP, width, BOTTOM - TOP);
      pdf.setFillColor(...c.brandSubtle).roundedRect(x + 6, TOP + 6, 26, 10, 2, 2, "F");
      font(13, "bold", c.brand).text(product.toUpperCase(), x + 19, TOP + 13, { align: "center" });
      draw(product, input.products[product]!, x + 6, width - 12);
    });
  };
  /** Tabela com o texto da primeira coluna em até 2 linhas, para os nomes dos cenários caberem. */
  const table = (x: number, y: number, width: number, headers: { label: string; w: number; align?: "right" }[], rows: string[][], colors?: (RGB | null)[][], highlight?: (RGB | null)[]) => {
    font(10, "bold", c.muted);
    let cx = x;
    for (const h of headers) { pdf.text(clean(h.label), h.align ? cx + h.w : cx, y, h.align ? { align: "right" } : undefined); cx += h.w; }
    pdf.setDrawColor(...c.border).setLineWidth(0.3).line(x, y + 2.5, x + width, y + 2.5);
    let ry = y + 9;
    rows.forEach((row, r) => {
      font(10.5, "normal");
      const first = (pdf.splitTextToSize(clean(row[0] ?? ""), headers[0]!.w - 3) as string[]);
      const lines = first.length > 2 ? [first[0]!, fit(first.slice(1).join(" "), headers[0]!.w - 3)] : first;
      const rowH = lines.length > 1 ? 12 : 8;
      if (highlight?.[r]) pdf.setFillColor(...highlight[r]!).roundedRect(x - 2, ry - 5, width + 4, rowH, 1.5, 1.5, "F");
      cx = x;
      row.forEach((cell, i) => {
        const h = headers[i]!;
        font(10.5, h.align ? "bold" : "normal", colors?.[r]?.[i] ?? c.ink);
        if (i === 0) pdf.text(lines, cx, ry, { lineHeightFactor: 1.15 });
        else pdf.text(h.align ? clean(cell) : fit(cell, h.w - 3), h.align ? cx + h.w : cx, ry, h.align ? { align: "right" } : undefined);
        cx += h.w;
      });
      ry += rowH;
      pdf.setDrawColor(...c.border).setLineWidth(0.15).line(x, ry - 4.2, x + width, ry - 4.2);
    });
    return ry;
  };
  const empty = (x: number, y: number, text: string) => font(12, "normal", c.muted).text(clean(text), x, y);
  const MAX_ROWS = 9;
  const SHORT: Record<FailureNature, string> = { product: "Possível bug", environment: "Ambiente", test_data: "Massa de teste", automation: "Script", investigate: "A analisar" };

  for (const key of input.include) {
    if (key === "summary") {
      page("Resumo do período", `${input.periodLabel} · execuções agendadas, sem reruns`);
      columns((product, d, x, width) => {
        const n = summaryNumbers(d, product);
        if (!n.ready) { empty(x, TOP + 30, "Dados da fonte indisponíveis."); return; }
        const cards: { label: string; value: string; color: RGB; note?: string }[] = [
          { label: "Taxa de sucesso", value: pct(n.rate), color: rateColor(n.rate), note: "Meta: 90% ou mais" },
          { label: "Testes", value: num(n.tests), color: c.info },
          { label: "Execuções válidas", value: num(n.executions), color: c.ink, note: "Reruns ignorados" },
          { label: "Falhas definitivas", value: num(n.failed), color: n.failed ? c.danger : c.success },
          { label: "Flaky tests", value: n.flaky == null ? "—" : num(n.flaky), color: n.flaky ? c.warning : c.success, note: "Falharam em 3+ execuções" },
        ];
        const cw = (width - 6) / 2, ch = 37;
        cards.forEach((card, i) => {
          const cx = x + (i % 2) * (cw + 6), cy = TOP + 21 + Math.floor(i / 2) * (ch + 4);
          box(cx, cy, i === 4 ? width : cw, ch, c.page);
          font(32, "bold", card.color).text(clean(card.value), cx + 6, cy + 18);
          font(12, "bold", c.ink).text(clean(card.label), cx + 6, cy + 28);
          if (card.note) font(10, "normal", c.muted).text(clean(card.note), cx + 6, cy + 35);
        });
      });
    }

    if (key === "volume") {
      page("Volume diário de execuções", `${input.periodLabel} · cada barra é o total de testes executados no dia`);
      columns((_product, d, x, width) => {
        const bars = dailyBars(d, input.generatedAt);
        const chartTop = TOP + 26, chartH = 78, baseY = chartTop + chartH;
        const max = Math.max(1, ...bars.map((b) => b.results));
        const slot = width / bars.length, bw = Math.max(1.5, Math.min(9, slot * 0.7));
        pdf.setDrawColor(...c.border).setLineWidth(0.3).line(x, baseY, x + width, baseY);
        const every = Math.ceil(bars.length / 8);
        bars.forEach((b, i) => {
          const bx = x + i * slot + (slot - bw) / 2;
          if (b.results) {
            const h = Math.max(1.5, (b.results / max) * (chartH - 10));
            pdf.setFillColor(...rateColor(b.rate)).roundedRect(bx, baseY - h, bw, h, 0.8, 0.8, "F");
            if (bars.length <= 16) font(8, "bold", c.text).text(num(b.results), bx + bw / 2, baseY - h - 2, { align: "center" });
          }
          if (i % every === 0) font(9, "normal", c.muted).text(shortDay(b.date), bx + bw / 2, baseY + 6, { align: "center" });
        });
        const runs = bars.reduce((s, b) => s + b.executions, 0), results = bars.reduce((s, b) => s + b.results, 0);
        const bad = bars.filter((b) => b.rate != null && b.rate < 90);
        const y0 = baseY + 18;
        font(22, "bold", c.ink).text(num(runs), x, y0); font(11, "normal", c.muted).text("execuções do CI", x, y0 + 7);
        font(22, "bold", c.ink).text(num(results), x + width / 3, y0); font(11, "normal", c.muted).text("testes executados", x + width / 3, y0 + 7);
        font(22, "bold", bad.length ? c.danger : c.success).text(num(bad.length), x + (2 * width) / 3, y0); font(11, "normal", c.muted).text("dias abaixo de 90%", x + (2 * width) / 3, y0 + 7);
        if (bad.length) font(10, "normal", c.danger).text(fit(bad.map((b) => `${shortDay(b.date)} (${pct(b.rate)})`).join(", "), width / 3), x + (2 * width) / 3, y0 + 13);
        const legend: [RGB, string][] = [[c.success, ">= 90%"], [c.warning, "80% a < 90%"], [c.danger, "< 80%"]];
        legend.forEach(([color, label], i) => { const lx = x + width - 98 + i * 34; pdf.setFillColor(...color).circle(lx, BOTTOM - 7.5, 1.6, "F"); font(9.5, "normal", c.text).text(label, lx + 3, BOTTOM - 6.3); });
      });
    }

    if (key === "ranking" && input.isOverview) {
      page("Comparativo por projeto", `${input.periodLabel} · taxa de sucesso e falhas definitivas por frente`);
      box(M, TOP, W - 2 * M, BOTTOM - TOP);
      const rows = rankingRows(input.products);
      if (!rows.length) empty(M + 8, TOP + 20, "Nenhum projeto no período.");
      else {
        const headers = [{ label: "Projeto", w: 95 }, { label: "API · sucesso", w: 40, align: "right" as const }, { label: "API · falhas", w: 34, align: "right" as const }, { label: "UI · sucesso", w: 40, align: "right" as const }, { label: "UI · falhas", w: 34, align: "right" as const }];
        table(M + 8, TOP + 14, W - 2 * M - 16, headers,
          rows.map((r) => [r.project, r.api ? pct(r.api.rate) : "—", r.api ? num(r.api.failed) : "—", r.ui ? pct(r.ui.rate) : "—", r.ui ? num(r.ui.failed) : "—"]),
          rows.map((r) => [null, r.api ? rateColor(r.api.rate) : c.muted, r.api?.failed ? c.danger : null, r.ui ? rateColor(r.ui.rate) : c.muted, r.ui?.failed ? c.danger : null]));
      }
    }

    if (key === "nature") {
      page("Motivo das falhas e quem resolve", `${input.periodLabel} · cada falha definitiva está em um único motivo`);
      columns((product, d, x, width) => {
        const n = natureCounts(d, product);
        if (!n.total) { empty(x, TOP + 30, "Nenhuma falha definitiva no período."); return; }
        font(32, "bold", c.ink).text(num(n.total), x, TOP + 34);
        font(12, "normal", c.muted).text("falhas definitivas", x + pdf.setFontSize(32).getTextWidth(num(n.total)) + 4, TOP + 34);
        const max = Math.max(1, ...n.natures.map((v) => v.count));
        n.natures.forEach((v, i) => {
          const y = TOP + 50 + i * 21;
          font(12, "bold", c.ink).text(clean(NATURE_LABEL[v.nature]), x, y);
          font(10, "normal", c.muted).text(clean(`Quem resolve: ${NATURE_OWNER[v.nature]}`), x, y + 5.5);
          const barW = width - 30;
          pdf.setFillColor(...c.page).roundedRect(x, y + 8, barW, 5, 1.5, 1.5, "F");
          pdf.setFillColor(...natureColor[v.nature]).roundedRect(x, y + 8, Math.max(2, (v.count / max) * barW), 5, 1.5, 1.5, "F");
          font(18, "bold", natureColor[v.nature]).text(num(v.count), x + width, y + 13, { align: "right" });
        });
        if (n.incidents.length) {
          const y = BOTTOM - 16;
          pdf.setFillColor(...c.warningSubtle).roundedRect(x - 1, y - 6, width + 2, 12, 2, 2, "F");
          font(10.5, "normal", c.ink).text(fit(n.incidents.map((i) => `${day(i.date)}: ${num(i.failed)} de ${num(i.total)} testes falharam juntos (queda do ambiente)`).join(" · "), width - 4), x + 1, y + 1.5);
        }
      });
    }

    if (key === "details") {
      page("Detalhamento das falhas", `${input.periodLabel} · cenários com falha definitiva, do mais frequente para o menos`);
      columns((product, d, x, width) => {
        const n = natureCounts(d, product);
        const all = n.groups.slice().sort((a, b) => b.occurrences - a.occurrences);
        if (!all.length) { empty(x, TOP + 30, "Nenhuma falha definitiva no período."); return; }
        const onlyIncident = all.filter((g) => g.incidentOccurrences === g.occurrences);
        const others = all.filter((g) => g.incidentOccurrences < g.occurrences);
        const incidentRow = onlyIncident.length ? [[`Queda do ambiente em ${n.incidents.map((i) => day(i.date)).join(", ")}: ${num(onlyIncident.length)} cenários falharam juntos`, "Ambiente", num(onlyIncident.reduce((s, g) => s + g.occurrences, 0))]] : [];
        const room = MAX_ROWS - incidentRow.length;
        const shown = others.slice(0, room);
        const end = table(x, TOP + 26, width, [{ label: "Cenário", w: width - 58 }, { label: "Motivo", w: 36 }, { label: "Vezes", w: 22, align: "right" }],
          [...incidentRow, ...shown.map((g) => [g.title, SHORT[g.nature], num(g.occurrences)])],
          [...incidentRow.map(() => [null, c.warning, null]), ...shown.map((g) => [null, natureColor[g.nature], null])],
          [...incidentRow.map(() => c.warningSubtle), ...shown.map(() => null)]);
        if (others.length > room) font(10, "normal", c.muted).text(clean(`+ ${num(others.length - room)} cenários no dashboard`), x, end + 1);
      });
    }

    if (key === "flaky") {
      page("Flaky tests", `${input.periodLabel} · testes que falharam em 3 ou mais execuções, mesmo passando no retry`);
      columns((_product, d, x, width) => {
        const rows = d.specialByProduct.flaky.rows.slice().sort((a, b) => b.failureExecutions - a.failureExecutions);
        if (!rows.length) { empty(x, TOP + 30, "Nenhum flaky test no período."); return; }
        const shown = rows.slice(0, MAX_ROWS);
        const end = table(x, TOP + 26, width, [{ label: "Cenário", w: width - 54 }, { label: "Com falha", w: 27, align: "right" }, { label: "Sucesso", w: 27, align: "right" }],
          shown.map((r) => [r.title, `${num(r.failureExecutions)} de ${num(r.executions)}`, pct(r.successRate)]),
          shown.map((r) => [null, c.warning, rateColor(r.successRate)]));
        if (rows.length > MAX_ROWS) font(10, "normal", c.muted).text(clean(`+ ${num(rows.length - MAX_ROWS)} testes no dashboard`), x, end + 1);
      });
    }

    if (key === "history") {
      page("Histórico de falhas", `${input.periodLabel} · primeira e última ocorrência de cada falha`);
      columns((product, d, x, width) => {
        const rows = d.specialByProduct.lifecycle.rows.slice().sort((a, b) => b.occurrences - a.occurrences);
        if (!rows.length) { empty(x, TOP + 30, "Nenhuma falha registrada no período."); return; }
        const n = natureCounts(d, product);
        const incidentDays = new Set(n.incidents.map((i) => i.date));
        const incidentKeys = new Set(n.groups.filter((g) => g.incidentOccurrences === g.occurrences).map((g) => g.testKey));
        const isIncident = (r: (typeof rows)[number]) => Boolean(r.testKey && incidentKeys.has(r.testKey)) && r.occurrences === 1 && incidentDays.has(r.firstOccurrence.slice(0, 10));
        const collapsed = rows.filter(isIncident), others = rows.filter((r) => !isIncident(r));
        const incidentRow = collapsed.length ? [[`Queda do ambiente em ${[...incidentDays].map(day).join(", ")}: ${num(collapsed.length)} falhas no mesmo dia`, num(collapsed.length), shortDay([...incidentDays][0]!), shortDay([...incidentDays][0]!)]] : [];
        const room = MAX_ROWS - incidentRow.length;
        const shown = others.slice(0, room);
        const end = table(x, TOP + 26, width, [{ label: "Cenário", w: width - 62 }, { label: "Vezes", w: 18, align: "right" }, { label: "Primeira", w: 22, align: "right" }, { label: "Última", w: 22, align: "right" }],
          [...incidentRow, ...shown.map((r) => [r.title, num(r.occurrences), shortDay(r.firstOccurrence), shortDay(r.lastOccurrence)])],
          undefined, [...incidentRow.map(() => c.warningSubtle), ...shown.map(() => null)]);
        if (others.length > room) font(10, "normal", c.muted).text(clean(`+ ${num(others.length - room)} falhas no dashboard`), x, end + 1);
      });
    }
  }

  // ----- Rodapé -----
  const pages = pdf.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    pdf.setPage(i);
    font(9.5, "normal", c.muted).text(clean(`Quality Hub · ${input.projectName}`), M, H - 8);
    pdf.text(`${i - 1} / ${pages - 1}`, W - M, H - 8, { align: "right" });
  }
}

/** Gera e baixa o relatório no navegador. */
export async function exportReportPdf(input: Omit<ReportInput, "palette" | "logo">, filename: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const logo = await fetch("/quality-hub-conecta.png").then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : undefined)).catch(() => undefined);
  drawReport(pdf, { ...input, logo, palette: readPalette() });
  pdf.save(filename);
}
