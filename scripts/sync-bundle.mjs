// Syncs the pinned spec bundle from the spec repo's main branch.
// The committed copy changes only when the spec itself changes.
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

const SPEC_RAW =
  "https://raw.githubusercontent.com/kefyusuf/claimbridge-medula-spec/main/dist/claimbridge-medula-spec.json";

mkdirSync("fixtures", { recursive: true });

const res = await fetch(SPEC_RAW);
if (!res.ok) {
  console.error(`sync-bundle: fetch failed — HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.text();
JSON.parse(body); // fail fast on invalid JSON
writeFileSync("fixtures/bundle.json", body);
console.log(`sync-bundle: ${body.length} bytes written to fixtures/bundle.json`);
