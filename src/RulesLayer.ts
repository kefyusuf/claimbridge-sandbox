/**
 * Data-driven rules layer: applies the spec bundle's rules collection to
 * sandbox calls. A rule is active when its appliesTo.method matches the
 * called method id; handlers are keyed by rule id so the bundle decides
 * which rules run (registry-first — no hardcoded rule list in the sandbox).
 */
import type { BundleCollection } from "./loadBundle.ts";
import type { EpisodeState } from "./EpisodeState.ts";
import type { CallResult } from "./Sandbox.ts";

interface Rule {
  id: string;
  type: string;
  appliesTo: {
    method: string | null;
    dvo: string | null;
    field: string | null;
  };
}

/**
 * SUT annex-7 prosthesis codes (guide s.326): a dental commitment may
 * only carry these codes; anything else is rejected by the
 * taahhut-dis-annex7-restriction rule.
 */
const ANNEX7_PROSTHESIS_CODES = new Set([
  "404010",
  "404020",
  "404030",
  "404040",
  "404050",
  "404170",
  "404180",
  "404181",
  "404190",
  "404200",
  "404201",
  "404210",
  "404220",
  "404230",
  "404360",
  "404370",
  "404380",
  "404390",
  "404400",
  "404410",
  "404420",
]);

/** Parses dd.mm.yyyy guide dates; returns null for anything else. */
function parseTrDate(value: unknown): { y: number; m: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!m) return null;
  return { y: Number(m[3]), m: Number(m[2]) };
}

export class RulesLayer {
  private rules: Rule[];

  constructor(ruleWrappers: BundleCollection[]) {
    // The bundle nests each rule inside a wrapper object: { rules: [rule] }.
    this.rules = ruleWrappers.flatMap((w) =>
      Array.isArray(w["rules"])
        ? (w["rules"] as Rule[])
        : [w as unknown as Rule],
    );
  }

  /** Active rule count, for diagnostics and tests. */
  get size(): number {
    return this.rules.length;
  }

  /**
   * Precondition checks for the called method. Returns an error result
   * or null when every active rule passes. Runs after DVO required-field
   * validation and before any state effect is applied.
   */
  checkBefore(
    methodId: string,
    request: Record<string, unknown>,
    state: EpisodeState,
  ): CallResult | null {
    for (const rule of this.rules) {
      if (rule.appliesTo?.method !== methodId) continue;
      const failure = this.checkRule(rule, request, state);
      if (failure) return failure;
    }
    return null;
  }

  private checkRule(
    rule: Rule,
    request: Record<string, unknown>,
    state: EpisodeState,
  ): CallResult | null {
    switch (rule.id) {
      // state-transition rule (PRD 15.2): registering services against a
      // missing or cancelled takip must fail and leave state unchanged.
      case "hizmet-kayit-requires-active-takip":
        if (!state.entities.has("takip")) {
          return {
            sonucKodu: "SANDBOX_1001",
            sonucMesaji: "Takip bulunamadi.",
          };
        }
        return null;
      // conditional-required-field rule (guide s.189): tanilar is optional
      // per call but every takip must carry at least one diagnosis.
      case "conditional-tani-per-takip": {
        const tanilar = request["tanilar"];
        if (!Array.isArray(tanilar) || tanilar.length === 0) {
          return {
            sonucKodu: "SANDBOX_VALIDATION_ERROR",
            sonucMesaji:
              "Zorunlu alan eksik - tanilar (her takip icin en az bir tani gerekli).",
            missingFieldPath: "tanilar",
          };
        }
        return null;
      }
      // invoice-rule (PRD 15.5): a second invoice for the same patient
      // application flow must fail and leave no duplicate invoice state.
      case "duplicate-invoice-rejected":
        if (state.entities.has("invoiceRecord")) {
          return {
            sonucKodu: "SANDBOX_3001",
            sonucMesaji: "Bu basvuru icin fatura zaten olusturulmus.",
          };
        }
        return null;
      // taahhut-rule (guide s.326): a dental commitment may only be
      // registered for the SUT annex-7 prosthesis codes; any other code
      // is rejected and creates no taahhut state.
      case "taahhut-dis-annex7-restriction": {
        const entries = Array.isArray(request["taahhutDiss"])
          ? (request["taahhutDiss"] as Array<Record<string, unknown>>)
          : [];
        const ok = entries.every(
          (e) =>
            typeof e["sutKodu"] === "string" &&
            ANNEX7_PROSTHESIS_CODES.has(e["sutKodu"] as string),
        );
        if (!ok) {
          return {
            sonucKodu: "SANDBOX_4001",
            sonucMesaji:
              "Taahhut girişi yalnızca SUT ek-7 protez kodları ile yapılabilir.",
          };
        }
        return null;
      }
      // yardimci-rule (guide s.286): the takip-ara start/end window may
      // not exceed one month. The guide states the limit without defining
      // "one month"; the sandbox treats it as a calendar-month span of at
      // most one (01.01→01.02 passes, 01.01→01.03 fails).
      case "takip-ara-window-limit": {
        const start = parseTrDate(request["baslangicTarihi"]);
        const end = parseTrDate(request["bitisTarihi"]);
        if (start && end && end.y * 12 + end.m - (start.y * 12 + start.m) > 1) {
          return {
            sonucKodu: "SANDBOX_4002",
            sonucMesaji: "Arama araligi bir aydan fazla olamaz.",
          };
        }
        return null;
      }
      // No sandbox handler for this rule id yet.
      default:
        return null;
    }
  }
}
