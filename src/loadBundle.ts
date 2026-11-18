import { readFileSync } from "node:fs";

export interface BundleCollection {
  id: string;
  [key: string]: unknown;
}

export interface Bundle {
  specVersion: string;
  sources: BundleCollection[];
  services: BundleCollection[];
  methods: BundleCollection[];
  dvos: BundleCollection[];
  enums: BundleCollection[];
  rules: BundleCollection[];
  workflows: BundleCollection[];
  scenarios: BundleCollection[];
}

const REQUIRED_COLLECTIONS = [
  "specVersion",
  "sources",
  "services",
  "methods",
  "dvos",
  "enums",
  "rules",
  "workflows",
  "scenarios",
] as const;

export function loadBundle(path: string): Bundle {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  for (const key of REQUIRED_COLLECTIONS) {
    if (!(key in parsed)) {
      throw new Error(`bundle missing collection: ${key}`);
    }
  }
  return parsed as unknown as Bundle;
}
