import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBackendAuth } from "@/lib/backend-auth";
import { mapProject } from "@/lib/backend-client";
import type { BoardColumn, BugItem, ContractCoverage, EvolutionPoint, Execution, Product } from "@/lib/metrics";
import { CONTRACT_COVERAGE_FILE, countRecords, decodeGithubContent, EVOLUTION_FILE, EXECUTIONS_FILE, FormatError, LIFECYCLE_FILE, normalizeContractCoverage, normalizeDatedFailures, normalizeEvolution, normalizeExecutions, normalizeAzureWorkItems, normalizeLifecycle, normalizeReasons, normalizeStability, REASONS_FILE, QUALITY_HUB_FILES, STABILITY_FILE, TEST_HISTORY_FILE, type DatedFailureHistory, type ReasonRow, type SpecialFailureRow, type StabilityRow } from "@/lib/normalize";

export type SourceKind = "executions" | "evolution";
export interface SourceStatus {
  mode: "github" | "unavailable" | "error";
  url: string | null;
  message?: string;
  records?: number;
}

const ALLOWED_HOSTS = ["raw.githubusercontent.com", "api.github.com"];
const TTL = 5 * 60_000;
const CACHE_LIMIT = 500;
const cache = new Map<string, { at: number; value: unknown; legacy: boolean }>();
const nameRe = /^[A-Za-z0-9_.-]{1,100}$/;

function remember(url: string, value: unknown, legacy: boolean) {
  const now = Date.now();
  for (const [key, entry] of cache) if (now - entry.at >= TTL) cache.delete(key);
  // Map preserva a ordem de inserção: remove as entradas mais antigas ao atingir o limite.
  while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: now, value, legacy });
}

/** Fetches JSON from GitHub on the server with GITHUB_TOKEN (never sent to the browser). Cached 5 min. `legacy` = served from squaredup/. */
async function fetchGithubSource(url: string, force = false, raw = true): Promise<{ value: unknown; legacy: boolean }> {
  const hit = cache.get(url);
  if (!force && hit && Date.now() - hit.at < TTL) return { value: hit.value, legacy: hit.legacy };
  const u = new URL(url);
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`Host não permitido (${u.hostname}).`);
  const token = process.env["GITHUB_TOKEN"];
  const requestOptions = {
    headers: {
      // raw media type returns file bodies directly (works above the 1 MB base64 limit)
      Accept: raw && u.hostname === "api.github.com" ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "User-Agent": "dashboard-metrics-for-qa",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  let res = await fetch(u, requestOptions);
  let legacy = false;
  // Transição: consultar o diretório anterior apenas quando o novo arquivo ainda não existir.
  if (res.status === 404 && u.hostname === "api.github.com" && u.pathname.includes("/contents/quality-hub")) {
    const previous = new URL(u);
    previous.pathname = previous.pathname.replace(/\/contents\/quality-hub(?=\/|$)/, "/contents/squaredup");
    res = await fetch(previous, requestOptions);
    legacy = res.ok;
  }
  if (!res.ok) {
    const hint = res.status === 404 ? (token ? " — arquivo, branch ou repositório não encontrado (ou token sem acesso)." : " — repositório privado? Configure o GITHUB_TOKEN.") : res.status === 401 ? " — token inválido ou expirado." : res.status === 403 ? " — sem permissão ou limite de uso do GitHub." : "";
    throw new Error(`GitHub respondeu ${res.status}${hint}`);
  }
  const value = decodeGithubContent(await res.json());
  remember(url, value, legacy);
  return { value, legacy };
}

async function fetchGithub(url: string, force = false, raw = true): Promise<unknown> {
  return (await fetchGithubSource(url, force, raw)).value;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i] as T); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function contentsUrl(owner: string, repo: string, branch: string, file: string) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/quality-hub/${file}?ref=${encodeURIComponent(branch)}`;
}

async function readSource<T>(url: string | null, normalize: (raw: unknown) => T, force: boolean, count: (d: T) => number = (d) => (d as unknown[]).length, missingIsUnavailable = false) {
  if (!url) return { status: { mode: "unavailable", url: null, message: "Fonte não configurada." } as SourceStatus, data: null };
  try {
    const data = normalize(await fetchGithub(url, force));
    return { status: { mode: "github", url, records: count(data) } as SourceStatus, data };
  } catch (e) {
    const msg = e instanceof FormatError ? `Formato não reconhecido: ${e.message}` : (e as Error).message;
    if (missingIsUnavailable && msg.startsWith("GitHub respondeu 404")) {
      return { status: { mode: "unavailable", url, message: "Arquivo não encontrado ou repositório sem acesso (404)." } as SourceStatus, data: null };
    }
    return { status: { mode: "error", url, message: msg } as SourceStatus, data: null };
  }
}

function requireScheduledScope(raw: unknown): unknown {
  const scope = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)["scope"] : undefined;
  if (typeof scope !== "string" || !["scheduled-main", "lifetime-scheduled-main"].includes(scope)) throw new FormatError("O arquivo não comprova que contém apenas execuções agendadas.");
  return raw;
}

export interface ProjectData {
  project: { id: string; name: string; slug: string };
  sources: Record<Product, Record<SourceKind, SourceStatus>>;
  executions: Execution[];
  evolution: Record<Product, EvolutionPoint[]>;
/** Specialized files; null data = unavailable or failed → widgets fall back to history.json. */
  special: Record<Product, {
    stability: { status: SourceStatus; file: string; data: StabilityRow[] | null };
    reasons: { status: SourceStatus; file: string; data: { failures: SpecialFailureRow[]; reasons: ReasonRow[] } | null };
    lifecycle: { status: SourceStatus; file: string; data: SpecialFailureRow[] | null };
    testHistory?: { status: SourceStatus; file: string; data: DatedFailureHistory | null };
    /** Só API: contrato em produção (Swagger) e quais condições têm teste. */
    contract?: { status: SourceStatus; file: string; data: ContractCoverage | null };
  }>;
  fetchedAt: string;
  sourceFingerprint?: string;
  refreshError?: string;
}

/** Loads dashboard data for one project (by slug) or all projects. Never substitutes demonstration data for a real source. */
export const loadDashboardData = createServerFn({ method: "POST" })
  .middleware([requireBackendAuth])
  .validator((d: unknown) => z.object({ slug: z.string().nullable(), force: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const force = Boolean(data.force);
    const backendUrl = process.env["BACKEND_URL"] ?? "http://127.0.0.1:5080";
    const response = await fetch(`${backendUrl}/api/v1/projects`, { headers: { cookie: context.backendCookie } });
    if (!response.ok) throw new Error("Não foi possível carregar os projetos.");
    const projects = (await response.json() as Parameters<typeof mapProject>[0][]).map(mapProject).filter(p => !data.slug || p.slug === data.slug);
    // Sincroniza até 3 projetos ao mesmo tempo para não esperar um por um nem estourar o limite do GitHub.
    return mapLimit(projects, 3, async (p): Promise<ProjectData> => {
      const sourceKey = JSON.stringify(["dated-failures-v2", p.api_repo_owner, p.api_repo_name, p.api_branch, p.ui_repo_owner, p.ui_repo_name, p.ui_branch, p.api_executions_url, p.api_evolution_url, p.ui_executions_url, p.ui_evolution_url]);
      const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceKey)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const snapshotUrl = `${backendUrl}/api/v1/metric-snapshots/${encodeURIComponent(p.id)}`;
      const snapshotResponse = await fetch(snapshotUrl, { headers: { cookie: context.backendCookie } });
      if (!snapshotResponse.ok && snapshotResponse.status !== 404) throw new Error("Não foi possível consultar as métricas no MongoDB.");
      const saved = snapshotResponse.ok ? await snapshotResponse.json() as ProjectData : null;
      const cached = saved?.sourceFingerprint === fingerprint ? { ...saved, project: { id: p.id, name: p.name, slug: p.slug } } : null;
      const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < TTL;
      if (context.backendRole !== "admin") {
        if (!cached) throw new Error(`As métricas de ${p.name} ainda não foram sincronizadas. Peça a um administrador para atualizar os dados.`);
        return cached;
      }
      if (!force && fresh) return cached;
      const repo = {
        api: p.api_repo_owner && p.api_repo_name ? { owner: p.api_repo_owner, name: p.api_repo_name, branch: p.api_branch } : null,
        ui: p.ui_repo_owner && p.ui_repo_name ? { owner: p.ui_repo_owner, name: p.ui_repo_name, branch: p.ui_branch } : null,
      };
      const legacy = {
        api: { executions: p.api_executions_url, evolution: p.api_evolution_url },
        ui: { executions: p.ui_executions_url, evolution: p.ui_evolution_url },
      };
      const sources = {} as ProjectData["sources"];
      const executions: Execution[] = [];
      const evolution = {} as ProjectData["evolution"];
      const special = {} as ProjectData["special"];
      for (const product of ["api", "ui"] as const) {
        const r = repo[product];
        const evoFile = EVOLUTION_FILE[product];
        const exUrl = r ? contentsUrl(r.owner, r.name, r.branch, EXECUTIONS_FILE) : legacy[product].executions;
        const evUrl = r ? contentsUrl(r.owner, r.name, r.branch, evoFile) : legacy[product].evolution;
        const [ex, ev] = await Promise.all([
          readSource(exUrl, (raw) => normalizeExecutions(raw, product), force),
          readSource(evUrl, normalizeEvolution, force, undefined, true),
        ]);
        sources[product] = { executions: ex.status, evolution: ev.status };
        const exData = (ex.data ?? []).map((e) => ({ ...e, product, triggerId: `${p.id}-${e.triggerId}`, dataSource: `${p.name} · ${product.toUpperCase()}` }));
        executions.push(...exData);
        evolution[product] = ev.data ?? [];
        const ds = `${p.name} · ${product.toUpperCase()}`;
        const u = (f: string) => (r ? contentsUrl(r.owner, r.name, r.branch, f) : null);
        const [st, rs, lc, th, ct] = await Promise.all([
          readSource(u(STABILITY_FILE), (raw) => normalizeStability(raw, ds), force),
          readSource(u(REASONS_FILE), (raw) => normalizeReasons(requireScheduledScope(raw), ds), force, (d) => d.failures.length),
          readSource(u(LIFECYCLE_FILE), (raw) => normalizeLifecycle(requireScheduledScope(raw), ds), force),
          readSource(u(TEST_HISTORY_FILE), normalizeDatedFailures, force, d => d.failures.length, true),
          product === "api" ? readSource(u(CONTRACT_COVERAGE_FILE), normalizeContractCoverage, force, (d) => d.conditions.length, true) : Promise.resolve(null),
        ]);
        special[product] = {
          stability: { ...st, file: STABILITY_FILE },
          reasons: { ...rs, file: REASONS_FILE },
          lifecycle: { ...lc, file: LIFECYCLE_FILE },
          testHistory: { ...th, file: TEST_HISTORY_FILE },
          ...(ct ? { contract: { ...ct, file: CONTRACT_COVERAGE_FILE } } : {}),
        };
      }
      const failed = (["api", "ui"] as const).some(product => sources[product].executions.mode === "error" || sources[product].evolution.mode === "error");
      if (failed) {
        if (cached) return { ...cached, refreshError: "Não foi possível atualizar todos os dados no GitHub. Exibindo a última sincronização salva." };
        throw new Error(`Não foi possível sincronizar as métricas de ${p.name} no GitHub.`);
      }
      const dataset: ProjectData = { project: { id: p.id, name: p.name, slug: p.slug }, sources, executions, evolution, special, fetchedAt: new Date().toISOString(), sourceFingerprint: fingerprint };
      const persisted = await fetch(snapshotUrl, { method: "PUT", headers: { cookie: context.backendCookie, "Content-Type": "application/json" }, body: JSON.stringify(dataset) });
      if (!persisted.ok) throw new Error(`Não foi possível salvar as métricas de ${p.name} no MongoDB.`);
      const stored = await fetch(snapshotUrl, { headers: { cookie: context.backendCookie } });
      if (!stored.ok) throw new Error(`Não foi possível ler as métricas salvas de ${p.name}.`);
      return await stored.json() as ProjectData;
    });
  });

export interface FileCheck { file: string; ok: boolean; records: number | null; updatedAt: string | null; expected: boolean; message?: string }

/** Lists every file in quality-hub/ and reads each one, reporting status, records and updatedAt. */
export const testRepo = createServerFn({ method: "POST" })
  .middleware([requireBackendAuth])
  .validator((d: unknown) => z.object({
    owner: z.string().regex(nameRe), repo: z.string().regex(nameRe), branch: z.string().min(1).max(100).regex(/^[A-Za-z0-9_./-]+$/), product: z.enum(["api", "ui"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (context.backendRole !== "admin") throw new Error("Acesso restrito a administradores.");
    const tokenConfigured = Boolean(process.env["GITHUB_TOKEN"]);
    const dirUrl = `https://api.github.com/repos/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repo)}/contents/quality-hub?ref=${encodeURIComponent(data.branch)}`;
    let names: string[];
    try {
      const dir = await fetchGithub(dirUrl, true, false);
      if (!Array.isArray(dir)) throw new Error("quality-hub/ não é uma pasta");
      names = dir.filter((f) => f && f.type === "file" && String(f.name).endsWith(".json")).map((f) => String(f.name));
    } catch (e) {
      return { files: [] as FileCheck[], tokenConfigured, error: `Não foi possível listar quality-hub/: ${(e as Error).message}` };
    }
    const expected = QUALITY_HUB_FILES[data.product];
    const all = [...new Set([...expected, ...names])];
    const files: FileCheck[] = await Promise.all(all.map(async (file) => {
      const isExpected = expected.includes(file);
      try {
        const { value: raw, legacy } = await fetchGithubSource(contentsUrl(data.owner, data.repo, data.branch, file), true);
        let records = countRecords(raw);
        if (file === EXECUTIONS_FILE) records = normalizeExecutions(raw, data.product).length;
        if (file === EVOLUTION_FILE[data.product]) records = normalizeEvolution(raw).length;
        const up = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)["updatedAt"] : null;
        return { file, ok: true, records, updatedAt: typeof up === "string" ? up : null, expected: isExpected, ...(legacy ? { message: "Lido da pasta antiga squaredup/ — publique em quality-hub/." } : {}) };
      } catch (e) {
        const msg = e instanceof FormatError ? `Formato não reconhecido: ${e.message}` : (e as Error).message;
        return { file, ok: false, records: null, updatedAt: null, expected: isExpected, message: msg };
      }
    }));
    return { files, tokenConfigured, error: null as string | null };
  });

// ---------- Azure DevOps (bugs) ----------
//
// Uma configuração para todos os projetos (organização, projeto, área raiz e time do quadro), salva no
// backend. O PAT (AZURE_DEVOPS_PAT, leitura de Work Items) fica só no servidor. Administradores leem o
// Azure e salvam a captura no MongoDB; os demais usuários leem só a captura salva.

export interface AzureSettings { organization: string; project: string; rootArea: string; team: string }
export interface BugDataset {
  settingsKey: string;
  items: BugItem[];
  columns: BoardColumn[];
  boardName: string | null;
  fetchedAt: string;
  refreshError?: string;
}
export interface BugsResult { settings: AzureSettings | null; dataset: BugDataset | null; tokenConfigured: boolean; message?: string }

/** Escapa um valor para dentro de aspas simples na WIQL. */
export function wiqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Consultas iguais às do "Dash QA": bugs e defeitos (Tasks com a tag DEFEITO) na área; PBIs para a proporção e o quadro. */
export function bugQueries(project: string, rootArea: string): Record<"bug" | "defeito" | "pbi", string> {
  const base = `[System.TeamProject] = ${wiqlString(project)} AND [System.AreaPath] UNDER ${wiqlString(rootArea)}`;
  const select = "SELECT [System.Id] FROM WorkItems WHERE";
  return {
    bug: `${select} ${base} AND [System.WorkItemType] = 'Bug' ORDER BY [System.Id]`,
    defeito: `${select} ${base} AND [System.WorkItemType] = 'Task' AND [System.Tags] CONTAINS 'DEFEITO' ORDER BY [System.Id]`,
    pbi: `${select} ${base} AND [System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory' ORDER BY [System.Id]`,
  };
}

/** Escolhe o quadro de requisitos (Backlog items / Stories / Requirements); sem nenhum deles, o último da lista. */
export function pickBoard(boards: { name: string; url: string }[]): { name: string; url: string } | null {
  const preferred = ["backlog items", "stories", "requirements", "issues"];
  return boards.find((b) => preferred.includes(b.name.toLowerCase())) ?? boards[boards.length - 1] ?? null;
}

const settingsKey = (s: AzureSettings) => JSON.stringify(["azure-v1", s.organization, s.project, s.rootArea, s.team]);

async function readAzure(settings: AzureSettings): Promise<Omit<BugDataset, "settingsKey" | "fetchedAt">> {
  const pat = process.env["AZURE_DEVOPS_PAT"];
  if (!pat) throw new Error("O token do Azure DevOps (AZURE_DEVOPS_PAT) não está configurado no servidor.");
  const org = encodeURIComponent(settings.organization);
  const project = encodeURIComponent(settings.project);
  const team = encodeURIComponent(settings.team);
  const root = `https://dev.azure.com/${org}`;
  const headers = { Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" };
  const call = async <T>(url: string, body?: unknown): Promise<T> => {
    if (new URL(url).host !== "dev.azure.com") throw new Error("Endereço do Azure DevOps não permitido.");
    const res = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? null : JSON.stringify(body), redirect: "manual" });
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400)) throw new Error("O Azure DevOps recusou o token (AZURE_DEVOPS_PAT). Verifique se ele vale para a organização e tem leitura de Work Items.");
    if (res.status === 404) throw new Error("Organização, projeto ou time não encontrado no Azure DevOps. Confira a configuração.");
    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { message?: string } | null;
      throw new Error(`Azure DevOps respondeu ${res.status}${detail?.message ? `: ${detail.message.slice(0, 200)}` : ""}.`);
    }
    return res.json() as Promise<T>;
  };

  // Quadro do time: colunas (com WIP) e o campo que guarda a coluna de cada item.
  const boards = await call<{ value: { name: string; url: string }[] }>(`${root}/${project}/${team}/_apis/work/boards?api-version=7.1`);
  const chosen = pickBoard(boards.value ?? []);
  let columns: BoardColumn[] = [];
  let columnField = "System.BoardColumn";
  if (chosen) {
    const board = await call<{ columns?: { name: string; itemLimit?: number; columnType?: string }[]; fields?: { columnField?: { referenceName?: string } } }>(`${root}/${project}/${team}/_apis/work/boards/${encodeURIComponent(chosen.name)}?api-version=7.1`);
    columns = (board.columns ?? []).map((c) => ({ name: c.name, wip: c.columnType === "inProgress" && c.itemLimit ? c.itemLimit : null, done: c.columnType === "outgoing" }));
    columnField = board.fields?.columnField?.referenceName ?? columnField;
  }

  const queries = bugQueries(settings.project, settings.rootArea);
  const ids = await Promise.all((["bug", "defeito", "pbi"] as const).map(async (kind) => {
    const r = await call<{ workItems?: { id: number }[] }>(`${root}/${project}/_apis/wit/wiql?api-version=7.1`, { query: queries[kind] });
    return (r.workItems ?? []).map((w) => w.id);
  }));
  const all = [...new Set(ids.flat())];
  const fields = ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.CreatedDate", "Microsoft.VSTS.Common.ClosedDate", "Microsoft.VSTS.Common.StateChangeDate", "Microsoft.VSTS.Common.Priority", "Microsoft.VSTS.Common.Severity", "System.AssignedTo", "System.IterationPath", "System.AreaPath", columnField];
  const chunks: number[][] = [];
  for (let i = 0; i < all.length; i += 200) chunks.push(all.slice(i, i + 200));
  const batches = await mapLimit(chunks, 3, (chunk) => call<{ value: unknown[] }>(`${root}/${project}/_apis/wit/workitemsbatch?api-version=7.1`, { ids: chunk, fields: [...new Set(fields)], errorPolicy: "omit" }));
  const raw = { value: batches.flatMap((b) => (b.value ?? []).filter(Boolean)) };

  // Categoria de cada estado, por tipo de item.
  const types = [...new Set(raw.value.map((v) => ((v as { fields?: Record<string, unknown> }).fields?.["System.WorkItemType"])).filter((t): t is string => typeof t === "string"))];
  const categories: Record<string, Record<string, string>> = {};
  await Promise.all(types.map(async (type) => {
    const states = await call<{ value: { name: string; category: string }[] }>(`${root}/${project}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`);
    categories[type] = Object.fromEntries((states.value ?? []).map((s) => [s.name, s.category]));
  }));

  const items = normalizeAzureWorkItems(raw, { categories, webBase: `${root}/${project}`, rootArea: settings.rootArea, columnField });
  return { items, columns, boardName: chosen?.name ?? null };
}

/** Bugs do Azure DevOps para a aba Bugs e a visão geral. `force` relê o Azure (só administradores). */
export const loadBugs = createServerFn({ method: "POST" })
  .middleware([requireBackendAuth])
  .validator((d: unknown) => z.object({ force: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }): Promise<BugsResult> => {
    const backendUrl = process.env["BACKEND_URL"] ?? "http://127.0.0.1:5080";
    const get = (path: string) => fetch(`${backendUrl}/api/v1${path}`, { headers: { cookie: context.backendCookie } });
    const tokenConfigured = Boolean(process.env["AZURE_DEVOPS_PAT"]);
    const settingsRes = await get("/settings/azure");
    if (settingsRes.status === 404) return { settings: null, dataset: null, tokenConfigured };
    if (!settingsRes.ok) throw new Error("Não foi possível ler a configuração do Azure DevOps.");
    const settings = await settingsRes.json() as AzureSettings;
    const snapRes = await get("/bug-snapshot");
    if (!snapRes.ok && snapRes.status !== 404) throw new Error("Não foi possível consultar os bugs salvos no MongoDB.");
    const saved = snapRes.ok ? await snapRes.json() as BugDataset : null;
    const cached = saved?.settingsKey === settingsKey(settings) ? saved : null;
    if (context.backendRole !== "admin") {
      return cached ? { settings, dataset: cached, tokenConfigured } : { settings, dataset: null, tokenConfigured, message: "Os bugs ainda não foram sincronizados com o Azure DevOps. Peça a um administrador para atualizar os dados." };
    }
    if (!data.force && cached && Date.now() - Date.parse(cached.fetchedAt) < TTL) return { settings, dataset: cached, tokenConfigured };
    // Sem token, a tela já avisa (tokenConfigured); mostra a última leitura salva, se houver.
    if (!tokenConfigured) return { settings, dataset: cached, tokenConfigured };
    let read: Awaited<ReturnType<typeof readAzure>>;
    try {
      read = await readAzure(settings);
    } catch (e) {
      const message = (e as Error).message;
      return cached ? { settings, dataset: { ...cached, refreshError: `${message} Exibindo a última leitura salva.` }, tokenConfigured } : { settings, dataset: null, tokenConfigured, message };
    }
    const dataset: BugDataset = { settingsKey: settingsKey(settings), ...read, fetchedAt: new Date().toISOString() };
    const put = await fetch(`${backendUrl}/api/v1/bug-snapshot`, { method: "PUT", headers: { cookie: context.backendCookie, "Content-Type": "application/json" }, body: JSON.stringify(dataset) });
    if (!put.ok) return { settings, dataset: { ...dataset, refreshError: "Não foi possível salvar a leitura do Azure DevOps no MongoDB." }, tokenConfigured };
    return { settings, dataset, tokenConfigured };
  });
