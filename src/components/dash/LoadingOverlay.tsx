/**
 * Carregamento em tela cheia: fundo desfocado e a marca do Quality Hub no centro, com um anel girando.
 * Usado no primeiro carregamento das páginas e quando o usuário pede "Atualizar dados".
 */
export function LoadingOverlay({ message = "Carregando dados…" }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-background/55 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0">
      <div className="grid justify-items-center gap-4 rounded-2xl border border-border bg-card/90 px-10 py-8 text-card-foreground shadow-lg">
        <div className="relative grid h-24 w-24 place-items-center">
          <span aria-hidden className="absolute inset-0 rounded-full border-4 border-border" />
          <span aria-hidden className="absolute inset-0 rounded-full border-4 border-transparent border-t-[color:var(--conecta-color-brand-institutional)] border-r-[color:var(--conecta-color-brand)] motion-safe:animate-spin" />
          <img src="/quality-hub-favicon.png" alt="" className="h-14 w-14 object-contain motion-safe:animate-pulse" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">{message}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Buscando as informações mais recentes</p>
        </div>
      </div>
    </div>
  );
}
