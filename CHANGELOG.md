# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). One line per merged change.

## [Unreleased]

### Added
- Go backend BE4–BE9: policy gate, validator, detectors, board merge; all `docs/api.md` endpoints; investigate agent loop over SSE with replay; metrics + `make eval`; e2e contract suite (`make smoke`).
- Go backend BE1–BE3: skeleton (`backend/`, compose, migrations, `/health`, Makefile), entities + `0001_init.sql`, deterministic seed port.
- Frontend in `frontend/`: typed API client (http + in-browser mock agent-loop replay), policy-gate mock, SSE investigate panel, metrics strip.
- API contract v1 (`docs/api.md`) and BE/FE track split in the execution plan.
- Execution plan for the Go + Postgres port (`docs/execution-plan.md`).
- Go + Postgres rules in `CLAUDE.md`; kickoff prompt merged; spec fixed to 7 cases + metrics.
- Idea doc `docs/ideas/serhii-verdict.md` and spec `docs/specs/verdict-backbone.md`.
- Serhii's VERDICT and ARCHITECTURE docs (`docs/ideas/serhii/`) for comparison with the team version.
- Next.js scaffold, hackathon brief, criteria and decisions docs.
