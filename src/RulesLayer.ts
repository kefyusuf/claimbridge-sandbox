/**
 * Data-driven rules layer: applies the spec bundle's rules collection to
 * sandbox calls. A rule is active when its appliesTo.method matches the
 * called method id; handlers are keyed by rule id so the bundle decides
 * which rules run (registry-first — no hardcoded rule list in the sandbox).
 */
import type { BundleCollection } from "./loadBundle.js";
import type { EpisodeState } from "./EpisodeState.js";
import type { CallResult } from "./Sandbox.js";

interface Rule {
  id: string;
  type: string;
  appliesTo: {
    method: string | null;
    dvo: string | null;
    field: string | null;
  };
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
      // No sandbox handler for this rule id yet.
      default:
        return null;
    }
  }
}
