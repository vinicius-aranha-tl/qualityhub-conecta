import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Como é calculado" className="text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export function Panel({ title, info, children, className, action, pdfInfo }: { title: string; info?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; pdfInfo?: string }) {
  return (
    <section className={cn("quality-surface min-w-0 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6", className)} data-pdf-panel={pdfInfo === undefined ? undefined : ""} data-pdf-info={pdfInfo}>
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold leading-snug text-card-foreground">{title}</h2>
          {info && <Dialog><DialogTrigger asChild><button type="button" aria-label={`Informações: ${title}`} className="text-muted-foreground hover:text-card-foreground"><Info className="h-4 w-4" /></button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader><div className="grid gap-3 text-sm leading-relaxed">{info}</div></DialogContent></Dialog>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, info, tone, prominent = false }: { label: string; value: ReactNode; hint?: string; info?: ReactNode; tone?: "success" | "warning" | "danger" | "product" | "automation" | undefined; prominent?: boolean }) {
  const toneCls = { success: "text-success", warning: "text-warning", danger: "text-danger", product: "text-product", automation: "text-automation" };
  return (
    <div className="quality-surface min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div className={cn("mt-3 font-display font-semibold", prominent ? "text-4xl sm:text-5xl" : "text-3xl", tone ? toneCls[tone] : "text-card-foreground")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string | undefined }) {
  return (
    <div className="mb-6">
      <p className="mb-3 text-xs font-medium text-muted-foreground">Quality Hub <span aria-hidden="true" className="px-1">/</span> {title}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
    </div>
  );
}

export const fmtInt = (n: number) => n.toLocaleString("pt-BR");
export const fmtPct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
