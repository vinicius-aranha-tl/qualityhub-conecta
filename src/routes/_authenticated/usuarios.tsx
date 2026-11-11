import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { backend } from "@/lib/backend-client";
import { useAuth } from "@/hooks/useAuth";
import { PageTitle, Panel, EmptyState } from "@/components/dash/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LoadingOverlay } from "@/components/dash/LoadingOverlay";

export const Route = createFileRoute("/_authenticated/usuarios")({ component: UsersPage });
type User = { id: string; email: string; role: "admin" | "editor" | "viewer" };
function UsersPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: backend.users, enabled: isAdmin });
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const del = useMutation({ mutationFn: backend.deleteUser, onSuccess: () => { toast.success("Usuário removido."); qc.invalidateQueries({ queryKey: ["users"] }); }, onError: e => toast.error(e.message) });
  if (loading) return null;
  if (!isAdmin) return <EmptyState>Apenas o administrador pode gerenciar usuários.</EmptyState>;
  return <><div className="flex flex-wrap items-start justify-between gap-4"><PageTitle title="Usuários" subtitle="Gerencie quem acessa a plataforma e o que cada pessoa pode fazer." /><Button onClick={() => setEditing("new")}>Adicionar usuário</Button></div>
    <Panel title="Acessos da plataforma"><p className="mb-4 text-sm text-muted-foreground">Administradores podem gerenciar projetos, gráficos e usuários. Usuários de visualização podem consultar os painéis e exportar relatórios.</p>
      {q.isLoading ? <LoadingOverlay message="Carregando usuários…" /> : q.isError ? <EmptyState>Não foi possível carregar os usuários.</EmptyState> : !q.data?.length ? <EmptyState>Nenhum usuário adicional cadastrado.</EmptyState> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-3">E-mail</th><th className="p-3">Perfil</th><th className="p-3">Ações</th></tr></thead><tbody>{q.data.map(u => <tr key={u.id} className="border-b border-border"><td className="p-3">{u.email}</td><td className="p-3">{u.role === "admin" ? "Administrador" : u.role === "editor" ? "Visualização (antigo editor)" : "Visualização"}</td><td className="flex gap-2 p-3"><Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Editar</Button><Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Remover acesso de ${u.email}?`)) del.mutate(u.id); }}>Remover</Button></td></tr>)}</tbody></table></div>}
    </Panel>{editing && <UserDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}</>;
}
function UserDialog({ initial, onClose }: { initial: User | null; onClose: () => void }) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">(initial?.role === "admin" ? "admin" : "viewer");
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: () => initial ? backend.updateUser(initial.id, role, password || undefined) : backend.createUser(email, password, role), onSuccess: () => { toast.success("Usuário salvo."); qc.invalidateQueries({ queryKey: ["users"] }); onClose(); }, onError: e => toast.error(e.message) });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{initial ? "Editar usuário" : "Adicionar usuário"}</DialogTitle></DialogHeader><form onSubmit={submit} className="grid gap-4"><div className="grid gap-2"><Label htmlFor="user-email">E-mail</Label><Input id="user-email" type="email" value={email} disabled={!!initial} onChange={e => setEmail(e.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="user-role">Perfil de acesso</Label><select id="user-role" className="h-10 rounded-md border border-input bg-background px-3 text-foreground" value={role} onChange={e => setRole(e.target.value as "admin" | "viewer")}><option value="viewer">Visualização</option><option value="admin">Administrador</option></select></div><div className="grid gap-2"><Label htmlFor="user-password">{initial ? "Nova senha (opcional)" : "Senha inicial"}</Label><Input id="user-password" type="password" autoComplete="new-password" minLength={8} required={!initial} value={password} onChange={e => setPassword(e.target.value)} /></div><DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={save.isPending}>Salvar</Button></DialogFooter></form></DialogContent></Dialog>;
}
