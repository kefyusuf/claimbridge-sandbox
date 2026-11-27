import { describe, expect, it, beforeEach } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

const HIZMET_KAYIT = "medula.hastane.hizmet-kayit.hizmet-kayit";
const HIZMET_OKU = "medula.hastane.hizmet-kayit.hizmet-kaydi-oku";
const HIZMET_IPTAL = "medula.hastane.hizmet-kayit.hizmet-kaydi-iptal";
const HASTA_KABUL = "medula.hastane.hasta-kabul.hasta-kabul";

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

/** Fresh sandbox with an admitted patient (takip + identifiers in state). */
function admittedSandbox(): { sandbox: Sandbox; state: EpisodeState } {
  const state = new EpisodeState();
  const sandbox = new Sandbox(loadBundle(BUNDLE), state);
  const admission = sandbox.call(HASTA_KABUL, ADMISSION_REQUEST);
  if (admission["sonucKodu"] !== "0000") {
    throw new Error("admission precondition failed");
  }
  return { sandbox, state };
}

function hizmetRequest(
  admission: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    saglikTesisKodu: 1,
    takipNo: admission["takipNo"],
    hastaBasvuruNo: admission["hastaBasvuruNo"],
    tanilar: [{ taniKodu: "J06.9", taniTipi: "1" }],
    ktsHbysKodu: "SYNTHETIC_HBYS_001",
    ...overrides,
  };
}

/** oku/iptal share the same required triple: saglikTesisKodu, takipNo, ktsHbysKodu. */
function okuRequest(takipNo: unknown): Record<string, unknown> {
  return { saglikTesisKodu: 1, takipNo, ktsHbysKodu: "SYNTHETIC_HBYS_001" };
}

let env: { sandbox: Sandbox; state: EpisodeState };
let admission: Record<string, unknown>;

beforeEach(() => {
  env = admittedSandbox();
  admission = {
    takipNo: env.state.identifiers.get("takipNo"),
    hastaBasvuruNo: env.state.identifiers.get("hastaBasvuruNo"),
  };
});

describe("sandbox service registration (M2)", () => {
  it("registers services against an active takip through the rules layer", () => {
    const result = env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["takipNo"]).toBe(admission["takipNo"]);
    expect(result["hastaBasvuruNo"]).toBe(admission["hastaBasvuruNo"]);
    expect(result["islemSiraNo"]).toBeTruthy();
    expect(result["hataliKayitlar"]).toEqual([]);
    expect(env.state.entities.has("serviceRecord")).toBe(true);
  });

  it("rejects a registration missing a required DVO field", () => {
    const request = hizmetRequest(admission);
    delete request["takipNo"];
    const result = env.sandbox.call(HIZMET_KAYIT, request);
    expect(result["sonucKodu"]).toBe("SANDBOX_VALIDATION_ERROR");
    expect(String(result["sonucMesaji"])).toContain("takipNo");
  });

  it("enforces the active-takip state-transition rule (SANDBOX_1001)", () => {
    const fresh = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const orphan: Record<string, unknown> = {
      saglikTesisKodu: 1,
      takipNo: "SYNTHETIC_TAKIP_MISSING",
      tanilar: [{ taniKodu: "J06.9" }],
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    };
    const result = fresh.call(HIZMET_KAYIT, orphan);
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Takip bulunamadi.");
  });

  it("leaves state unchanged when the active-takip rule fires", () => {
    const state = new EpisodeState();
    const fresh = new Sandbox(loadBundle(BUNDLE), state);
    const orphan: Record<string, unknown> = {
      saglikTesisKodu: 1,
      takipNo: "SYNTHETIC_TAKIP_MISSING",
      tanilar: [{ taniKodu: "J06.9" }],
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    };
    fresh.call(HIZMET_KAYIT, orphan);
    expect(state.entities.has("serviceRecord")).toBe(false);
    expect(state.identifiers.has("islemSiraNo")).toBe(false);
  });

  it("enforces the conditional tani-per-takip rule", () => {
    const request = hizmetRequest(admission, { tanilar: [] });
    const result = env.sandbox.call(HIZMET_KAYIT, request);
    expect(result["sonucKodu"]).toBe("SANDBOX_VALIDATION_ERROR");
    expect(result["missingFieldPath"]).toBe("tanilar");
    expect(env.state.entities.has("serviceRecord")).toBe(false);
  });

  it("replays the invalid-takip-no scenario contract verbatim", () => {
    const fresh = new Sandbox(loadBundle(BUNDLE), new EpisodeState());
    const result = fresh.call(HIZMET_KAYIT, {}, "invalid-takip-no");
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Takip bulunamadi.");
  });

  it("reads back a stored service record", () => {
    env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    const result = env.sandbox.call(
      HIZMET_OKU,
      okuRequest(admission["takipNo"]),
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["takipNo"]).toBe(admission["takipNo"]);
  });

  it("rejects a read against a missing service record (SANDBOX_1001)", () => {
    const result = env.sandbox.call(
      HIZMET_OKU,
      okuRequest("SYNTHETIC_TAKIP_MISSING"),
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Hizmet kaydi bulunamadi.");
  });

  it("cancels a stored service record and clears the state", () => {
    env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    const result = env.sandbox.call(
      HIZMET_IPTAL,
      okuRequest(admission["takipNo"]),
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(env.state.entities.has("serviceRecord")).toBe(false);
  });

  it("rejects a cancellation against a missing service record (SANDBOX_1001)", () => {
    const result = env.sandbox.call(
      HIZMET_IPTAL,
      okuRequest(admission["takipNo"]),
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_1001");
    expect(result["sonucMesaji"]).toBe("Hizmet kaydi bulunamadi.");
  });

  it("generates a distinct islemSiraNo per registration", () => {
    const r1 = env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    const r2 = env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    expect(r1["islemSiraNo"]).not.toBe(r2["islemSiraNo"]);
  });

  it("composes one KayitliIslemBilgisi row per submitted service line (s.235)", () => {
    const request = hizmetRequest(admission, {
      ilacBilgileri: [
        { hizmetSunucuRefNo: "SYNTHETIC_REF_001", barkod: "8699546010016" },
        { hizmetSunucuRefNo: "SYNTHETIC_REF_002", barkod: "8699546020013" },
      ],
      tahlilBilgileri: [{ hizmetSunucuRefNo: "SYNTHETIC_REF_003" }],
    });
    const result = env.sandbox.call(HIZMET_KAYIT, request);
    expect(result["sonucKodu"]).toBe("0000");
    const rows = result["islemBilgileri"] as Array<{
      hizmetSunucuRefNo: string | null;
      islemSiraNo: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.hizmetSunucuRefNo).toBe("SYNTHETIC_REF_001");
    expect(rows[1]?.hizmetSunucuRefNo).toBe("SYNTHETIC_REF_002");
    expect(rows[2]?.hizmetSunucuRefNo).toBe("SYNTHETIC_REF_003");
    for (const row of rows) {
      expect(row.islemSiraNo).toMatch(/^SYNTHETIC_ISLEMSIRANO_\d{6}$/);
    }
    expect(new Set(rows.map((r) => r.islemSiraNo)).size).toBe(3);
  });

  it("tracks the last generated islemSiraNo as the session identifier", () => {
    const request = hizmetRequest(admission, {
      ilacBilgileri: [{ hizmetSunucuRefNo: "SYNTHETIC_REF_001" }],
      tahlilBilgileri: [{ hizmetSunucuRefNo: "SYNTHETIC_REF_002" }],
    });
    const result = env.sandbox.call(HIZMET_KAYIT, request);
    const rows = result["islemBilgileri"] as Array<{ islemSiraNo: string }>;
    expect(rows).toHaveLength(2);
    expect(env.state.identifiers.get("islemSiraNo")).toBe(
      rows[1]?.islemSiraNo,
    );
  });

  it("keeps islemBilgileri empty when no service lines are submitted", () => {
    const result = env.sandbox.call(HIZMET_KAYIT, hizmetRequest(admission));
    expect(result["islemBilgileri"]).toEqual([]);
  });
});
