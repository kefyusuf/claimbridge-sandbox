import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSandboxServer } from "../src/SandboxServer.js";

const BUNDLE = "fixtures/bundle.json";

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

async function callSession(
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("sandbox http service (S2)", () => {
  it("creates a session and returns its id", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
    });
    const body = (await res.json()) as { sessionId?: string };
    expect(res.status).toBe(200);
    expect(body.sessionId).toMatch(/^S\d+$/);
  });

  it("keeps episode state across calls in the same session", async () => {
    const created = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const admission = await callSession(`/sessions/${sessionId}/call`, {
      methodId: "medula.hastane.hasta-kabul.hasta-kabul",
      request: ADMISSION_REQUEST,
    });
    expect(admission.status).toBe(200);
    expect(admission.json["sonucKodu"]).toBe("0000");
    const takipNo = admission.json["takipNo"] as string;

    const hizmet = await callSession(`/sessions/${sessionId}/call`, {
      methodId: "medula.hastane.hizmet-kayit.hizmet-kayit",
      request: {
        saglikTesisKodu: 1,
        takipNo,
        tanilar: [{ taniKodu: "J06.9" }],
        ktsHbysKodu: "SYNTHETIC_HBYS_001",
      },
    });
    expect(hizmet.status).toBe(200);
    expect(hizmet.json["sonucKodu"]).toBe("0000");
    expect(hizmet.json["islemSiraNo"]).toBeTruthy();
  });

  it("returns 404 for an unknown session", async () => {
    const { status, json } = await callSession("/sessions/S999999/call", {
      methodId: "medula.hastane.hasta-kabul.hasta-kabul",
      request: ADMISSION_REQUEST,
    });
    expect(status).toBe(404);
    expect(json["sonucKodu"]).toBe("SANDBOX_1001");
    expect(json["sonucMesaji"]).toBe("Oturum bulunamadi.");
  });

  it("returns 400 for invalid JSON bodies", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sessions/S1/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["sonucKodu"]).toBe("SANDBOX_BAD_REQUEST");
  });

  it("returns 400 for an unknown method id", async () => {
    const created = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const { status, json } = await callSession(`/sessions/${sessionId}/call`, {
      methodId: "does.not.exist",
      request: {},
    });
    expect(status).toBe(400);
    expect(json["sonucKodu"]).toBe("SANDBOX_BAD_REQUEST");
    expect(String(json["sonucMesaji"])).toContain("unknown method");
  });

  it("deletes a session with 204", async () => {
    const created = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const res = await fetch(`http://127.0.0.1:${port}/sessions/${sessionId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });
});
