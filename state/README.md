# Incremental Pipeline State

This directory is reserved for the phased incremental pipeline state described in
`docs/incremental-pipeline-spec.md`.

Phase 1 only adds the scaffold and helper modules. The live rebuild/upload path
does not read from or write to this directory yet.

Intended runtime files:

- `checkpoints.json`
- `ship_state.jsonl`
- `crossings-ledger.jsonl`
- `linkage-ledger.jsonl`
- `candidate-ledger.jsonl`
- `publish-meta.json`
- `cold-baseline.json`
- `pipeline.lock`
