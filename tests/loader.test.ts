import { describe, expect, it, beforeAll } from "vitest";
import { loadBundle } from "../src/loadBundle.js";
import { EpisodeState } from "../src/EpisodeState.js";

const BUNDLE = "fixtures/bundle.json";

let bundle: ReturnType<typeof loadBundle>;

beforeAll(() => {
  bundle = loadBundle(BUNDLE);
});

describe("bundle loader (sandbox M0)", () => {
  it("loads the spec bundle with all seven collections", () => {
    expect(bundle.specVersion).toBe("0.9.0");
    expect(bundle.services).toHaveLength(9);
    expect(bundle.methods).toHaveLength(73);
    expect(bundle.dvos).toHaveLength(212);
    expect(bundle.enums).toHaveLength(81);
    expect(bundle.rules).toHaveLength(7);
    expect(bundle.workflows).toHaveLength(4);
    expect(bundle.scenarios).toHaveLength(8);
  });

  it("resolves the core-claim-flow workflow with three steps", () => {
    const flow = bundle.workflows.find(
      (w: Record<string, unknown>) => w["id"] === "core-claim-flow",
    );
    expect(flow).toBeTruthy();
    expect(
      (flow!["steps"] as Array<Record<string, unknown>>).map((s) => s["id"]),
    ).toEqual([
      "patient-admission",
      "service-registration",
      "invoice-registration",
    ]);
  });

  it("resolves the eight scenario contracts", () => {
    const ids = bundle.scenarios.map((s: Record<string, unknown>) => s["id"]);
    expect(ids.sort()).toEqual([
      "duplicate-invoice",
      "happy-path",
      "invalid-takip-no",
      "invoice-without-service",
      "missing-required-field",
      "service-timeout",
      "taahhut-dis-annex7-restriction",
      "takip-ara-window-limit",
    ]);
  });
});

describe("episode state (sandbox M0)", () => {
  it("starts an episode empty and applies workflow step effects", () => {
    const state = new EpisodeState();
    expect(state.entities.size).toBe(0);
    expect(state.identifiers.size).toBe(0);

    state.applyCreates(
      ["patientAdmission", "takip"],
      ["hastaBasvuruNo", "takipNo"],
    );
    expect(state.entities.has("patientAdmission")).toBe(true);
    expect(state.entities.has("takip")).toBe(true);
    expect(state.identifiers.get("hastaBasvuruNo")).toBeTruthy();
    expect(state.identifiers.get("takipNo")).toBeTruthy();
  });

  it("requires entities before dependent steps can run", () => {
    const state = new EpisodeState();
    expect(state.canRun(["serviceRecord"])).toBe(false);
    state.applyCreates(["serviceRecord"], []);
    expect(state.canRun(["serviceRecord"])).toBe(true);
  });

  it("deletes entities on cancellation effects", () => {
    const state = new EpisodeState();
    state.applyCreates(["takip"], ["takipNo"]);
    expect(state.entities.has("takip")).toBe(true);
    state.applyDeletes(["takip"]);
    expect(state.entities.has("takip")).toBe(false);
  });

  it("generates identifiers with distinct values", () => {
    const state = new EpisodeState();
    state.applyCreates([], ["hastaBasvuruNo", "takipNo"]);
    expect(state.identifiers.get("hastaBasvuruNo")).not.toBe(
      state.identifiers.get("takipNo"),
    );
  });
});
