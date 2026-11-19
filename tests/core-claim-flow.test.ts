import { describe, expect, it } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";
import { Sandbox } from "../src/Sandbox.js";

const BUNDLE = "fixtures/bundle.json";
const CORE_FLOW = "core-claim-flow";

/** Full-flow requests keyed by workflow step id (sandbox PRD §9 M4). */
function flowRequests(): Record<string, Record<string, unknown>> {
  return {
    "patient-admission": {
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
    },
    "service-registration": {
      saglikTesisKodu: 1,
      tanilar: [{ taniKodu: "J06.9", taniTipi: "1" }],
      ktsHbysKodu: "SYNTHETIC_HBYS_001",
    },
    "invoice-registration": {
      saglikTesisKodu: 1,
      faturaTarihi: "2026-11-19",
      faturaRefNo: "SYNTHETIC_FATURA_REF_E2E",
      hizmetDetaylari: [],
      trafikKazasiOdemeYuzdesi: 0,
      ilaveUcret: 0,
      muvafakatVar: "E",
    },
  };
}

function freshFlow(): { sandbox: Sandbox; state: EpisodeState } {
  const state = new EpisodeState();
  return { sandbox: new Sandbox(loadBundle(BUNDLE), state), state };
}

describe("sandbox core-claim-flow end-to-end (M4)", () => {
  it("runs the full three-step workflow from the bundle to completion", () => {
    const { sandbox, state } = freshFlow();
    const steps = sandbox.runWorkflow(CORE_FLOW, flowRequests());
    expect(steps.map((s) => s.stepId)).toEqual([
      "patient-admission",
      "service-registration",
      "invoice-registration",
    ]);
    for (const step of steps) {
      expect(step.result["sonucKodu"]).toBe("0000");
    }
    // All workflow creates materialised in episode state.
    for (const entity of [
      "patientAdmission",
      "takip",
      "serviceRecord",
      "invoiceRecord",
    ]) {
      expect(state.entities.has(entity)).toBe(true);
    }
    for (const identifier of [
      "hastaBasvuruNo",
      "takipNo",
      "islemSiraNo",
      "faturaTeslimNo",
    ]) {
      expect(state.identifiers.has(identifier)).toBe(true);
    }
  });

  it("carries identifiers from earlier steps into later step responses", () => {
    const { sandbox } = freshFlow();
    const steps = sandbox.runWorkflow(CORE_FLOW, flowRequests());
    const admission = steps[0].result;
    const invoice = steps[2].result;
    expect(invoice["hastaBasvuruNo"]).toBe(admission["hastaBasvuruNo"]);
    expect(admission["takipNo"]).toBeTruthy();
    expect(invoice["faturaTeslimNo"]).toBeTruthy();
  });

  it("stops the chain at a failing step and creates no later state", () => {
    const { sandbox, state } = freshFlow();
    const requests = flowRequests();
    delete requests["service-registration"]["tanilar"];
    const steps = sandbox.runWorkflow(CORE_FLOW, requests);
    expect(steps).toHaveLength(2);
    expect(steps[1].result["sonucKodu"]).toBe("SANDBOX_VALIDATION_ERROR");
    expect(steps[1].result["missingFieldPath"]).toBe("tanilar");
    expect(state.entities.has("serviceRecord")).toBe(false);
    expect(state.entities.has("invoiceRecord")).toBe(false);
  });

  it("rejects an unknown workflow id", () => {
    const { sandbox } = freshFlow();
    expect(() => sandbox.runWorkflow("does-not-exist", {})).toThrow(
      /unknown workflow/,
    );
  });

  it("produces distinct identifiers across two independent flows", () => {
    const first = freshFlow();
    const steps1 = first.sandbox.runWorkflow(CORE_FLOW, flowRequests());
    const second = freshFlow();
    const steps2 = second.sandbox.runWorkflow(CORE_FLOW, flowRequests());
    const end1 = steps1[2].result;
    const end2 = steps2[2].result;
    expect(end1["hastaBasvuruNo"]).not.toBe(end2["hastaBasvuruNo"]);
    expect(end1["faturaTeslimNo"]).not.toBe(end2["faturaTeslimNo"]);
  });

  it("keeps scenario replay orthogonal to the workflow runner", () => {
    const { sandbox } = freshFlow();
    const steps = sandbox.runWorkflow(CORE_FLOW, flowRequests());
    expect(steps[0].result["sonucKodu"]).toBe("0000");
    const replay = sandbox.call(
      "medula.hastane.hasta-kabul.hasta-kabul",
      {},
      "service-timeout",
    );
    expect(replay["sonucKodu"]).toBe("SANDBOX_TIMEOUT");
  });
});
