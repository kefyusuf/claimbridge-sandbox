import { describe, expect, it, beforeEach } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const HASTA_KABUL = "medula.hastane.hasta-kabul.hasta-kabul";
const HIZMET_KAYIT = "medula.hastane.hizmet-kayit.hizmet-kayit";
const FATURA_KAYIT = "medula.hastane.fatura-kayit.fatura-kayit";
const FATURA_OKU = "medula.hastane.fatura-kayit.fatura-oku";
const FATURA_IPTAL = "medula.hastane.fatura-kayit.fatura-iptal";
const FATURA_TUTAR_OKU = "medula.hastane.fatura-kayit.fatura-tutar-oku";

const ADMISSION_REQUEST: Record<string, unknown> = {
  saglikTesisKodu: 1,
  hastaTCKimlikNo: "SYNTHETIC_TC_000000001",
  sigortaliTuru: "1",
  devredilenKurum: "1",
  provizyonTarihi: "2026-11-19",
  provizyonTipi: "N",
  tedaviTuru: "A",
  tedaviTipi: "0",
  takipTipi: "N",
  bransKodu: "1",
  doktorTescilNo: "SYNTHETIC_DOCTOR_001",
  ktsHbysKodu: "SYNTHETIC_HBYS_001",
};

/** Fresh sandbox taken through admission and service registration. */
function registeredSandbox(): {
  sandbox: Sandbox;
  state: EpisodeState;
  basvuru: string;
} {
  const state = new EpisodeState();
  const sandbox = new Sandbox(loadBundle(BUNDLE), state);
  const admission = sandbox.call(HASTA_KABUL, ADMISSION_REQUEST);
  if (admission["sonucKodu"] !== "0000") {
    throw new Error("admission precondition failed");
  }
  const hizmet = sandbox.call(HIZMET_KAYIT, {
    saglikTesisKodu: 1,
    takipNo: admission["takipNo"],
    hastaBasvuruNo: admission["hastaBasvuruNo"],
    tanilar: [{ taniKodu: "J06.9", taniTipi: "1" }],
    ktsHbysKodu: "SYNTHETIC_HBYS_001",
  });
  if (hizmet["sonucKodu"] !== "0000") {
    throw new Error("service registration precondition failed");
  }
  const basvuru = state.identifiers.get("hastaBasvuruNo") as string;
  return { sandbox, state, basvuru };
}

function faturaRequest(basvuruNo: string): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    faturaTarihi: "2026-11-19",
    hastaBasvuruNo: basvuruNo,
    faturaRefNo: `SYNTHETIC_FATURA_REF_${basvuruNo}`,
    hizmetDetaylari: [],
    trafikKazasiOdemeYuzdesi: 0,
    ilaveUcret: 0,
    muvafakatVar: "E",
  };
}

function okuRequest(
  saved: Record<string, unknown>,
  basvuruNo: string,
): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    faturaTeslimNo: saved["faturaTeslimNo"] ?? "SYNTHETIC_FATURA_MISSING",
    faturaRefNo: faturaRequest(basvuruNo)["faturaRefNo"],
    faturaTarihi: "2026-11-19",
    ktsHbysKodu: "SYNTHETIC_HBYS_001",
  };
}

function iptalRequest(faturaTeslimNo: unknown): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    faturaTeslimNo,
    ktsHbysKodu: "SYNTHETIC_HBYS_001",
  };
}

let env: { sandbox: Sandbox; state: EpisodeState; basvuru: string };

beforeEach(() => {
  env = registeredSandbox();
});

describe("sandbox invoice registration (M3)", () => {
  it("registers an invoice for a registered service flow", () => {
    const result = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["faturaTeslimNo"]).toBeTruthy();
    expect(result["faturaTutari"]).toBeTruthy();
    expect(result["hastaBasvuruNo"]).toBe(env.basvuru);
    expect(env.state.entities.has("invoiceRecord")).toBe(true);
    expect(env.state.identifiers.has("faturaTeslimNo")).toBe(true);
  });

  it("rejects a duplicate invoice with SANDBOX_3001 and keeps first state", () => {
    const first = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    const second = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    expect(second["sonucKodu"]).toBe("SANDBOX_3001");
    expect(second["sonucMesaji"]).toBe(
      "Bu basvuru icin fatura zaten olusturulmus.",
    );
    expect(env.state.identifiers.get("faturaTeslimNo")).toBe(
      first["faturaTeslimNo"],
    );
  });

  it("rejects an invoice without a registered service with SANDBOX_2001", () => {
    // Fresh admission: identifiers exist, but no service record was registered.
    const state = new EpisodeState();
    const sandbox = new Sandbox(loadBundle(BUNDLE), state);
    const admission = sandbox.call(HASTA_KABUL, ADMISSION_REQUEST);
    if (admission["sonucKodu"] !== "0000") {
      throw new Error("admission precondition failed");
    }
    const basvuru = state.identifiers.get("hastaBasvuruNo") as string;
    const result = sandbox.call(FATURA_KAYIT, faturaRequest(basvuru));
    expect(result["sonucKodu"]).toBe("SANDBOX_2001");
    expect(result["sonucMesaji"]).toBe("Kayitli hizmet bulunamadi.");
    expect(state.entities.has("invoiceRecord")).toBe(false);
  });

  it("rejects an invoice missing a required DVO field", () => {
    const request = faturaRequest(env.basvuru);
    delete request["muvafakatVar"];
    const result = env.sandbox.call(FATURA_KAYIT, request);
    expect(result["sonucKodu"]).toBe("SANDBOX_VALIDATION_ERROR");
    expect(String(result["sonucMesaji"])).toContain("muvafakatVar");
  });

  it("replays the duplicate-invoice scenario contract verbatim", () => {
    const result = env.sandbox.call(FATURA_KAYIT, {}, "duplicate-invoice");
    expect(result["sonucKodu"]).toBe("SANDBOX_3001");
    expect(result["sonucMesaji"]).toBe(
      "Bu basvuru icin fatura zaten olusturulmus.",
    );
  });

  it("replays the invoice-without-service scenario contract verbatim", () => {
    const result = env.sandbox.call(
      FATURA_KAYIT,
      {},
      "invoice-without-service",
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_2001");
    expect(result["sonucMesaji"]).toBe("Kayitli hizmet bulunamadi.");
  });

  it("reads back a stored invoice", () => {
    const saved = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    const result = env.sandbox.call(FATURA_OKU, okuRequest(saved, env.basvuru));
    expect(result["sonucKodu"]).toBe("0000");
    // Guide s.245: the read returns the delivery numbers as an array,
    // plus one composed invoice-detail row.
    expect(result["faturaTeslimNo"]).toEqual([saved["faturaTeslimNo"]]);
    const rows = result["faturaDetaylari"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["takipNo"]).toBeTruthy();
  });

  it("rejects a read against a missing invoice (SANDBOX_1001)", () => {
    const result = env.sandbox.call(FATURA_OKU, okuRequest({}, env.basvuru));
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Fatura bulunamadi.");
  });

  it("cancels a stored invoice and clears the state", () => {
    const saved = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    const result = env.sandbox.call(
      FATURA_IPTAL,
      iptalRequest(saved["faturaTeslimNo"]),
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(env.state.entities.has("invoiceRecord")).toBe(false);
  });

  it("rejects a second cancellation against a missing invoice (SANDBOX_1001)", () => {
    const saved = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    env.sandbox.call(FATURA_IPTAL, iptalRequest(saved["faturaTeslimNo"]));
    const result = env.sandbox.call(
      FATURA_IPTAL,
      iptalRequest(saved["faturaTeslimNo"]),
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Fatura bulunamadi.");
  });

  it("reads the invoice amount for a stored invoice", () => {
    env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    const result = env.sandbox.call(
      FATURA_TUTAR_OKU,
      faturaRequest(env.basvuru),
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["faturaTeslimNo"]).toBeTruthy();
  });

  it("generates distinct faturaTeslimNo values across separate flows", () => {
    const r1 = env.sandbox.call(FATURA_KAYIT, faturaRequest(env.basvuru));
    const second = registeredSandbox();
    const r2 = second.sandbox.call(FATURA_KAYIT, faturaRequest(second.basvuru));
    expect(r1["faturaTeslimNo"]).not.toBe(r2["faturaTeslimNo"]);
  });
});
