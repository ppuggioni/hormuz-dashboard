# Incremental Pipeline Spec for Hormuz Dashboard

## Status

Proposed architecture and rollout plan.

This document defines the target design for replacing the current frequent full rebuild model with a hot incremental pipeline plus a daily cold rebuild, while preserving crossing-detection correctness.

## Problem Statement

The current refresh path effectively performs a large replay/rebuild from raw storage-backed source data on a frequent cadence. As source history grows, the cost of each run grows as well. That makes 5-minute rebuilds increasingly expensive in CPU, I/O, and wall-clock time.

At the same time, crossing detection is stateful and can depend on observations that are much older than the UI windows shown on the site. A ship may be last credibly seen on one side of Hormuz and only reappear days later on the other side. An incremental design must preserve this semantic memory without requiring a full replay every 5 minutes.

## Goals

1. Introduce a **hot incremental** processing path that runs every 5 minutes.
2. Keep a **cold canonical full rebuild** that runs once per day at 01:00.
3. Ensure hot and cold pipelines never publish simultaneously.
4. Preserve current published artifact compatibility unless explicitly revised.
5. Preserve or improve crossing detection correctness.
6. Reduce per-run processing cost and make the frequent path scale with new data volume rather than total historical volume.
7. Support latest / 24h / 48h dashboard artifacts efficiently.

## Non-Goals

1. Immediate migration to a full database-backed processing architecture.
2. Redefinition of product semantics for crossings, candidate dark crossers, or linkage events.
3. One-shot removal of the current full rebuild path before shadow validation.
4. Real-time streaming; 5-minute incremental cadence is sufficient.

## Core Design Principles

### 1. Separate long-lived ship memory from short-lived UI windows

Published UI artifacts may only need latest / 24h / 48h windows, but crossing correctness requires durable ship state beyond those windows.

### 2. Treat crossing detection as a state machine

Do not infer crossings in the hot path by replaying recent files only. Persist per-ship crossing state and update it incrementally as new observations arrive.

### 3. Cold rebuild is canonical truth

The daily cold rebuild remains the authoritative reconciliation mechanism. Incremental state may drift; cold rebuild resets canonical truth and checkpoints.

### 4. Single writer rule

Only one pipeline mode may publish outputs at a time. Hot and cold runs must not overlap artifact publication.

## Scheduling Model

### Hot Incremental
- Cadence: every 5 minutes
- Purpose: consume only new source files since checkpoint, update state, publish rolling artifacts
- Constraint: skip if cold rebuild lock is active

### Cold Rebuild
- Cadence: daily at 01:00 local deployment time
- Purpose: full replay from raw source truth, rebuild state and outputs from scratch
- Constraint: acquires exclusive pipeline lock

### Overlap Policy
- Hot runs must exit early if cold lock exists.
- Cold rebuild should start in a maintenance window; hot runs between 00:55 and cold completion may be skipped.
- After cold success, hot checkpoints are advanced to the cold baseline.

## Persistence Layout

Initial implementation can be file-based under a dedicated `state/` directory.

Suggested layout:

- `state/checkpoints.json`
- `state/ship_state.jsonl`
- `state/crossings-ledger.jsonl`
- `state/linkage-ledger.jsonl`
- `state/candidate-ledger.jsonl`
- `state/publish-meta.json`
- `state/cold-baseline.json`
- `state/pipeline.lock`

If needed later, this can migrate to SQLite/Postgres without changing the public artifact contract.

## Checkpoint Schema

`state/checkpoints.json`

```json
{
  "regions": {
    "hormuz": {
      "lastIndexVersion": "2026-03-15T22:35:54Z",
      "lastProcessedObject": "hormuz/2026-03-15/file.csv",
      "lastProcessedRunUtc": "2026-03-15T22:35:54Z"
    },
    "suez": {
      "lastIndexVersion": null,
      "lastProcessedObject": null,
      "lastProcessedRunUtc": null
    }
  },
  "lastHotRunAt": "2026-03-15T22:40:00Z",
  "lastColdRunAt": "2026-03-15T01:08:00Z",
  "baselineVersion": "cold-2026-03-15T01:08:00Z"
}
```

## Ship State Schema

Each record in `state/ship_state.jsonl` should contain at least:

```json
{
  "shipId": "1234567",
  "shipName": "EXAMPLE",
  "vesselType": "tanker",
  "flag": "PA",

  "lastSeenAt": "2026-03-15T22:35:54Z",
  "lastSeenRegion": "hormuz",
  "lastPoint": {
    "lat": 25.123,
    "lon": 56.456,
    "t": "2026-03-15T22:35:54Z"
  },

  "lastKnownZone": "outside_west",
  "lastKnownSide": "west",
  "lastStrongSideAt": "2026-03-15T22:35:54Z",

  "everSeenWest": true,
  "everSeenEast": false,
  "lastSeenWestAt": "2026-03-15T22:35:54Z",
  "lastSeenEastAt": null,

  "pendingTransition": {
    "status": "open",
    "fromSide": "west",
    "startedAt": "2026-03-15T22:35:54Z",
    "lastEvidenceAt": "2026-03-15T22:35:54Z"
  },

  "lastConfirmedCrossingAt": null,
  "lastConfirmedCrossingDirection": null,

  "recentPoints": [],
  "tailPoints": [],

  "updatedAt": "2026-03-15T22:35:54Z",
  "baselineVersion": "cold-2026-03-15T01:08:00Z"
}
```

## Crossing Semantics

### Key Requirement

Crossing correctness must not rely on replaying only recent source files. The system must retain ship-side memory for long enough to support delayed reappearance logic.

### Point Classification

Each observation should be classified into a stable zone enum, for example:
- `outside_west`
- `inside_corridor`
- `outside_east`
- `unknown`

Optional finer-grained approach zones may be added if already present in the current logic.

### State Machine Rules

For each new observation for a ship:

1. Load prior ship state.
2. Classify the new point into a zone / side.
3. Compare prior credible side/zone to new credible side/zone.
4. Apply transitions:
   - same-side continuation -> update memory only
   - west-to-east evidence -> confirm `west_to_east` crossing
   - east-to-west evidence -> confirm `east_to_west` crossing
   - ambiguous gap -> keep pending transition open
   - long-gap reappearance on opposite side -> allow inferred crossing if prior side memory is sufficiently credible according to product rules
5. Update ship memory, ledgers, recent points, and timestamps.

### Long-Gap Reappearance Rule

A ship may disappear and reappear days later. The incremental design must preserve enough side memory to support this. Therefore:
- side memory must outlive 24h/48h UI windows
- `lastSeenWestAt`, `lastSeenEastAt`, `lastKnownSide`, and transition context must be retained for an extended period
- recent point tails may be trimmed aggressively, but side memory must not be

## Recent Point Retention

To limit state growth, retain bounded point history in ship state:
- `recentPoints`: optional bounded queue, e.g. last N points or last X days
- `tailPoints`: only what candidate heuristics need

Suggested initial retention:
- recent points: max 50 points per ship
- candidate tail points: max 10 points per ship
- side memory: retain for at least 30 days, preferably reset by daily cold rebuild rather than time expiry alone

## Ledgers

### Crossings Ledger

`state/crossings-ledger.jsonl`

Append canonical confirmed crossings with stable IDs:

```json
{
  "crossingId": "1234567|2026-03-15T12:34:56Z|west_to_east",
  "shipId": "1234567",
  "shipName": "EXAMPLE",
  "vesselType": "tanker",
  "direction": "west_to_east",
  "t": "2026-03-15T12:34:56Z",
  "source": "incremental",
  "baselineVersion": "cold-2026-03-15T01:08:00Z"
}
```

### Candidate Ledger

`state/candidate-ledger.jsonl`

Store current/historical candidate events derived from maintained ship tails and rolling windows.

### Linkage Ledger

`state/linkage-ledger.jsonl`

Store linkage events incrementally rather than recomputing from scratch in each hot run.

## Published Artifact Contract

The site should continue to receive these artifacts:

- `processed_core.json`
- `processed_paths.json`
- `processed_candidates.json`
- `processed_playback_latest.json`
- `processed_shipmeta_latest.json`
- `processed_external_latest.json`
- `processed_playback_24h.json`
- `processed_shipmeta_24h.json`
- `processed_external_24h.json`
- `processed_playback_48h.json`
- `processed_shipmeta_48h.json`
- `processed_external_48h.json`

Hot path should generate these from rolling state/ledgers rather than by replaying all history.

## Hot Path Algorithm

1. Acquire shared/exclusive pipeline guard or verify no cold lock exists.
2. Load checkpoints.
3. Fetch per-region index deltas and identify only new source objects.
4. Read and normalize only new raw files.
5. For each normalized observation:
   - update ship state
   - update crossings ledger
   - update candidate/linkage ledgers as needed
6. Update rolling latest/24h/48h stores.
7. Regenerate published artifacts from state + rolling stores.
8. Publish outputs atomically.
9. Advance checkpoints.
10. Record hot-run metadata.

## Cold Path Algorithm

1. Acquire exclusive pipeline lock.
2. Perform full replay from raw source of truth.
3. Rebuild ship state from scratch.
4. Rebuild crossings / linkage / candidate ledgers from scratch.
5. Rebuild all published artifacts from scratch.
6. Write new canonical baseline version.
7. Replace hot state atomically.
8. Advance checkpoints to cold baseline.
9. Release lock.

## Locking

Use a lock file such as `state/pipeline.lock` with contents like:

```json
{
  "mode": "cold",
  "startedAt": "2026-03-16T01:00:00Z",
  "pid": 12345,
  "host": "pp-bot-mac-mini"
}
```

Rules:
- hot run exits if cold lock exists
- cold run fails fast if another writer lock exists
- stale lock handling must be explicit and conservative

## Validation and Reconciliation

During rollout, incremental must run in shadow mode before promotion.

### Required comparisons

Compare hot vs cold outputs on at least:
- total crossing count
- tanker crossing count
- cargo crossing count
- direction counts
- candidate counts by confidence band
- latest snapshot timestamp
- latest 100 crossing IDs
- latest 100 candidate IDs
- artifact metadata (`generatedAt`, `fromUtc`, `toUtc`)

### Drift Policy

If incremental and cold differ beyond defined thresholds:
- trust cold
- do not silently overwrite cold truth with hot output
- log/report mismatch

## Rollout Plan

### Phase 1: Spec and scaffolding
- add state directory model
- add schemas
- add lock handling
- no behavioral switch yet

### Phase 2: Shadow incremental
- build new incremental runner
- do not publish live outputs yet
- compare against current full rebuild outputs

### Phase 3: Hot publish pilot
- incremental publishes hot outputs
- cold rebuild remains daily canonical reset
- diff reports continue

### Phase 4: Operational hardening
- alerting
- drift dashboards/logs
- stale lock recovery
- failure retry policy

## Acceptance Criteria

1. Hot run processes only new source files since checkpoint.
2. Cold rebuild can reconstruct full state from raw source truth.
3. Crossing logic remains correct for long-gap reappearances.
4. Published artifacts remain compatible with current frontend.
5. Hot and cold writers never overlap.
6. Daily cold rebuild resets canonical truth and checkpoints.
7. Shadow validation demonstrates acceptable parity before promotion.

## Risks

1. Incremental crossing state machine may diverge subtly from full replay logic.
2. Candidate heuristics may rely on more history than initially assumed.
3. State corruption or stale checkpoints could propagate bad outputs.
4. Overlapping hot/cold publishes could create inconsistent artifact sets.

## Risk Mitigations

1. Keep cold rebuild canonical.
2. Shadow-test incremental before promotion.
3. Use explicit versioned baselines.
4. Use atomic writes for state and artifact publication.
5. Emit reconciliation reports after each cold rebuild.

## Recommended Implementation Order

1. Add state schemas and lock semantics.
2. Implement checkpoint storage.
3. Implement ship-state persistence and updater.
4. Implement shadow incremental ingest.
5. Implement rolling artifact builder.
6. Implement hot-vs-cold diff reporting.
7. Promote hot incremental publish.
8. Keep daily cold rebuild as canonical safety net.
