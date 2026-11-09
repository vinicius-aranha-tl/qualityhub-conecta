import { describe, expect, it } from "vitest";
import { mapLimit } from "@/lib/sources.functions";

describe("mapLimit", () => {
  it("preserves order and never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([30, 10, 20, 5, 15], 2, async (ms) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active--;
      return ms * 2;
    });
    expect(result).toEqual([60, 20, 40, 10, 30]);
    expect(peak).toBe(2);
  });

  it("returns an empty list without calling fn", async () => {
    expect(await mapLimit([], 3, async () => { throw new Error("não deveria rodar"); })).toEqual([]);
  });
});
