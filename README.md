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

**v0.4.0 — M0-M4 complete.** The sandbox runs the full `core-claim-flow`
workflow (patient admission → service registration → invoice registration)
end-to-end via `runWorkflow`, with DVO validation, a bundle-driven rules
layer, read preconditions, duplicate-invoice detection, and verbatim replay
of all six scenario contracts. See the
[sandbox PRD](https://github.com/kefyusuf/claimbridge-medula-spec/blob/main/docs/CLAIMBRIDGE_SANDBOX_PRD.md)
for the full handoff.

## Quick start

```bash
pnpm install
pnpm test
pnpm sync-bundle   # refresh the pinned spec bundle from the spec repo release
pnpm serve         # start the session-based HTTP service on 127.0.0.1:8123
```

## HTTP service (S2)

`pnpm serve` starts a session-based HTTP layer over the router (plain
`node:http`, zero additional dependencies; node >= 22.18 or >= 23.6 for
native type stripping):

```
POST   /sessions            → { "sessionId": "S000001" }
POST   /sessions/:id/call   → { methodId, request, scenarioId? } → CallResult JSON
DELETE /sessions/:id        → 204
```

Each session owns one `EpisodeState` — episode state persists across calls
within a session, enabling full claim flows over HTTP. Unknown session → 404
`SANDBOX_1001`; bad JSON / unknown method → 400 `SANDBOX_BAD_REQUEST`.

## Bundle sync

The spec bundle is committed as `fixtures/bundle.json` (a pinned copy of
the spec repo's generated output). `pnpm sync-bundle` refreshes it from
the spec repo's `main` branch; the committed copy changes only when the
spec itself changes.
