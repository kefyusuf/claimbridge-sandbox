/**
 * Sandbox router: loads the spec bundle, resolves the method contract,
 * validates requests against the input DVO, applies workflow state
 * effects, and replays scenario contracts.
 */
import { loadBundle, type Bundle } from "./loadBundle.ts";
import { EpisodeState, IDENTIFIER_NAMES } from "./EpisodeState.ts";
import { RulesLayer } from "./RulesLayer.ts";

export interface CallResult {
  sonucKodu: string;
  sonucMesaji: string;
  [key: string]: unknown;
}

export interface WorkflowStepResult {
  stepId: string;
  result: CallResult;
}

type Method = Record<string, unknown>;
type DvoField = Record<string, unknown>;

/** Readable labels for entity names surfaced in read-precondition errors. */
const READ_LABELS: Record<string, string> = {
  takip: "Takip",
  serviceRecord: "Hizmet kaydi",
  patientAdmission: "Hasta basvurusu",
  invoiceRecord: "Fatura",
};

/**
 * Scenario-contract-specific precondition codes: when a bundle scenario
 * pins a distinct SANDBOX_* code for a (method, missing entity) pair
 * (sandbox PRD §15.4), that contract wins over the generic SANDBOX_1001.
 */
const PRECONDITION_CODES: Record<string, Record<string, CallResult>> = {
  "medula.hastane.fatura-kayit.fatura-kayit": {
    serviceRecord: {
      sonucKodu: "SANDBOX_2001",
      sonucMesaji: "Kayitli hizmet bulunamadi.",
    },
  },
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

  /**
   * Runs a bundle workflow end-to-end: resolves the step order from the
   * spec, injects state identifiers into each step request (explicit
   * request fields win), and stops the chain at the first failing step.
   */
  runWorkflow(
    workflowId: string,
    requests: Record<string, Record<string, unknown>>,
  ): WorkflowStepResult[] {
    const workflow = this.bundle.workflows.find(
      (w: Method) => w["id"] === workflowId,
    );
    if (!workflow) throw new Error(`unknown workflow: ${workflowId}`);
    const steps = (workflow["steps"] as Array<Method>) ?? [];
    const results: WorkflowStepResult[] = [];
    for (const step of steps) {
      const stepId = step["id"] as string;
      const unmet = ((step["requires"] as string[]) ?? []).find(
        (name) =>
          !this.state.entities.has(name) && !this.state.identifiers.has(name),
      );
      if (unmet) {
        results.push({
          stepId,
          result: {
            sonucKodu: "SANDBOX_1001",
            sonucMesaji: `Workflow on kosulu saglanmiyor - ${unmet}`,
          },
        });
        break;
      }
      const request: Record<string, unknown> = {
        ...Object.fromEntries(this.state.identifiers),
        ...(requests[stepId] ?? {}),
      };
      const result = this.call(step["method"] as string, request);
      results.push({ stepId, result });
      if (result["sonucKodu"] !== "0000") break;
    }
    return results;
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
    const methodId = method["id"] as string;
    for (const name of reads) {
      if (IDENTIFIER_NAMES.has(name)) continue;
      if (this.state.entities.has(name)) continue;
      const override = PRECONDITION_CODES[methodId]?.[name];
      if (override) return override;
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
      response["islemBilgileri"] = this.registeredIslemler(request);
    }
    this.composeFromOutputDvo(method, request, response);
    return response;
  }

  /** HizmetKayitGirisDVO's service-line arrays (guide §4.1.2.a). */
  private static readonly SERVICE_LINE_FIELDS = [
    "ameliyatveGirisimBilgileri",
    "digerIslemBilgileri",
    "disBilgileri",
    "ilacBilgileri",
    "konsultasyonBilgileri",
    "malzemeBilgileri",
    "tahlilBilgileri",
    "tetkikveRadyolojiBilgileri",
    "hastaYatisBilgileri",
    "kanBilgileri",
  ];

  /**
   * Guide s.235 (Tablo 4.2.1.m): one KayitliIslemBilgisiDVO row per
   * submitted service line — hizmetSunucuRefNo echoes the caller's
   * reference, islemSiraNo is freshly generated per row and the last
   * value stays on the session state.
   */
  private registeredIslemler(
    request: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const field of Sandbox.SERVICE_LINE_FIELDS) {
      const entries = request[field];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          continue;
        }
        const refNo = (entry as Record<string, unknown>)["hizmetSunucuRefNo"];
        rows.push({
          hizmetSunucuRefNo: typeof refNo === "string" ? refNo : null,
          islemSiraNo: this.state.generate("islemSiraNo"),
        });
      }
    }
    return rows;
  }

  /**
   * Generic composition for every group added after M4: walk the output
   * DVO contract and fill each field from generated identifiers, the
   * request echo, or a deterministic empty/default value. Special-cased
   * composites above run afterwards and win.
   */
  private composeFromOutputDvo(
    method: Method,
    request: Record<string, unknown>,
    response: CallResult,
  ): void {
    const contract = method["contract"] as Record<string, unknown> | undefined;
    const outputDvoId = contract?.["outputDvo"] as string | undefined;
    if (!outputDvoId || outputDvoId === "ProvizyonCevapDVO") return;
    if (outputDvoId === "HizmetKayitCevapDVO") return;
    const outputDvo = this.resolveDvo(outputDvoId);
    if (!outputDvo) return;
    const fields = (outputDvo["fields"] as DvoField[]) ?? [];
    for (const f of fields) {
      const name = f["name"] as string;
      const type = String(f["type"] ?? "string");
      if (name === "sonucKodu" || name === "sonucMesaji") continue;
      if (this.state.identifiers.has(name)) {
        response[name] = this.state.identifiers.get(name);
        continue;
      }
      if (
        name in request &&
        request[name] !== null &&
        request[name] !== undefined
      ) {
        response[name] = request[name];
        continue;
      }
      if (type === "array") {
        response[name] = [];
        continue;
      }
      if (type === "object") {
        response[name] = {};
        continue;
      }
      if (f["required"] === true) {
        if (type === "integer") response[name] = 1;
        else if (type === "decimal") response[name] = 1;
        else if (type === "boolean") response[name] = true;
        else response[name] = `SYNTHETIC_${name.toUpperCase()}`;
        continue;
      }
      response[name] = null;
    }
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
    // The replayed scenario's own method decides which identifiers the
    // step generates — a 9000-warning replay still produces takipNo, so
    // the episode can continue with the created takip state.
    const method = this.bundle.methods.find(
      (m: Method) => m["id"] === scenario["method"],
    );
    const generates =
      ((method?.["stateEffects"] as Record<string, unknown> | undefined)?.[
        "generates"
      ] as string[] | undefined) ?? [];
    if (stateChanges && Array.isArray(stateChanges["creates"])) {
      state.applyCreates(
        stateChanges["creates"] as string[],
        Array.isArray(generates) ? generates : [],
      );
    }
    return {
      sonucKodu: result["sonucKodu"],
      sonucMesaji: result["sonucMesaji"] ?? "",
    };
  }
}
