# Quality Hub

Plataforma interna que centraliza as métricas de automação de testes (API e UI) de vários projetos.

## Arquitetura
- TanStack Start (React + TypeScript), Recharts, Tailwind.
- Backend .NET com autenticação de um administrador e MongoDB para projetos e configurações dos gráficos.
- `src/lib/metrics.ts` — regras de negócio puras (taxa de sucesso, dedup de reruns, flaky, cobertura, projeção).
- `src/lib/normalize.ts` — leitura e normalização dos arquivos `quality-hub/*.json`.
- `src/lib/sources.functions.ts` — leitura do GitHub no servidor (cache de 5 min). O token nunca vai ao navegador.

## Variáveis de ambiente (servidor)
- `GITHUB_TOKEN` — Fine-grained token, permissão Contents: Read-only somente nos repositórios de automação.
- `BACKEND_URL` — endereço interno do backend para as funções do servidor; por padrão `http://127.0.0.1:5080` no desenvolvimento.

## Rodar localmente
```
bun install
bun run dev
```
O backend deve estar em execução e o administrador deve estar configurado. Consulte `backend/README.md`.
Testes: `bunx vitest run`.

## Configurar o GitHub
1. Crie o token de leitura e salve como `GITHUB_TOKEN` nos segredos do projeto.
2. Em Projetos → projeto → Fontes do GitHub, informe organização, repositório e branch (padrão `automation-metrics`) de API e UI.
3. Use "Testar conexão" para ver o status de cada arquivo em `quality-hub/`.

Sem repositório configurado, o painel informa que a fonte está indisponível.

## Configurar o Azure DevOps (bugs)
1. No Azure DevOps, crie um Personal Access Token com escopo **Work Items: Read** na organização e salve como `AZURE_DEVOPS_PAT` nos segredos do projeto (localmente, em `.env.local`). Reinicie o servidor.
2. Em Bugs → "Configurar Azure DevOps" (administrador), informe organização, projeto, área raiz (cada subárea é uma squad) e o time do quadro. É uma configuração só para todos os projetos.
3. Clique em "Atualizar dados": o servidor lê o Azure e salva a leitura no MongoDB. Os demais usuários veem essa leitura.

## Adicionar uma nova fonte de métricas
1. Adicione o arquivo em `QUALITY_HUB_FILES` (`src/lib/normalize.ts`).
2. Crie um normalizador puro com teste em `normalize.test.ts`.
3. Use-o em `loadDashboardData` e exponha o dado nos widgets.
