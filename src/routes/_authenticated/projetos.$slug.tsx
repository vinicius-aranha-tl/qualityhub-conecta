import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CheckCircle2, PlugZap, Save, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { backend, projectInput, type ProjectRecord } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dashboard } from "@/components/dash/Dashboard";
import { EmptyState, Panel } from "@/components/dash/primitives";

import { useAuth } from "@/hooks/useAuth";
import { testRepo, type FileCheck } from "@/lib/sources.functions";

export const Route = createFileRoute("/_authenticated/projetos/$slug")({
  validateSearch: (s: Record<string, unknown>): { tab?: "painel" | "fontes" } => (s["tab"] === "fontes" ? { tab: "fontes" } : {}),
  head: () => ({
    meta: [
      { title: "Projeto — Quality Hub" },
      { name: "description", content: "Painéis de API e UI e fontes do GitHub do projeto." },
      { property: "og:title", content: "Projeto — Quality Hub" },
      { property: "og:description", content: "Painéis de API e UI e fontes do GitHub do projeto." },
    ],
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { slug } = Route.useParams();
  const { tab = "painel" } = Route.useSearch();
  const { isAdmin } = useAuth();
  const navigate = useNavigate({ from: Route.fullPath });
  const q = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      return backend.project(slug);
    },
  });
  if (q.isLoading) return null;
  if (q.error) return <EmptyState><div className="grid justify-items-center gap-3"><span>Não foi possível carregar o projeto.</span><Button variant="outline" onClick={() => q.refetch()}>Tentar novamente</Button></div></EmptyState>;
  if (!q.data) return <EmptyState>Projeto não encontrado. <Link to="/projetos" className="ml-1 text-primary underline">Voltar</Link></EmptyState>;
  const p = q.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{p.name}</h1>
          {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
        </div>
        {tab === "fontes" && isAdmin && <Button variant="outline" size="sm" onClick={() => navigate({ search: {} })}><ArrowLeft className="h-4 w-4" /> Voltar ao painel</Button>}
      </div>
      {tab === "fontes" && isAdmin ? <SourcesForm project={p} /> : <Dashboard projectId={p.id} slug={p.slug} name={p.name} onSources={isAdmin ? () => navigate({ search: { tab: "fontes" } }) : undefined} />}
    </>
  );
}


type Project = ProjectRecord;
type Prod = "api" | "ui";
interface RepoForm { owner: string; name: string; branch: string }

function SourcesForm({ project }: { project: Project }) {
  const { canEdit: isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const test = useServerFn(testRepo);
  const [repos, setRepos] = useState<Record<Prod, RepoForm>>({
    api: { owner: project.api_repo_owner ?? "", name: project.api_repo_name ?? "", branch: project.api_branch || "automation-metrics" },
    ui: { owner: project.ui_repo_owner ?? "", name: project.ui_repo_name ?? "", branch: project.ui_branch || "automation-metrics" },
  });
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [results, setResults] = useState<Partial<Record<Prod, { files: FileCheck[]; tokenConfigured: boolean; error: string | null }>>>({});
  const [testing, setTesting] = useState<Prod | null>(null);
  useEffect(() => setResults({}), [project.id]);
  const valid = /^[A-Za-z0-9_.-]{1,100}$/;

  const save = useMutation({
    mutationFn: async () => {
      for (const pr of ["api", "ui"] as const) {
        const r = repos[pr];
        if ((r.owner || r.name) && !(valid.test(r.owner.trim()) && valid.test(r.name.trim()))) throw new Error(`${pr.toUpperCase()}: informe organização e repositório válidos (sem espaços ou barras).`);
      }
      const v = (s: string) => s.trim() || null;
      await backend.updateProject(project.id, { ...projectInput(project),
        name: name.trim(), description: description.trim(),
        apiRepoOwner: v(repos.api.owner), apiRepoName: v(repos.api.name), apiBranch: repos.api.branch.trim() || "automation-metrics",
        uiRepoOwner: v(repos.ui.owner), uiRepoName: v(repos.ui.name), uiBranch: repos.ui.branch.trim() || "automation-metrics",
      });
    },
    onSuccess: () => {
      toast.success("Projeto salvo");
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dataset"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const del = useMutation({
    mutationFn: async () => {
      await backend.deleteProject(project.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dataset"] });
      navigate({ to: "/projetos" });
    },
  });

  async function runTest(pr: Prod) {
    const r = repos[pr];
    setTesting(pr);
    try {
      const out = await test({ data: { owner: r.owner.trim(), repo: r.name.trim(), branch: r.branch.trim() || "automation-metrics", product: pr } });
      setResults((s) => ({ ...s, [pr]: out }));
    } catch (e) {
      setResults((s) => ({ ...s, [pr]: { files: [], tokenConfigured: true, error: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  const configured = (pr: Prod) => Boolean(repos[pr].owner.trim() && repos[pr].name.trim());

  return (
    <div className="grid gap-4">
      <Panel title="Perfil do projeto">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="n">Nome</Label><Input id="n" disabled={!isAdmin} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="d">Descrição</Label><Input id="d" disabled={!isAdmin} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        {(project.last_synced_at || project.last_sync_error) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {project.last_synced_at && <>Última leitura do GitHub: {new Date(project.last_synced_at).toLocaleString("pt-BR")}. </>}
            {project.last_sync_error && <span className="text-danger">Último erro: {project.last_sync_error}</span>}
          </p>
        )}
      </Panel>
      {(["api", "ui"] as const).map((pr) => {
        const res = results[pr];
        return (
          <Panel key={pr} title={`Repositório de automação — ${pr.toUpperCase()}`} info="A plataforma lê os arquivos da pasta quality-hub/ na branch de métricas, pelo servidor, com um token de leitura. Se uma fonte não estiver configurada ou um arquivo não existir, o painel informa a indisponibilidade e não exibe dados de demonstração.">
            <div className="mb-3 flex items-center gap-2 text-xs">
              <span className={configured(pr) ? "rounded bg-success/15 px-2 py-0.5 text-success" : "rounded bg-warning/15 px-2 py-0.5 text-warning"}>{configured(pr) ? "Modo real (GitHub)" : "Fonte não configurada"}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_auto] md:items-end">
              <div className="grid gap-2"><Label htmlFor={`${pr}-o`}>Organização / dono</Label><Input id={`${pr}-o`} disabled={!isAdmin} placeholder="minha-org" value={repos[pr].owner} onChange={(e) => setRepos((s) => ({ ...s, [pr]: { ...s[pr], owner: e.target.value } }))} /></div>
              <div className="grid gap-2"><Label htmlFor={`${pr}-r`}>Repositório</Label><Input id={`${pr}-r`} disabled={!isAdmin} placeholder={`${pr}-automation-recomenda-test`} value={repos[pr].name} onChange={(e) => setRepos((s) => ({ ...s, [pr]: { ...s[pr], name: e.target.value } }))} /></div>
              <div className="grid gap-2"><Label htmlFor={`${pr}-b`}>Branch</Label><Input id={`${pr}-b`} disabled={!isAdmin} value={repos[pr].branch} onChange={(e) => setRepos((s) => ({ ...s, [pr]: { ...s[pr], branch: e.target.value } }))} /></div>
              <Button variant="secondary" disabled={!configured(pr) || testing === pr} onClick={() => runTest(pr)}><PlugZap className="h-4 w-4" /> {testing === pr ? "Testando…" : "Testar conexão"}</Button>
            </div>
            {res?.error && <p className="mt-3 text-xs text-danger">{res.error}</p>}
            {res && res.files.length > 0 && (
              <div className="mt-4 grid gap-1.5">
                {!res.tokenConfigured && <p className="text-xs text-warning">O token de leitura do GitHub ainda não foi configurado no servidor.</p>}
                {res.files.map((f) => (
                  <div key={f.file} className="flex items-start gap-2 text-xs">
                    {f.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                    <span className="font-mono">quality-hub/{f.file}</span>
                    <span className={f.ok ? "text-muted-foreground" : "text-danger"}>{f.ok ? `${f.records ?? "?"} registros${f.updatedAt ? ` · atualizado em ${new Date(f.updatedAt).toLocaleString("pt-BR")}` : ""}` : f.message}</span>
                    {f.ok && f.message && <span className="text-warning">{f.message}</span>}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
      {isAdmin && (
        <div className="flex flex-wrap justify-between gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" className="text-danger"><Trash2 className="h-4 w-4" /> Excluir projeto</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir {project.name}?</AlertDialogTitle>
                <AlertDialogDescription>Os painéis personalizados e as conexões deste projeto serão removidos. Os arquivos no GitHub não são afetados.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => del.mutate()}>Excluir</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Salvar projeto</Button>
        </div>
      )}
    </div>
  );
}
