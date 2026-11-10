import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { backend, FRONTS_LABEL, frontProducts, projectInput, type ProjectFronts, type ProjectRecord } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageTitle, fmtDate } from "@/components/dash/primitives";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/projetos/")({
  head: () => ({
    meta: [
      { title: "Projetos — Quality Hub" },
      { name: "description", content: "Projetos integrados e suas fontes de dados do GitHub." },
      { property: "og:title", content: "Projetos — Quality Hub" },
      { property: "og:description", content: "Projetos integrados e suas fontes de dados do GitHub." },
    ],
  }),
  component: ProjectsPage,
});

export const projectsQuery = {
  queryKey: ["projects"],
  queryFn: async () => {
    return backend.projects();
  },
};

type Proj = ProjectRecord;

const FRONTS: { value: ProjectFronts; help: string }[] = [
  { value: "api-ui", help: "Tem back-end e telas: painéis de API e de UI." },
  { value: "api", help: "Só back-end (ex.: Visitas): só o painel de API." },
  { value: "ui", help: "Só front-end: só o painel de UI." },
];

/** Escolha das frentes testadas no projeto; define quais abas e fontes do GitHub ele tem. */
function FrontsField({ value, onChange }: { value: ProjectFronts; onChange: (v: ProjectFronts) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Frentes do projeto</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {FRONTS.map((f) => (
          <button key={f.value} type="button" role="radio" aria-checked={value === f.value} onClick={() => onChange(f.value)}
            className={`rounded-lg border p-3 text-left transition-colors ${value === f.value ? "border-primary bg-brand-subtle" : "border-border hover:bg-subtle"}`}>
            <span className="block text-sm font-semibold">{FRONTS_LABEL[f.value]}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{f.help}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function ProjectsPage() {
  const { canEdit: isAdmin } = useAuth();
  const q = useQuery(projectsQuery);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Proj | null>(null);
  const [deleting, setDeleting] = useState<Proj | null>(null);
  const count = (p: Proj) => frontProducts(p.fronts).filter((product) => (product === "api" ? p.api_repo_owner && p.api_repo_name : p.ui_repo_owner && p.ui_repo_name)).length;
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageTitle title="Projetos" subtitle="Cada projeto tem seus próprios painéis de API e UI e suas conexões com o GitHub." />
        {isAdmin && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo projeto</Button>}
      </div>
      {q.error ? <EmptyState><div className="grid justify-items-center gap-3"><span>Não foi possível carregar os projetos.</span><Button variant="outline" onClick={() => q.refetch()}>Tentar novamente</Button></div></EmptyState> : q.isLoading ? null : !q.data?.length ? (
        <EmptyState>Nenhum projeto ainda.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Link key={p.id} to="/projetos/$slug" params={{ slug: p.slug }} className="quality-surface group rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-brand">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-subtle text-brand"><FolderKanban className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display font-semibold group-hover:text-brand">{p.name}</div>
                  <div className="text-xs text-muted-foreground">Criado em {fmtDate(p.created_at.slice(0, 10))}</div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Editar projeto" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(p); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Excluir projeto" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleting(p); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                )}
              </div>
              {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="rounded-full bg-subtle px-2 py-0.5 font-medium">{FRONTS_LABEL[p.fronts]}</span><span className={count(p) === frontProducts(p.fronts).length ? "text-success" : "text-warning"}>{count(p)} de {frontProducts(p.fronts).length} {frontProducts(p.fronts).length === 1 ? "repositório configurado" : "repositórios configurados"}</span></div>
            </Link>
          ))}
        </div>
      )}
      {open && <NewProjectDialog onClose={() => setOpen(false)} />}
      {editing && <EditProjectDialog project={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fronts, setFronts] = useState<ProjectFronts>("api-ui");
  const m = useMutation({
    mutationFn: async () => {
      const slug = slugify(name);
      if (!slug) throw new Error("Informe um nome válido.");
      await backend.createProject({ name: name.trim(), slug, description: description.trim(), fronts });
      return slug;
    },
    onSuccess: (slug) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dataset"] });
      navigate({ to: "/projetos/$slug", params: { slug }, search: { tab: "fontes" } });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo projeto</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="pn">Nome</Label><Input id="pn" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="For Business" /></div>
          <div className="grid gap-2"><Label htmlFor="pd">Descrição</Label><Textarea id="pd" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></div>
          <FrontsField value={fronts} onChange={setFronts} />
          <p className="text-xs text-muted-foreground">Depois de criar, você conecta as fontes do GitHub {fronts === "api-ui" ? "de API e UI" : fronts === "api" ? "da API" : "da UI"}.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Criar projeto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({ project, onClose }: { project: Proj; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [fronts, setFronts] = useState<ProjectFronts>(project.fronts);
  const m = useMutation({
    mutationFn: async () => {
      const slug = slugify(name);
      if (!slug) throw new Error("Informe um nome válido.");
      await backend.updateProject(project.id, { ...projectInput(project), name: name.trim(), slug, description: description.trim(), fronts });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dataset"] });
      toast.success("Projeto atualizado.");
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar projeto</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="en">Nome</Label><Input id="en" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="ed">Descrição</Label><Textarea id="ed" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></div>
          <FrontsField value={fronts} onChange={setFronts} />
          {fronts !== project.fronts && fronts !== "api-ui" && <p className="text-xs text-warning">Ao salvar, a fonte do GitHub {fronts === "api" ? "da UI" : "da API"} deste projeto é removida e deixa de ser sincronizada.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({ project, onClose }: { project: Proj; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      await backend.deleteProject(project.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dataset"] });
      qc.invalidateQueries({ queryKey: ["widgets"] });
      toast.success("Projeto excluído.");
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Excluir projeto</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir <strong className="text-foreground">{project.name}</strong>? Os painéis e conexões desse projeto serão removidos. Essa ação não pode ser desfeita.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>Excluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
