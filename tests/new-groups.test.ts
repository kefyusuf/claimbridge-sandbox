import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { startSandboxServer } from "../src/SandboxServer.ts";

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
  hastaTCKimlikNo: "10000000001",
  sigortaliTuru: "1",
  devredilenKurum: "1",
  provizyonTarihi: "2026-11-21",
  provizyonTipi: "N",
  tedaviTuru: "A",
  tedaviTipi: "0",
  takipTipi: "N",
  bransKodu: "1",
  doktorTescilNo: "SYNTHETIC_DOCTOR_001",
  ktsHbysKodu: "SYNTHETIC_HBYS_001",
};

async function createSession(): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: "POST",
  });
  return ((await res.json()) as { sessionId: string }).sessionId;
}

async function call(
  sessionId: string,
  methodId: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `http://127.0.0.1:${port}/sessions/${sessionId}/call`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ methodId, request }),
    },
  );
  return (await res.json()) as Record<string, unknown>;
}

async function admitPatient(sessionId: string): Promise<string> {
  const admission = await call(
    sessionId,
    "medula.hastane.hasta-kabul.hasta-kabul",
    ADMISSION_REQUEST,
  );
  expect(admission["sonucKodu"]).toBe("0000");
  return admission["takipNo"] as string;
}

describe("sandbox serves the post-v0.5 groups over http (G48)", () => {
  it("serves takip-formu kayit/oku/sil as a lifecycle", async () => {
    const sessionId = await createSession();
    await admitPatient(sessionId);

    const kaydet = await call(
      sessionId,
      "medula.hastane.takip-formu.takip-formu-kaydet",
      {
        kullaniciTesisKodu: 1,
        diabetTakipFormu: {},
        takipNo: "SYNTHETIC_FORM_SKIP",
      },
    );
    expect(kaydet["sonucKodu"]).toBe("0000");
    const formNo = kaydet["takipFormuNo"] as string;
    expect(formNo).toBeTruthy();

    const oku = await call(
      sessionId,
      "medula.hastane.takip-formu.takip-formu-oku",
      {
        saglikTesisKodu: 1,
        tcKimlikNo: "10000000001",
      },
    );
    expect(oku["sonucKodu"]).toBe("0000");

    const sil = await call(
      sessionId,
      "medula.hastane.takip-formu.takip-formu-sil",
      {
        takipFormuNo: formNo,
        saglikTesisKodu: 1,
      },
    );
    expect(sil["sonucKodu"]).toBe("0000");
  });

  it("serves the yardimci ilac-ara search", async () => {
    const sessionId = await createSession();
    const result = await call(
      sessionId,
      "medula.hastane.yardimci-islemler.ilac-ara",
      {
        saglikTesisKodu: 1,
        barkod: "8699546010016",
      },
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(Array.isArray(result["ilaclar"])).toBe(true);
  });

  it("serves the imzali-rapor onay-bekleyen query", async () => {
    const sessionId = await createSession();
    const result = await call(
      sessionId,
      "medula.hastane.imzali-rapor.onay-bekleyen-rapor-sorgu",
      { saglikTesisKodu: 1, doktorTcKimlikNo: "10000000001" },
    );
    expect(result["sonucKodu"]).toBe("0000");
    expect(Array.isArray(result["raporBilgileri"])).toBe(true);
  });

  it("reads the new-group method contracts from the synced bundle", () => {
    const bundle = JSON.parse(readFileSync(BUNDLE, "utf8")) as {
      methods: Array<{ id: string }>;
    };
    const ids = bundle.methods.map((m) => m.id);
    for (const id of [
      "medula.hastane.takip-formu.takip-formu-kaydet",
      "medula.hastane.taahhut.dis-taahhut-kaydet",
      "medula.hastane.ortodonti.ortodonti-formu-kaydet",
      "medula.hastane.imzali-rapor.rapor-kaydet",
      "medula.hastane.yardimci-islemler.ilac-ara",
    ]) {
      expect(ids, `method ${id}`).toContain(id);
    }
  });
});
