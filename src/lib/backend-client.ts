/** Frentes testadas no projeto: API e UI, só API (back-end) ou só UI (front-end). */
export type ProjectFronts = "api-ui" | "api" | "ui";
export const FRONTS_LABEL: Record<ProjectFronts, string> = { "api-ui": "API e UI", api: "Só API (back-end)", ui: "Só UI (front-end)" };
/** Produtos (abas) de um projeto conforme as frentes. */
export const frontProducts = (fronts: ProjectFronts): ("api" | "ui")[] => (fronts === "api" ? ["api"] : fronts === "ui" ? ["ui"] : ["api", "ui"]);
export interface ProjectRecord {
  id: string; name: string; slug: string; description: string; fronts: ProjectFronts;
  api_repo_owner: string | null; api_repo_name: string | null; api_branch: string;
  ui_repo_owner: string | null; ui_repo_name: string | null; ui_branch: string;
  api_executions_url: string | null; api_evolution_url: string | null;
  ui_executions_url: string | null; ui_evolution_url: string | null;
  created_at: string; last_synced_at: string | null; last_sync_error: string | null;
}

export interface WidgetRecord { id: string; project_id: string | null; product: string; widget_type: string; title: string; width: "half" | "full"; position: number }
type BackendProject = { id: string; name: string; slug: string; description: string; fronts?: string | null; apiRepoOwner: string | null; apiRepoName: string | null; apiBranch: string; uiRepoOwner: string | null; uiRepoName: string | null; uiBranch: string; apiExecutionsUrl: string | null; apiEvolutionUrl: string | null; uiExecutionsUrl: string | null; uiEvolutionUrl: string | null; createdAt: string; lastSyncedAt: string | null; lastSyncError: string | null };
type BackendWidget = { id: string; projectId: string | null; product: string; widgetType: string; title: string; width: "half" | "full"; position: number };
export function mapProject(p: BackendProject): ProjectRecord {
  return { id: p.id, name: p.name, slug: p.slug, description: p.description, fronts: p.fronts === "api" || p.fronts === "ui" ? p.fronts : "api-ui", api_repo_owner: p.apiRepoOwner, api_repo_name: p.apiRepoName, api_branch: p.apiBranch, ui_repo_owner: p.uiRepoOwner, ui_repo_name: p.uiRepoName, ui_branch: p.uiBranch, api_executions_url: p.apiExecutionsUrl, api_evolution_url: p.apiEvolutionUrl, ui_executions_url: p.uiExecutionsUrl, ui_evolution_url: p.uiEvolutionUrl, created_at: p.createdAt, last_synced_at: p.lastSyncedAt, last_sync_error: p.lastSyncError };
}
function mapWidget(w: BackendWidget): WidgetRecord { return { id: w.id, project_id: w.projectId, product: w.product, widget_type: w.widgetType, title: w.title, width: w.width, position: w.position }; }
export function projectInput(p: ProjectRecord) { return { name: p.name, slug: p.slug, description: p.description, fronts: p.fronts, apiRepoOwner: p.api_repo_owner, apiRepoName: p.api_repo_name, apiBranch: p.api_branch, uiRepoOwner: p.ui_repo_owner, uiRepoName: p.ui_repo_name, uiBranch: p.ui_branch }; }
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) { const data = await response.json().catch(() => null) as { message?: string; title?: string } | null; throw new Error(data?.message ?? data?.title ?? `Erro ao comunicar com o servidor (${response.status}).`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const body = (value: unknown) => JSON.stringify(value);
export const backend = {
  login: (email: string, password: string) => request<{ email: string; role: "admin" | "editor" | "viewer" }>("/auth/login", { method: "POST", body: body({ email, password }) }),
  me: () => request<{ email: string; role: "admin" | "editor" | "viewer" }>("/auth/me"),
  users: () => request<{ id: string; email: string; role: "admin" | "editor" | "viewer" }[]>("/api/v1/users/"),
  createUser: (email: string, password: string, role: string) => request<void>("/api/v1/users/", { method: "POST", body: body({ email, password, role }) }),
  updateUser: (id: string, role: string, password?: string) => request<void>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "PUT", body: body({ role, password }) }),
  deleteUser: (id: string) => request<void>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  setup: () => request<void>("/api/v1/setup/recomenda", { method: "POST" }),
  projects: async () => (await request<BackendProject[]>("/api/v1/projects")).map(mapProject),
  project: async (slug: string) => mapProject(await request<BackendProject>(`/api/v1/projects/${encodeURIComponent(slug)}`)),
  createProject: (value: unknown) => request<BackendProject>("/api/v1/projects", { method: "POST", body: body(value) }),
  updateProject: (id: string, value: unknown) => request<BackendProject>(`/api/v1/projects/by-id/${encodeURIComponent(id)}`, { method: "PUT", body: body(value) }),
  deleteProject: (id: string) => request<void>(`/api/v1/projects/by-id/${encodeURIComponent(id)}`, { method: "DELETE" }),
  widgets: async (projectId: string | null, product: string) => (await request<BackendWidget[]>(`/api/v1/widgets?${new URLSearchParams({ product, ...(projectId ? { projectId } : {}) })}`)).map(mapWidget),
  createWidget: async (value: Omit<WidgetRecord, "id">) => mapWidget(await request<BackendWidget>("/api/v1/widgets", { method: "POST", body: body({ projectId: value.project_id, product: value.product, widgetType: value.widget_type, title: value.title, width: value.width, position: value.position }) })),
  updateWidget: async (value: WidgetRecord) => mapWidget(await request<BackendWidget>(`/api/v1/widgets/${encodeURIComponent(value.id)}`, { method: "PUT", body: body({ projectId: value.project_id, product: value.product, widgetType: value.widget_type, title: value.title, width: value.width, position: value.position }) })),
  deleteWidget: (id: string) => request<void>(`/api/v1/widgets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveAzureSettings: (value: { organization: string; project: string; rootArea: string; team: string }) => request<void>("/api/v1/settings/azure", { method: "PUT", body: body(value) }),
  deleteWidgets: (projectId: string | null, product: string) => request<void>(`/api/v1/widgets?${new URLSearchParams({ product, ...(projectId ? { projectId } : {}) })}`, { method: "DELETE" }),
};
