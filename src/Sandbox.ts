/**
 * Sandbox router: loads the spec bundle, resolves the method contract,
 * validates requests against the input DVO, applies workflow state
 * effects, and replays scenario contracts.
 */
import { loadBundle, type Bundle } from "./loadBundle.js";
import { EpisodeState, IDENTIFIER_NAMES } from "./EpisodeState.js";
import { RulesLayer } from "./RulesLayer.js";

export interface CallResult {
  sonucKodu: string;
  sonucMesaji: string;
  [key: string]: unknown;
}

type Method = Record<string, unknown>;
type DvoField = Record<string, unknown>;

/** Readable labels for entity names surfaced in read-precondition errors. */
const READ_LABELS: Record<string, string> = {
  takip: "Takip",
  serviceRecord: "Hizmet kaydi",
  patientAdmission: "Hasta basvurusu",
};

export class Sandbox {
  private bundle: Bundle;
  private state: EpisodeState;
  private rules: RulesLayer;

  constructor(bundle: Bundle, state: EpisodeState) {
    this.bundle = bundle;
    this.state = state;
    this.rules = new RulesLayer(bundle.rules);
  }

  call(
    methodId: string,
    request: Record<string, unknown>,
    scenarioId?: string,
  ): CallResult {
    const method = this.resolveMethod(methodId);
    if (!method) throw new Error(`unknown method: ${methodId}`);

    if (scenarioId) return this.replayScenario(scenarioId, this.state);

    // 1. Validate required input fields against the input DVO.
    const inputDvoId = this.resolveInputDvoId(method);
    if (inputDvoId) {
      const error = this.validateRequired(inputDvoId, request);
      if (error) return error;
    }

    // 2. Apply the bundle's rules layer for this method (state-transition
    //    and conditional-required-field rules; SANDBOX_1001 for missing
    //    takip state per PRD 15.2).
    const ruleError = this.rules.checkBefore(methodId, request, this.state);
    if (ruleError) return ruleError;

    // 3. Enforce read preconditions from state effects: every non-identifier
    //    name in `reads` must exist as an entity (service records and takips
    //    cannot be read or cancelled before they are created).
    const readError = this.checkReadPreconditions(method);
    if (readError) return readError;

    // 4. Simulate timeout when the request flags it (service-timeout scenario).
    if (request["simulateTimeout"] === true) {
      return {
        sonucKodu: "SANDBOX_TIMEOUT",
        sonucMesaji: "Servis zaman asimi simule edildi.",
      };
    }

    // 5. Apply workflow state effects.
    this.applyEffects(method);

    // 6. Build the success response from the generated identifiers.
    return this.buildSuccessResponse(method, request);
  }

  private resolveMethod(methodId: string): Method | undefined {
    return this.bundle.methods.find((m: Method) => m["id"] === methodId);
  }

  private resolveDvo(dvoId: string): Method | undefined {
    return this.bundle.dvos.find((d: Method) => d["id"] === dvoId);
  }

  private resolveInputDvoId(method: Method): string | null {
    const contract = method["contract"] as Record<string, unknown> | undefined;
    const inputDvo = contract?.["inputDvo"] as string | null | undefined;
    return inputDvo ?? null;
  }

  private validateRequired(
    dvoId: string,
    request: Record<string, unknown>,
  ): CallResult | null {
    const dvo = this.resolveDvo(dvoId);
    if (!dvo) return null;
    const fields = (dvo["fields"] as DvoField[]) ?? [];
    for (const f of fields) {
      if (f["required"] !== true) continue;
      const name = f["name"] as string;
      if (name in request && request[name] !== null) continue;
      // Linked-takip exception: hastaTCKimlikNo not required when takipNo is provided.
      if (name === "hastaTCKimlikNo" && "takipNo" in request) continue;
      return {
        sonucKodu: "SANDBOX_VALIDATION_ERROR",
        sonucMesaji: `Zorunlu alan eksik - ${name}`,
        missingFieldPath: name,
      };
    }
    return null;
  }

  private applyEffects(method: Method): void {
    const effects = method["stateEffects"] as
      Record<string, string[]> | undefined;
    if (!effects) return;
    this.state.applyCreates(
      effects["creates"] ?? [],
      effects["generates"] ?? [],
    );
    this.state.applyDeletes(effects["deletes"] ?? []);
  }

  private checkReadPreconditions(method: Method): CallResult | null {
    const effects = method["stateEffects"] as
      Record<string, string[]> | undefined;
    const reads = effects?.["reads"] ?? [];
    for (const name of reads) {
      if (IDENTIFIER_NAMES.has(name)) continue;
      if (this.state.entities.has(name)) continue;
      return {
        sonucKodu: "SANDBOX_1001",
        sonucMesaji: `${READ_LABELS[name] ?? name} bulunamadi.`,
      };
    }
    return null;
  }

  private buildSuccessResponse(
    method: Method,
    request: Record<string, unknown>,
  ): CallResult {
    const response: CallResult = {
      sonucKodu: "0000",
      sonucMesaji: "Islem basari ile tamamlandi.",
    };
    for (const [key, value] of this.state.identifiers) {
      response[key] = value;
    }
    // Echo the caller's identifiers so responses are self-contained.
    for (const key of ["takipNo", "hastaBasvuruNo", "saglikTesisKodu"]) {
      if (key in request) response[key] = request[key];
    }
    // Output DVO composites, keyed by the contract's output DVO.
    const contract = method["contract"] as Record<string, unknown> | undefined;
    const outputDvo = contract?.["outputDvo"] as string | undefined;
    if (outputDvo === "ProvizyonCevapDVO") {
      const takipNo = this.state.identifiers.get("takipNo") ?? "";
      const basvuruNo = this.state.identifiers.get("hastaBasvuruNo") ?? "";
      response["takipler"] = [
        {
          takipNo,
          takipTipi: "N",
          takipDurumu: "0",
          hastaBasvuruNo: basvuruNo,
        },
      ];
    }
    if (outputDvo === "HizmetKayitCevapDVO") {
      response["hataliKayitlar"] = [];
    }
    return response;
  }

  private replayScenario(scenarioId: string, state: EpisodeState): CallResult {
    const scenario = this.bundle.scenarios.find(
      (s: Method) => s["id"] === scenarioId,
    );
    if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
    const expected = scenario["expected"] as Record<string, unknown>;
    const result = expected["result"] as Record<string, string>;
    const stateChanges = expected["stateChanges"] as
      Record<string, unknown> | undefined;
    if (stateChanges && Array.isArray(stateChanges["creates"])) {
      state.applyCreates(stateChanges["creates"] as string[], []);
    }
    return {
      sonucKodu: result["sonucKodu"],
      sonucMesaji: result["sonucMesaji"] ?? "",
    };
  }
}
