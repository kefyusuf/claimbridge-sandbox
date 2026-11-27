/**
 * Episode state map: two separate stores per the sandbox PRD §3 —
 * `entities` (workflow state) and `identifiers` (generated values).
 * The spec's `creates` lists mix both; this class separates them
 * by convention (entity names are known workflow artifacts, identifier
 * names are generated values like hastaBasvuruNo).
 */

export const IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "hastaBasvuruNo",
  "takipNo",
  "islemSiraNo",
  "islemSiraNumaralari",
  "hizmetKayitReferansNo",
  "faturaTeslimNo",
  "faturaTutari",
  "bildirimNo",
  "takipFormuNo",
  "taahhutNo",
  "formNo",
  "raporTakipNo",
]);

// Module-scoped monotonic counter: generated identifiers must stay
// distinct across episodes too — two independent flows cannot share a
// synthetic value, so a fresh EpisodeState does NOT reset the sequence.
let globalIdentifierCounter = 0;

export class EpisodeState {
  readonly entities: Map<string, string> = new Map();
  readonly identifiers: Map<string, string> = new Map();

  applyCreates(creates: string[], generates: string[]): void {
    for (const name of creates) {
      this.entities.set(name, `SYNTHETIC_${name.toUpperCase()}`);
    }
    for (const name of generates) {
      if (!IDENTIFIER_NAMES.has(name)) continue;
      globalIdentifierCounter += 1;
      this.identifiers.set(
        name,
        `SYNTHETIC_${name.toUpperCase()}_${String(globalIdentifierCounter).padStart(6, "0")}`,
      );
    }
  }

  /**
   * Generates one fresh value for a known identifier name and tracks it
   * on the state — used when a single call produces several identifier
   * values (one islemSiraNo per registered service line, guide s.235).
   */
  generate(name: string): string | null {
    if (!IDENTIFIER_NAMES.has(name)) return null;
    globalIdentifierCounter += 1;
    const value = `SYNTHETIC_${name.toUpperCase()}_${String(globalIdentifierCounter).padStart(6, "0")}`;
    this.identifiers.set(name, value);
    return value;
  }

  applyDeletes(deletes: string[]): void {
    for (const name of deletes) {
      this.entities.delete(name);
    }
  }

  canRun(requires: string[]): boolean {
    return requires.every((r) => this.entities.has(r));
  }
}
