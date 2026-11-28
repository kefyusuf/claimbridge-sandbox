import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const BASVURU_OKU =
  "medula.hastane.hasta-kabul.basvuru-altindaki-takipleri-oku";
const YATIS_OKU = "medula.hastane.hasta-kabul.hasta-yatis-oku";
const KEMIK_SORGU = "medula.hastane.hasta-kabul.kemik-iligi-tc-ile-sorgu";
const YESIL_KART = "medula.hastane.hasta-kabul.get-yesil-kartli-sevkli-hasta";
const FATURA_OKU = "medula.hastane.fatura-kayit.fatura-oku";

describe("query result rows (G60)", () => {
  it("returns the takip list for a basvuru read (s.163)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(BASVURU_OKU, {
      hastaBasvuruNo: "SYNTHETIC_BASVURU_000001",
      saglikTesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["basvuruTakip"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["takipNo"])).toContain("SYNTHETIC");
    expect(rows[0]?.["takipFaturaDurumu"]).toBe("0");
  });

  it("returns the hospitalization rows for a yatis read (s.171)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(YATIS_OKU, {
      hastaBasvuruNo: "SYNTHETIC_BASVURU_000001",
      saglikTesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["basvuruYatisBilgileri"] as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["durum"]).toBe("0");
    expect(String(rows[0]?.["baslangicTarihi"])).toBeTruthy();
  });

  it("returns the bone-marrow admission rows for a TC query (s.187)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(KEMIK_SORGU, {
      tcNo: "10000000001",
      tesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["kemikIligiCevapDVO"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["hastaTcNo"]).toBe("10000000001");
    expect(rows[0]?.["bildirimNo"]).toBeTruthy();
  });

  it("returns the referral rows for the green-card query (s.176)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(YESIL_KART, {
      hastaTCKNo: "10000000001",
      tesisKodu: 1,
    });
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["yesilKartliHastaSevkBilgileriDVO"] as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["sevkEdilenBransKodu"]).toBeTruthy();
    expect(String(rows[0]?.["takipNo"])).toContain("SYNTHETIC");
  });

  it("echoes delivery numbers and one invoice detail row for fatura-oku (s.245)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    // Full claim chain: the invoice read requires a stored invoiceRecord,
    // which requires a service record, which requires the admission.
    const admission = sandbox.call("medula.hastane.hasta-kabul.hasta-kabul", {
      saglikTesisKodu: 1,
      hastaTCKimlikNo: "SYNTHETIC_TC_000000001",
      sigortaliTuru: "1",
      devredilenKurum: "1",
      provizyonTarihi: "2026-11-28",
      provizyonTipi: "N",
      tedaviTuru: "A",
      tedaviTipi: "0",
      takipTipi: "N",
      bransKodu: "1",
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    });
    expect(admission["sonucKodu"]).toBe("0000");
    const hizmet = sandbox.call("medula.hastane.hizmet-kayit.hizmet-kayit", {
      saglikTesisKodu: 1,
      takipNo: admission["takipNo"],
      hastaBasvuruNo: admission["hastaBasvuruNo"],
      tanilar: [{ taniKodu: "J06.9", taniTipi: "1" }],
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    });
    expect(hizmet["sonucKodu"]).toBe("0000");
    const kayit = sandbox.call("medula.hastane.fatura-kayit.fatura-kayit", {
      saglikTesisKodu: 1,
      faturaTarihi: "2026-11-28",
      hastaBasvuruNo: admission["hastaBasvuruNo"],
      faturaRefNo: "SYNTHETIC_FATURA_REF_E2E",
      hizmetDetaylari: [],
      trafikKazasiOdemeYuzdesi: 0,
      ilaveUcret: 0,
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
      muvafakatVar: "E",
    });
    expect(kayit["sonucKodu"]).toBe("0000");

    const result = sandbox.call(FATURA_OKU, {
      saglikTesisKodu: 1,
      faturaTeslimNo: kayit["faturaTeslimNo"],
      faturaRefNo: "SYNTHETIC_FATURA_REF_E2E",
      faturaTarihi: "2026-11-28",
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    });
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["faturaTeslimNo"]).toEqual([kayit["faturaTeslimNo"]]);
    const rows = result["faturaDetaylari"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["takipNo"])).toContain("SYNTHETIC");
  });
});
