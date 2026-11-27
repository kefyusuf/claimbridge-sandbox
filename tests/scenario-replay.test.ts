import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { startSandboxServer } from "../src/SandboxServer.ts";

const BUNDLE = "fixtures/bundle.json";

interface ScenarioContract {
  id: string;
  method: string;
  expected: { result: { sonucKodu: string; sonucMesaji: string } };
}

let port: number;
let close: () => Promise<void>;

beforeAll(async () => {
  const handle = await startSandboxServer(BUNDLE, 0);
  port = handle.port;
  close = handle.close;
});

afterAll(async () => {
  await close();
});

async function replayScenario(
  scenario: ScenarioContract,
): Promise<Record<string, unknown>> {
  const sessionRes = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: "POST",
  });
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  const callRes = await fetch(
    `http://127.0.0.1:${port}/sessions/${sessionId}/call`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        methodId: scenario.method,
        request: {},
        scenarioId: scenario.id,
      }),
    },
  );
  return (await callRes.json()) as Record<string, unknown>;
}

describe("http scenario replay conformance (G53)", () => {
  it("replays every bundle scenario verbatim over http", async () => {
    const bundle = JSON.parse(readFileSync(BUNDLE, "utf8")) as {
      scenarios: ScenarioContract[];
    };
    // A fresh session per scenario keeps replay state effects isolated.
    expect(bundle.scenarios).toHaveLength(9);
    for (const scenario of bundle.scenarios) {
      const result = await replayScenario(scenario);
      expect(result["sonucKodu"], `scenario ${scenario.id} sonucKodu`).toBe(
        scenario.expected.result.sonucKodu,
      );
      expect(result["sonucMesaji"], `scenario ${scenario.id} sonucMesaji`).toBe(
        scenario.expected.result.sonucMesaji,
      );
    }
  });

  it("leaves a replayed session usable for follow-up calls", async () => {
    const sessionRes = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
    });
    const { sessionId } = (await sessionRes.json()) as { sessionId: string };
    const call = async (body: Record<string, unknown>) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/sessions/${sessionId}/call`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return (await res.json()) as Record<string, unknown>;
    };
    // The under-18 replay creates takip state (9000 is NOT an error, s.143).
    const replay = await call({
      methodId: "medula.hastane.hasta-kabul.hasta-kabul",
      request: {},
      scenarioId: "provizyon-under18-warning",
    });
    expect(replay["sonucKodu"]).toBe("9000");
    expect(replay["takipNo"]).toBeTruthy();
    // The created takip state serves a follow-up service registration.
    const hizmet = await call({
      methodId: "medula.hastane.hizmet-kayit.hizmet-kayit",
      request: {
        saglikTesisKodu: 1,
        takipNo: replay["takipNo"],
        hastaBasvuruNo: replay["hastaBasvuruNo"],
        tanilar: [{ taniKodu: "J06.9", taniTipi: "1" }],
        ktsHbysKodu: "SYNTHETIC_HBYS_001",
      },
    });
    expect(hizmet["sonucKodu"]).toBe("0000");
    expect(hizmet["islemSiraNo"]).toBeTruthy();
  });
});
