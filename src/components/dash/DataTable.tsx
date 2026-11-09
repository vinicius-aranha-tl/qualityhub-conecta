import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "./primitives";

export interface Column<T> {
  key: keyof T & string;
  label: string;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  className?: string;
  width?: number;
}

export function DataTable<T extends Record<string, unknown>>({ rows, columns, initialSort, empty = "Nenhum registro.", detailView = false }: { rows: T[]; columns: Column<T>[]; initialSort?: { key: keyof T & string; dir: "asc" | "desc" }; empty?: string; detailView?: boolean }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<T | null>(null);
  const [sort, setSort] = useState(initialSort ?? null);
  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = term ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(term))) : rows;
    if (sort) {
      r = [...r].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, q, sort, columns]);

  const toggle = (key: keyof T & string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div className="min-w-0">
      <div className="relative mb-3 max-w-xs">
        <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Buscar na tabela" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="h-9 pl-8" />
      </div>
      {detailView && <p className="mb-2 text-xs text-muted-foreground">Clique no cenário ou no erro para ver as informações completas.</p>}
      {view.length === 0 ? (
        <EmptyState>{q ? "Nenhum resultado para a busca." : empty}</EmptyState>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-border">
          <table className={`w-full min-w-[700px] text-sm ${detailView ? "table-fixed" : ""}`} style={detailView ? { minWidth: columns.reduce((sum, c) => sum + (c.width ?? (c.numeric ? 150 : 250)), 0) } : undefined}>
            {detailView && <colgroup>{columns.map(c => <col key={c.key} style={{ width: c.width ?? (c.numeric ? 150 : 250) }} />)}</colgroup>}
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {columns.map((c) => {
                  const Icon = sort?.key === c.key ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                  <th key={c.key} scope="col" className={`sticky top-0 z-10 border-r border-border bg-subtle px-3 py-2 font-medium text-foreground last:border-r-0 ${c.numeric ? "text-right" : "text-left"}`}>
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                        {c.label}
                        <Icon className="h-3 w-3" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {view.map((row, i) => (
                <tr key={i} className="border-t border-border hover:bg-accent/40">
                  {columns.map((c) => (
                    <td key={c.key} className={`border-r border-border px-3 py-2 align-top last:border-r-0 ${c.numeric ? "text-right font-mono" : ""} ${c.className ?? ""}`}>
                      {detailView ? (c.key === "title" || c.key === "error" || c.key === "detail" ? <button type="button" onClick={() => setSelected(row)} className="block w-full truncate text-left underline-offset-4 hover:text-product hover:underline focus-visible:outline focus-visible:outline-2" title="Ver detalhes completos" aria-label={`Ver detalhes: ${String(row[c.key] || c.label)}`}>{c.render ? c.render(row) : String(row[c.key] || "—")}</button> : <span className="block truncate">{c.render ? c.render(row) : String(row[c.key] ?? "—")}</span>) : (c.render ? c.render(row) : String(row[c.key] ?? "—"))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailView && <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Detalhes do cenário</DialogTitle><DialogDescription>Informações completas do registro selecionado.</DialogDescription></DialogHeader>{selected && <dl className="grid gap-4">{columns.map(c => <div key={c.key}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{c.render ? c.render(selected) : String(selected[c.key] === "" ? "—" : selected[c.key] ?? "—")}</dd></div>)}</dl>}</DialogContent></Dialog>}
    </div>
  );
}
