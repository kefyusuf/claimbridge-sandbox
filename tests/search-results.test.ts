import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const ILAC_ARA = "medula.hastane.yardimci-islemler.ilac-ara";
const DOKTOR_ARA = "medula.hastane.yardimci-islemler.doktor-ara";
const SAGLIK_TESISI_ARA = "medula.hastane.yardimci-islemler.saglik-tesisi-ara";
const TAKIP_ARA = "medula.hastane.yardimci-islemler.takip-ara";

describe("search result rows (G58)", () => {
  it("returns a deterministic drug row echoing the requested barkod (s.287)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(ILAC_ARA, {
      barkod: "8699546010016",
      saglikTesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["ilaclar"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["barkod"]).toBe("8699546010016");
    expect(String(rows[0]?.["ilacAdi"])).toContain("SYNTHETIC");
  });

  it("returns a deterministic physician row echoing the queried tescilNo (s.285)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(DOKTOR_ARA, {
      drTescilNo: "SYNTHETIC_DR_001",
      saglikTesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["doktorlar"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["drTescilNo"]).toBe("SYNTHETIC_DR_001");
    expect(String(rows[0]?.["drAdi"])).toContain("SYNTHETIC");
  });

  it("returns a deterministic facility row echoing the queried code (s.284)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(SAGLIK_TESISI_ARA, {
      saglikTesisKodu: 1,
      tesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["tesisler"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tesisKodu"]).toBe(1);
    expect(String(rows[0]?.["tesisAdi"])).toContain("SYNTHETIC");
  });

  it("returns a sample tracking row for takip-ara (s.286)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(TAKIP_ARA, {
      hastaTCK: "10000000001",
      baslangicTarihi: "01.11.2026",
      bitisTarihi: "01.12.2026",
      sevkDurumu: "E",
      saglikTesisKodu: 1,
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["takipler"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["takipNo"])).toContain("SYNTHETIC");
    expect(rows[0]?.["takipTipi"]).toBe("N");
    expect(rows[0]?.["takipDurumu"]).toBe("0");
  });
});
