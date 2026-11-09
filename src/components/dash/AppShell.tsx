import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { Bug, FolderKanban, LayoutDashboard, LogOut, Menu, RefreshCw, Users, X } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { backend } from "@/lib/backend-client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIOD_LABEL, requestForcedRefresh, useFilters, type PeriodKey } from "@/data/useDashboard";
import { cn } from "@/lib/utils";

export const APP_VERSION = "0.9.6";

const NAV = [
  { to: "/visao-geral", label: "Visão geral", icon: LayoutDashboard, admin: false },
  { to: "/projetos", label: "Projetos", icon: FolderKanban, admin: false },
  { to: "/bugs", label: "Bugs", icon: Bug, admin: false },
  { to: "/usuarios", label: "Usuários", icon: Users, admin: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { filters, setFilters } = useFilters();
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["dataset"] }) > 0;
  const lastUpdate = Math.max(0, ...qc.getQueryCache().findAll({ queryKey: ["dataset"] }).map((q) => q.state.dataUpdatedAt));
  const { user, isAdmin, canEdit } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await backend.logout();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-2 md:hidden">
        <BrandLogo className="w-40 invert hue-rotate-180" />
        <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={mobileMenuOpen} aria-controls="quality-navigation" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>
      <aside id="quality-navigation" className={cn("w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar px-4 pb-4 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:border-r md:border-b-0 md:px-4 md:py-6", mobileMenuOpen ? "flex" : "hidden")}>
        <BrandLogo className="mb-7 hidden w-full invert hue-rotate-180 md:block" />
        <nav aria-label="Navegação principal" className="flex flex-col gap-1">
          {NAV.filter((n) => (!n.admin || isAdmin) && (n.to !== "/bugs" || canEdit)).map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} onClick={() => setMobileMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent" activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" }}>
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-5 grid gap-2 border-t border-sidebar-border px-2 pt-4 md:mt-auto">
          {user && (
            <div className="flex min-w-0 items-center gap-3 text-xs">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#34373c] text-sm font-semibold text-white">{user.email.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0"><div className="truncate font-semibold text-sidebar-foreground">{user.email}</div>
              <div className="mt-1 text-sidebar-foreground/70">{user.role === "admin" ? "Administrador" : "Visualização"} · Uso interno</div></div>
            </div>
          )}
          <Button variant="ghost" size="sm" className="justify-start px-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={signOut}><LogOut className="h-4 w-4" /> Sair</Button>
          <div className="text-xs text-sidebar-foreground/70">v{APP_VERSION}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-10 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-4 sm:px-8 xl:px-10">
          <div className="mr-auto min-w-32">
            <div className="text-xs text-muted-foreground">Período selecionado</div>
            <div className="mt-1 text-sm font-semibold">{PERIOD_LABEL[filters.period]}</div>
          </div>
          <Select value={filters.period} onValueChange={(v) => setFilters({ ...filters, period: v as PeriodKey })}>
            <SelectTrigger className="h-9 w-44" aria-label="Período"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => <SelectItem key={k} value={k}>{PERIOD_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          {lastUpdate > 0 && <span className="text-xs text-muted-foreground">Última atualização: {new Date(lastUpdate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
          <Button size="sm" onClick={() => { requestForcedRefresh(); qc.invalidateQueries({ queryKey: ["dataset"] }); }} disabled={fetching}>
            <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} /> Atualizar dados
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1800px] min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
