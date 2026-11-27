import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const TAKIP_FORMU_KAYDET = "medula.hastane.takip-formu.takip-formu-kaydet";
const DIS_TAAHHUT_KAYDET = "medula.hastane.taahhut.dis-taahhut-kaydet";

const DIABET_FORMU = {
  doktorTcKimlikNo: "10000000001",
  takipNo: "SYNTHETIC_FORM_SKIP",
  hipoglisemiSikligi: "0",
};

describe("post-v0.5 composite enrichment (G55)", () => {
  it("echoes the submitted diabetTakipFormu on takip-formu kaydet (s.310)", () => {
    const state = new EpisodeState();
    const sandbox = new Sandbox(loadBundle(BUNDLE), state);
    const result = sandbox.call(TAKIP_FORMU_KAYDET, {
      kullaniciTesisKodu: 1,
      diabetTakipFormu: DIABET_FORMU,
      takipNo: "SYNTHETIC_FORM_SKIP",
    });
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["takipFormuNo"]).toBeTruthy();
    expect(result["diabetTakipFormu"]).toEqual(DIABET_FORMU);
  });

  it("ships a deterministic PDF placeholder for taahhutCikti (s.322)", () => {
    const state = new EpisodeState();
    const sandbox = new Sandbox(loadBundle(BUNDLE), state);
    const result = sandbox.call(DIS_TAAHHUT_KAYDET, {
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
      taahhutDiss: [{ sutKodu: "404010", disNo: 11 }],
    });
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["taahhutNo"]).toBeTruthy();
    // Tablo 4.7.1.b: taahhutCikti is a byte[] PDF; the sandbox ships a
    // deterministic placeholder instead of an empty array.
    expect(result["taahhutCikti"]).toEqual(["SYNTHETIC_PDF_TAAHHUT_CIKTI"]);
  });
});
