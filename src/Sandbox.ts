/**
 * Sandbox router: loads the spec bundle, resolves the method contract,
 * validates requests against the input DVO, applies workflow state
 * effects, and replays scenario contracts.
 */
import { loadBundle, type Bundle } from "./loadBundle.js";
import { EpisodeState } from "./EpisodeState.js";

export interface CallResult {
  sonucKodu: string;
  sonucMesaji: string;
  [key: string]: unknown;
}

type Method = Record<string, unknown>;
type DvoField = Record<string, unknown>;

export class Sandbox {
  private bundle: Bundle;
  private state: EpisodeState;

  constructor(bundle: Bundle, state: EpisodeState) {
    this.bundle = bundle;
    this.state = state;
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

    // 2. Simulate timeout when the request flags it (service-timeout scenario).
    if (request["simulateTimeout"] === true) {
      return {
        sonucKodu: "SANDBOX_TIMEOUT",
        sonucMesaji: "Servis zaman asimi simule edildi.",
      };
    }

    // 3. Apply workflow state effects.
    this.applyEffects(method);

    // 4. Build the success response from the generated identifiers.
    return this.buildSuccessResponse(method);
  }

  private resolveMethod(methodId: string): Method | undefined {
    return this.bundle.methods.find(
      (m: Method) => m["id"] === methodId,
    );
  }

  private resolveDvo(dvoId: string): Method | undefined {
    return this.bundle.dvos.find(
      (d: Method) => d["id"] === dvoId,
    );
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
    const effects = method["stateEffects"] as Record<string, string[]> | undefined;
    if (!effects) return;
    this.state.applyCreates(effects["creates"] ?? [], effects["generates"] ?? []);
    this.state.applyDeletes(effects["deletes"] ?? []);
  }

  private buildSuccessResponse(method: Method): CallResult {
    const response: CallResult = {
      sonucKodu: "0000",
      sonucMesaji: "Islem basari ile tamamlandi.",
    };
    for (const [key, value] of this.state.identifiers) {
      response[key] = value;
    }
    // Output DVO composite: takipler for hasta-kabul (ProvizyonCevapDVO).
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
    return response;
  }

  private replayScenario(
    scenarioId: string,
    state: EpisodeState,
  ): CallResult {
    const scenario = this.bundle.scenarios.find(
      (s: Method) => s["id"] === scenarioId,
    );
    if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
    const expected = scenario["expected"] as Record<string, unknown>;
    const result = expected["result"] as Record<string, string>;
    const stateChanges = expected["stateChanges"] as
      | Record<string, unknown>
      | undefined;
    if (stateChanges && Array.isArray(stateChanges["creates"])) {
      state.applyCreates(stateChanges["creates"] as string[], []);
    }
    return {
      sonucKodu: result["sonucKodu"],
      sonucMesaji: result["sonucMesaji"] ?? "",
    };
  }
}
