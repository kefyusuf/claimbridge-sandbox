import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const DIS_TAAHHUT_KAYDET = "medula.hastane.taahhut.dis-taahhut-kaydet";
const TAKIP_ARA = "medula.hastane.yardimci-islemler.takip-ara";

/** Full TaahhutKayitDVO payload with a single dental-commitment entry. */
function taahhutRequest(
  sutKodu: string,
  extraDiss: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    takipNo: "SYNTHETIC_TAKIPNO_000001",
    taahhut: {
      hastaTCKimlikNo: "10000000001",
      adressIlPlaka: 34,
      adressIlce: "Kadikoy",
      adressPostaKodu: "34710",
      adressCaddeSokak: "Bagdat Caddesi",
      adressDisKapiNo: "12",
      adressIcKapiNo: "3",
      adressTelefon: "5320000000",
      taahhutAlanAd: "Mehmet",
      taahhutAlanSoyad: "Yilmaz",
    },
    taahhutDiss: [{ sutKodu, disNo: 11 }, ...extraDiss],
  };
}

/** Full TakipAraGirisDVO payload with a start/end window. */
function takipAraRequest(
  baslangic: string,
  bitis: string,
): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    hastaTCK: "10000000001",
    baslangicTarihi: baslangic,
    bitisTarihi: bitis,
    sevkDurumu: "E",
    ktsHbysKodu: "SYNTHETIC_HBYS_001",
  };
}

describe("sandbox rules layer (G49-b)", () => {
  it("rejects a dental commitment outside the SUT annex-7 codes (SANDBOX_4001)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(DIS_TAAHHUT_KAYDET, taahhutRequest("404060"));
    expect(result["sonucKodu"]).toBe("SANDBOX_4001");
    expect(result["sonucMesaji"]).toBe(
      "Taahhut girişi yalnızca SUT ek-7 protez kodları ile yapılabilir.",
    );
  });

  it("creates no taahhut state when the annex-7 rule fires", () => {
    const state = new EpisodeState();
    const sandbox = new Sandbox(loadBundle(BUNDLE), state);
    sandbox.call(DIS_TAAHHUT_KAYDET, taahhutRequest("404060"));
    expect(state.entities.has("taahhut")).toBe(false);
    expect(state.identifiers.has("taahhutNo")).toBe(false);
  });

  it("rejects when any taahhutDiss entry carries an off-list code", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(
      DIS_TAAHHUT_KAYDET,
      taahhutRequest("404010", [{ sutKodu: "404060", disNo: 12 }]),
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_4001");
  });

  it("accepts an annex-7 prosthesis code and generates a taahhutNo", () => {
    const state = new EpisodeState();
    const sandbox = new Sandbox(loadBundle(BUNDLE), state);
    const result = sandbox.call(DIS_TAAHHUT_KAYDET, taahhutRequest("404010"));
    expect(result["sonucKodu"]).toBe("0000");
    expect(state.entities.has("taahhut")).toBe(true);
    expect(state.identifiers.get("taahhutNo")).toBeTruthy();
  });

  it("rejects a takip-ara window beyond one month (SANDBOX_4002)", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(
      TAKIP_ARA,
      takipAraRequest("01.01.2026", "01.03.2026"),
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_4002");
    expect(result["sonucMesaji"]).toBe("Arama araligi bir aydan fazla olamaz.");
  });

  it("accepts a window within one month", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = sandbox.call(
      TAKIP_ARA,
      takipAraRequest("01.01.2026", "01.02.2026"),
    );
    expect(result["sonucKodu"]).toBe("0000");
  });

  it("replays both new-group scenarios verbatim", () => {
    const sandbox = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const annex = sandbox.call(
      DIS_TAAHHUT_KAYDET,
      {},
      "taahhut-dis-annex7-restriction",
    );
    expect(annex["sonucKodu"]).toBe("SANDBOX_4001");
    const window = sandbox.call(TAKIP_ARA, {}, "takip-ara-window-limit");
    expect(window["sonucKodu"]).toBe("SANDBOX_4002");
  });
});
