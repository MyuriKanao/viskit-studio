# EPIC-0 → EPIC-1 Hand-off Report

**Status:** EPIC-0 acceptance: 7/7 plan ACs satisfied (pending verification)

---

## Delivered Artifacts

- **US-0.1** — `Makefile` with full target set (`bootstrap`, `compose-up/down/logs`, `dev`, `test`,
  `lint`, `typecheck`, `migrate`, `seed-user`, `seed-sample-kit`, `grep-providers`, `schemas`,
  `ingest-corpus`); `.env.example`; `.editorconfig`; `.gitignore`; `.pre-commit-config.yaml`

- **US-0.2** — `infra/docker-compose.yml` with Postgres 16, MinIO, Milvus standalone, Redis;
  healthchecks on all services; named volumes

- **US-0.3** — `infra/migrations/` SQL schema for `users`, `marketing_kits`, `hero_images`,
  `detail_images`, `image_edits`, `cost_events`; `scripts/migrate.py` runner

- **US-0.4** — `apps/api/` FastAPI skeleton with `GET /health`, `GET /kits`, `POST /kits`,
  `GET /kits/{id}`; Pydantic models; psycopg connection pool; Dockerfile

- **US-0.5** — `packages/schemas/` shared Zod + Pydantic definitions; `make schemas` codegen target

- **US-0.6** — `config.yaml.example` with full provider catalog (image-gen, copywriter, compliance,
  retrieval); `apps/api/config.py` loader; `services/providers/` stub structure

- **US-0.7** — `scripts/seed_user.py`: bcrypt work-factor-12 hash; OD-5 strict existence predicate;
  `--password` flag + interactive fallback; `make seed-user PASSWORD=` passthrough

- **US-0.8** — `scripts/seed_sample_kit.py`: pure-Python PNG encoder (no PIL); 5 hero (32×32) +
  9 detail (32×48) solid-color placeholders; MinIO upload + `marketing_kits` / `hero_images` /
  `detail_images` / `image_edits` DB inserts; idempotent

- **US-0.9** — `scripts/grep_providers.sh`: Python-backed vendor-leak scanner; allowlist for
  `services/providers/`, `config.yaml.example`, `tests/`, `docs/`, `demo/`, `.omc/`, `.github/`,
  `README.md`, `.pre-commit-config.yaml`; skips comment lines and binary files; exits 1 on any hit

- **US-0.10** — `.github/workflows/ci.yml` (lint + build + python + grep-providers jobs with uv/pnpm
  caching); `README.md` (overview, ASCII arch tree, Mermaid flow, bootstrap steps, targets table,
  provider abstraction note, reference projects, plan links); this handoff document

---

## EPIC-1 Prerequisites Checklist

- [ ] `config.yaml.example` extended with full role catalog including `compliance_screen`
- [ ] `services/providers/base.py` — Protocol classes (`ImageGenProvider`, `CopyProvider`,
      `ComplianceProvider`, `RetrievalProvider`)
- [ ] `services/providers/_http.py` — shared retry session (tenacity + httpx)
- [ ] `services/providers/cost.py` — writes to `cost_events` table on every provider call
- [ ] Spike script `scripts/spike_chinese_fail_rate.py` — measures OCR false-positive rate on
      Chinese product copy across candidate image-gen providers
- [ ] Hard gate: `.omc/research/chinese-text-fail-rate-spike.md` — spike results must show
      ≤5 % false-positive rate before EPIC-1 compliance work begins

---

## Open Questions Snapshot

See [`.omc/plans/open-questions.md`](.omc/plans/open-questions.md) for the full list. Key
unresolved items at EPIC-0 close:

1. Which image-gen provider achieves acceptable Chinese-text render fidelity at scale?
2. Milvus vs. pgvector for retrieval — decision deferred to EPIC-2 spike.
3. Compliance OCR provider selection (Tesseract self-hosted vs. managed API).
4. Brand-color lock tolerance threshold (ΔE ≤ 3 or ΔE ≤ 5?).

---

## Recommended Next Ralph Cycle

```
ralph EPIC-1 Providers Abstraction
```

Start with the Protocol class spike, then the Chinese-text fail-rate spike, before any provider
implementation work. The hard gate on `.omc/research/chinese-text-fail-rate-spike.md` must be
satisfied before EPIC-1 acceptance.
