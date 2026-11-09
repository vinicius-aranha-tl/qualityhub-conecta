import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard } from "@/components/dash/primitives";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/bugs")({ component: BugsPage });
const examples = [{ semana: "Semana 1", abertos: 12, resolvidos: 4 }, { semana: "Semana 2", abertos: 16, resolvidos: 8 }, { semana: "Semana 3", abertos: 19, resolvidos: 12 }, { semana: "Semana 4", abertos: 24, resolvidos: 18 }];
function BugsPage() {
  const { canEdit, loading } = useAuth();
  if (loading) return null;
  if (!canEdit) return <p>Acesso disponível apenas para editores e administradores.</p>;
  return <><PageTitle title="Bugs" subtitle="Visão de acompanhamento de defeitos." /><div role="status" className="mb-5 rounded-lg border border-warning/30 bg-warning-subtle p-4 text-sm text-warning"><strong>Dados simulados.</strong> Os valores desta página são apenas exemplos e ainda não estão integrados a uma fonte de bugs.</div><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Bugs abertos" value="24" tone="warning" /><StatCard label="Bugs críticos" value="3" tone="danger" /><StatCard label="Resolvidos no período" value="18" tone="success" /></div><Panel title="Evolução dos bugs" className="mt-4" info="Exemplo visual de bugs abertos e resolvidos; os dados são simulados."><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={examples}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="semana" stroke="var(--muted-foreground)" /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Line dataKey="abertos" name="Abertos" stroke="var(--warning)" strokeWidth={2} /><Line dataKey="resolvidos" name="Resolvidos" stroke="var(--success)" strokeWidth={2} /></LineChart></ResponsiveContainer></div></Panel></>;
}
