import { describe, expect, it, beforeAll } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";

let sandbox: Sandbox;

beforeAll(() => {
  const bundle = loadBundle(BUNDLE);
  const state = new EpisodeState();
  sandbox = new Sandbox(bundle, state);
});

const VALID_REQUEST: Record<string, unknown> = {
  saglikTesisKodu: 1,
  hastaTCKimlikNo: "SYNTHETIC_TC_000000001",
  sigortaliTuru: "1",
  devredilenKurum: "1",
  provizyonTarihi: "2026-11-18",
  provizyonTipi: "N",
  tedaviTuru: "A",
  tedaviTipi: "0",
  takipTipi: "N",
  bransKodu: "1",
  doktorTescilNo: "SYNTHETIC_DOCTOR_001",
  ktsHbysKodu: "SYNTHETIC_HBYS_001",
};

describe("sandbox admission processor (M1)", () => {
  it("processes a valid hasta-kabul request through the full pipeline", () => {
    const result = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      VALID_REQUEST,
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(result["hastaBasvuruNo"]).toBeTruthy();
    expect(result["takipNo"]).toBeTruthy();
    expect(result["takipler"]).toBeInstanceOf(Array);
  });

  it("rejects a request missing a required DVO field", () => {
    const incomplete: Record<string, unknown> = { ...VALID_REQUEST };
    delete incomplete["hastaTCKimlikNo"];
    const result = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      incomplete,
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_VALIDATION_ERROR");
    expect(String(result["sonucMesaji"])).toContain("hastaTCKimlikNo");
  });

  it("replays the service-timeout scenario contract", () => {
    const result = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      VALID_REQUEST,
      "service-timeout",
    );
    expect(result["sonucKodu"]).toBe("SANDBOX_TIMEOUT");
    expect(result["sonucMesaji"]).toBeTruthy();
  });

  it("applies workflow state effects on success", () => {
    const state = new EpisodeState();
    const s = new Sandbox(loadBundle(BUNDLE), state);
    s.call("medula.hastane.hasta-kabul.hasta-kabul", VALID_REQUEST);
    expect(state.entities.has("patientAdmission")).toBe(true);
    expect(state.entities.has("takip")).toBe(true);
    expect(state.identifiers.has("hastaBasvuruNo")).toBe(true);
    expect(state.identifiers.has("takipNo")).toBe(true);
  });

  it("rejects an unknown method id", () => {
    expect(() =>
      sandbox.call("medula.hastane.hasta-kabul.does-not-exist", {}),
    ).toThrow(/unknown method/);
  });

  it("generates distinct hastaBasvuruNo values per admission", () => {
    const r1 = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      VALID_REQUEST,
    );
    const r2 = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      VALID_REQUEST,
    );
    expect(r1["hastaBasvuruNo"]).not.toBe(r2["hastaBasvuruNo"]);
  });
});
