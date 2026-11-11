import { describe, expect, it } from "vitest";
import { DEFAULT_WIDGETS, HIDDEN_WIDGETS, orderPanels } from "./widgets";

describe("painéis padrão", () => {
  it("mantém o modelo de API do Recomenda para API e UI", () => {
    expect(DEFAULT_WIDGETS.map(w => w.widget_type)).toEqual([
      "success_gauge", "summary_cards", "daily_execution_volume", "failure_nature", "failure_details",
      "flaky_table", "failure_history",
    ]);
  });

  it("o cruzamento de métricas e as falhas por causa ficam ocultos e fora do padrão", () => {
    expect(HIDDEN_WIDGETS).toEqual(expect.arrayContaining(["evolution", "cause_donut", "contract_coverage"]));
    expect(DEFAULT_WIDGETS.some(w => HIDDEN_WIDGETS.includes(w.widget_type))).toBe(false);
  });

  it("exibe na ordem padrão mesmo com a configuração salva em outra ordem", () => {
    const saved = ["failure_history", "evolution", "project_ranking", "cause_donut", "success_gauge", "daily_execution_volume", "failure_nature", "summary_cards", "contract_coverage", "failure_details", "flaky_table", "top_failures"]
      .map(widget_type => ({ widget_type }));
    expect(orderPanels(saved).map(w => w.widget_type)).toEqual([
      "success_gauge", "summary_cards", "daily_execution_volume", "project_ranking", "failure_nature", "failure_details",
      "flaky_table", "failure_history", "top_failures",
    ]);
  });
});
