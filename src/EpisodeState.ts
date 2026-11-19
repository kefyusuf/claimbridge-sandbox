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
]);

export class EpisodeState {
  readonly entities: Map<string, string> = new Map();
  readonly identifiers: Map<string, string> = new Map();
  private counter = 0;

  applyCreates(creates: string[], generates: string[]): void {
    for (const name of creates) {
      this.entities.set(name, `SYNTHETIC_${name.toUpperCase()}`);
    }
    for (const name of generates) {
      if (!IDENTIFIER_NAMES.has(name)) continue;
      this.counter += 1;
      this.identifiers.set(
        name,
        `SYNTHETIC_${name.toUpperCase()}_${String(this.counter).padStart(6, "0")}`,
      );
    }
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
