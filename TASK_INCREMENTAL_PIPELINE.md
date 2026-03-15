# TASK: Implement Incremental Hot Pipeline with Daily Cold Rebuild

This task file is for Codex or another coding agent working inside this repo.

Read `docs/incremental-pipeline-spec.md` first. Treat that spec as the source of truth.

## Objective

Implement the scaffolding and phased rollout for an incremental hot pipeline that runs every 5 minutes, while preserving a daily cold canonical rebuild at 01:00.

Do **not** replace the current full rebuild path in one step.

## Product Constraints

1. Preserve current dashboard semantics.
2. Preserve crossing detection correctness, including long-gap reappearances.
3. Preserve current published artifact shapes unless explicitly changed and documented.
4. Cold rebuild remains canonical truth.
5. Hot and cold writers must never publish simultaneously.

## Key Architectural Rules

1. Crossing detection must use persistent per-ship memory, not only recent source-file replay.
2. UI windows (latest / 24h / 48h) are not sufficient as the sole source of truth for crossings.
3. Incremental logic must preserve side-memory for ships beyond 24h/48h windows.
4. Daily cold rebuild resets canonical truth and checkpoints.

## Implementation Phases

### Phase 1: Scaffolding only

Add the foundations without changing live behavior.

Deliverables:
- state directory structure under a new `state/` location
- checkpoint schema and load/save helpers
- lock file helpers for hot/cold exclusion
- JSONL helpers for ledgers/state persistence
- baseline version metadata handling

Do not switch the main processing path yet.

### Phase 2: Ship-state model and transition engine

Implement:
- point/zone classification helpers
- ship-state schema handling
- transition/state-machine logic for crossing updates
- append/update path for crossings ledger

Constraints:
- preserve existing crossing semantics as closely as possible
- document assumptions explicitly where exact prior semantics are unclear

### Phase 3: Shadow incremental ingest

Implement a separate incremental runner that:
- reads checkpoints
- fetches only new source objects
- updates ship state and ledgers
- writes shadow outputs or comparison snapshots

Do not yet replace the production full rebuild outputs.

### Phase 4: Rolling artifact generation

Generate latest / 24h / 48h artifacts from rolling state in shadow mode.

Required artifact compatibility:
- processed_core.json
- processed_paths.json
- processed_candidates.json
- processed_playback_latest.json
- processed_shipmeta_latest.json
- processed_external_latest.json
- processed_playback_24h.json
- processed_shipmeta_24h.json
- processed_external_24h.json
- processed_playback_48h.json
- processed_shipmeta_48h.json
- processed_external_48h.json

### Phase 5: Reconciliation reporting

Add a machine-readable diff/report that compares hot incremental outputs against cold rebuild outputs.

Minimum comparisons:
- crossing counts
- direction counts
- candidate counts
- latest timestamps
- recent crossing IDs
- recent candidate IDs

### Phase 6: Promotion hooks

Only after shadow parity is acceptable:
- allow hot incremental to publish live outputs
- keep daily cold rebuild as canonical reset

## Deliverable Expectations

For each phase:
- keep changes scoped
- update docs if behavior or file layout changes
- leave clear TODOs where later phases are expected
- do not collapse all phases into a single giant refactor if avoidable

## Safety Constraints

1. Do not delete the current cold rebuild path.
2. Do not remove current artifact writers until replacement is validated.
3. Do not assume recent-window replay alone is enough for crossings.
4. Do not introduce concurrent hot/cold publication.
5. Do not silently change public artifact fields without documenting it.

## What to Read Before Coding

1. `docs/incremental-pipeline-spec.md`
2. current data builder and upload scripts
3. current frontend artifact expectations in `src/app/page.tsx`

## Suggested Initial PR/Change Breakdown

1. PR 1: state schemas + lock/checkpoint utilities
2. PR 2: ship-state transition engine + tests
3. PR 3: shadow incremental runner
4. PR 4: rolling artifact generation
5. PR 5: diff/reconciliation report
6. PR 6: hot publish promotion + scheduler integration

## Acceptance Criteria for Codex

Your implementation is acceptable only if:
- it is phased
- it preserves current dashboard behavior during rollout
- it keeps cold rebuild canonical
- it introduces explicit reconciliation, not blind trust in incremental output
- it documents assumptions and unresolved questions clearly

## Output Requirements

When working on this task:
- explain which phase you are implementing
- summarize changed files
- describe any assumptions made
- describe how correctness was validated
- do not claim the full incremental system is production-ready unless shadow validation and reconciliation are implemented
