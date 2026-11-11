import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { availableSections, REPORT_SECTIONS, type ReportSectionKey } from "@/lib/reportPdf";

const STORAGE_KEY = "quality-hub:relatorio:secoes";

/** Seções escolhidas da última vez (por navegador); sem registro, todas as disponíveis. */
function rememberedSections(available: ReportSectionKey[]): ReportSectionKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(saved)) {
      const chosen = available.filter((key) => saved.includes(key));
      if (chosen.length) return chosen;
    }
  } catch { /* armazenamento indisponível: usa o padrão */ }
  return available;
}

/** Escolha das seções do relatório em PDF. API e UI de cada assunto saem lado a lado na mesma página. */
export function ReportDialog({ isOverview, products, generating, onClose, onGenerate }: {
  isOverview: boolean;
  products: string[];
  generating: boolean;
  onClose: () => void;
  onGenerate: (sections: ReportSectionKey[]) => void;
}) {
  const available = availableSections(isOverview);
  const [selected, setSelected] = useState<ReportSectionKey[]>(() => rememberedSections(available));
  const toggle = (key: ReportSectionKey, on: boolean) => setSelected((current) => available.filter((k) => (k === key ? on : current.includes(k))));
  const generate = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selected)); } catch { /* sem armazenamento: segue sem lembrar */ }
    onGenerate(selected);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar relatório</DialogTitle>
          <DialogDescription>
            Escolha o que entra no PDF. Cada assunto ocupa uma página, com {products.length > 1 ? "API e UI lado a lado" : products[0]?.toUpperCase()} e o período selecionado no topo da tela.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <div className="mb-1 flex gap-3 text-sm">
            <button type="button" className="font-semibold text-[color:var(--conecta-color-brand-content)] hover:underline" onClick={() => setSelected(available)}>Marcar todos</button>
            <button type="button" className="font-semibold text-[color:var(--conecta-color-brand-content)] hover:underline" onClick={() => setSelected([])}>Desmarcar todos</button>
          </div>
          {REPORT_SECTIONS.filter((section) => available.includes(section.key)).map((section) => (
            <Label key={section.key} htmlFor={`secao-${section.key}`} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-sm font-normal hover:bg-subtle">
              <Checkbox id={`secao-${section.key}`} checked={selected.includes(section.key)} onCheckedChange={(checked) => toggle(section.key, checked === true)} />
              {section.label}
            </Label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!selected.length || generating} onClick={generate}><FileDown aria-hidden /> {generating ? "Gerando…" : `Gerar PDF (${selected.length} ${selected.length === 1 ? "seção" : "seções"})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
