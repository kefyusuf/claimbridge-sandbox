# claimbridge-sandbox

Stateful sandbox emulating the MEDULA-compatible claim flow defined by
[claimbridge-medula-spec](https://github.com/kefyusuf/claimbridge-medula-spec).

Loads the published bundle (`dist/claimbridge-medula-spec.json`, v0.3.0+),
maintains episode state, validates requests against DVO/rule contracts,
replays scenario contracts, and returns responses matching the verified
result patterns.

> **No live SGK connection. No real patient data.** See the spec repo's
> [DISCLAIMER](https://github.com/kefyusuf/claimbridge-medula-spec/blob/main/DISCLAIMER.md).

## Status

M0 (bootstrap): bundle loader + episode state map. See the
[sandbox PRD](https://github.com/kefyusuf/claimbridge-medula-spec/blob/main/docs/CLAIMBRIDGE_SANDBOX_PRD.md)
for the full handoff.

## Quick start

```bash
pnpm install
pnpm test
pnpm sync-bundle   # refresh the pinned spec bundle from the spec repo release
```

## Bundle sync

The spec bundle is committed as `fixtures/bundle.json` (a pinned copy of
the spec repo's generated output). `pnpm sync-bundle` refreshes it from
the spec repo's `main` branch; the committed copy changes only when the
spec itself changes.
