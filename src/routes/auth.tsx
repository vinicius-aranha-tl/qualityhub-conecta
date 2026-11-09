import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { backend } from "@/lib/backend-client";
import { BrandLogo } from "@/components/dash/BrandLogo";
import { LoginArtwork } from "@/components/dash/LoginArtwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Quality Hub" },
      { name: "description", content: "Acesso restrito às métricas de automação de QA." },
      { property: "og:title", content: "Entrar — Quality Hub" },
      { property: "og:description", content: "Acesso restrito às métricas de automação de QA." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await backend.login(email, password);
      if (user.role === "admin") await backend.setup();
      navigate({ to: "/visao-geral", replace: true });
    } catch (err) {
      const message = (err as Error).message;
      setError(message.includes("(401)") ? "E-mail ou senha incorretos." : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center bg-background px-5 py-10 sm:px-8">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 lg:grid-cols-[1.12fr_0.88fr] lg:gap-14">
        <div className="min-w-0">
          <BrandLogo className="-ml-3 w-[min(100%,440px)]" />
          <p className="-mt-1 pl-2 text-sm text-muted-foreground sm:text-base">Monitoramento de qualidade</p>
          <div className="mt-8 hidden lg:block"><LoginArtwork /></div>
          <div className="mt-5 hidden items-center gap-2 pl-1 text-xs text-muted-foreground lg:flex"><LockKeyhole className="h-3.5 w-3.5" /> Uso interno</div>
        </div>
        <form onSubmit={submit} className="mx-auto grid w-full max-w-[460px] gap-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-md sm:p-9">
          <div className="mb-1"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Acessar plataforma</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Entre com suas credenciais corporativas.</p></div>
          <div className="grid gap-2"><Label htmlFor="email" className="text-card-foreground">E-mail corporativo</Label><div className="relative"><Mail aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="email" type="email" autoComplete="username" placeholder="nome@empresa.com" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 pl-10" /></div></div>
          <div className="grid gap-2"><Label htmlFor="password" className="text-card-foreground">Senha</Label><div className="relative"><LockKeyhole aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pl-10 pr-11" /><button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-subtle">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
          {error && <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} size="lg" className="mt-1 w-full justify-between px-5"><span className="w-4" aria-hidden="true" />{busy ? "Entrando…" : "Entrar"}<ArrowRight aria-hidden="true" /></Button>
          <div className="border-t border-border pt-4 text-center text-xs text-muted-foreground">Acesso restrito a usuários autorizados.</div>
        </form>
      </div>
    </main>
  );
}
