# Deep Interview Spec: EPIC-7 — Hero Pages (Dashboard / Kit Detail / Providers / Onboarding)

## Metadata
- Interview Date: 2026-05-11
- Rounds: 5
- Final Ambiguity Score: 4.3%
- Type: brownfield
- Threshold: 20%
- Status: PASSED
- Plan reference: `.omc/plans/aishop-studio-v1-plan.md` lines 381-401
- Sibling spec: `.omc/specs/deep-interview-epic-6-web-shell.md` (EPIC-6 shipped; web shell + atoms + tokens are the foundation)
- Sibling spec (paused): `.omc/state/deep-interview-state-epic-5-paused.json` (EPIC-5 R6 / 8.8% — resumes after EPIC-7 ships)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.96 | 35% | 0.336 |
| Constraint Clarity | 0.95 | 25% | 0.238 |
| Success Criteria | 0.95 | 25% | 0.238 |
| Context Clarity | 0.97 | 15% | 0.146 |
| **Total Clarity** | | | **0.957** |
| **Ambiguity** | | | **0.043 (~4.3%)** |

## Goal

Ship the four hero screens — `/dashboard`, `/kits/[id]`, `/providers`, `/onboarding` — as production Next.js 14 App Router routes wired to **five newly-implemented FastAPI routes**, with ADR-010 v2 lock semantics (LOCK_EX 5s → 503; SHA-256 checksum mismatch → 409 with full on-disk YAML in body), a three-pane conflict-resolution dialog (react-diff-view + shadcn Dialog), a custom-SVG Sankey for active routing visualization with a `compliance_screen_unbound` warning chip, an onboarding-gate Next.js middleware (querying FastAPI's `/api/onboarding/needed` whose predicate is `EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL AND length(password_hash) > 0)`), a deterministic seed-fixture-driven Playwright visual regression suite (full-page snapshots, no mask), and a CSS-only 80ms SSE fade-in stagger for kit-detail image arrivals.

This EPIC closes the demo-fidelity gap on the four design-brief-screen hero surfaces (EPIC-6 shipped shell chrome with Placeholder content). Together with EPIC-6 it constitutes the human-facing workbench.

## Constraints (locked decisions)

1. **Single bundled epic** (R1): EPIC-7 owns BOTH the 5 missing backend routes AND the 4 frontend pages, single PRD, single ralph cycle. Estimated ~2.4w per plan.
2. **5 new backend routes + 2 new lib functions** (R1):
   - `GET /api/metrics/weekly` (Dashboard KPI strip; returns `{kits_this_week, avg_compliance, avg_manual_edit_min, api_spend_usd_mtd, sparks}`).
   - `GET /api/kits?recent=true&limit=N` (Dashboard kit cards; extends existing `apps/api/routes/kits.py`).
   - `GET /api/queue/active` (Dashboard queue strip; returns `[{kit_name, sku, locale, stages, current_stage, eta_ms}]`).
   - `POST /api/providers/endpoints` (Providers save-endpoint; uses ADR-010 v2 protocol).
   - `GET /api/providers/health` (Providers Sankey + status; returns per-endpoint `{endpoint_id, role, status, latency_ms, last_check}`).
   - `GET /api/onboarding/needed` (Onboarding gate; returns `{needs_onboarding: bool}` based on v2 predicate).
   - New helper module `apps/api/lib/config_io.py` (ADR-010 v2): `class ConfigIO` with `save(new_yaml, expected_sha256)` using `fcntl.LOCK_EX` (5s timeout → `LockTimeout`), `sha256(current).hexdigest()` checksum check (→ `ChecksumMismatch` with `current_yaml`), `atomic_replace` write.
3. **ADR-010 conflict-resolution dialog UI** (R2): `react-diff-view@~3.x` (~30KB, MIT) wrapped in shadcn `Dialog` primitive (already installed in EPIC-6). 3-column grid: `Your edit` | `On disk now` | `Proposed` (editable textarea). 3 action buttons: `Use on-disk` (force-reload), `Force your edit` (write with new checksum), `Save merged`. Server returns the FULL on-disk YAML in the 409 response body so the client doesn't re-fetch.
4. **Lock + checksum protocol semantics** (R2):
   - On `LOCK_EX` acquire timeout 5s → HTTP 503 `{code: 'CONFIG_LOCKED', retry_after_s: 2}` + `Retry-After: 2` header.
   - On checksum mismatch → HTTP 409 `{code: 'CHECKSUM_MISMATCH', current_yaml, current_sha256}`.
   - On success → 200 `{new_sha256}`.
   - Atomic write: `tempfile` in same dir + `os.replace()` (POSIX atomic rename).
5. **Visual regression: seed-driven fixtures, NO masking** (R3):
   - New script `scripts/seed_dashboard_fixtures.py`: idempotently inserts 6 fixed kits, 1 `weekly_metrics` row, 4 `queue_jobs` rows, 5 `provider_endpoints` rows + 5 `provider_health` rows, and ensures `users` table has zero rows (so onboarding-gate test runs).
   - New Makefile target `seed-fixtures: seed-sample-kit seed-dashboard-fixtures`.
   - Playwright `globalSetup` calls `execSync('make seed-fixtures')` before all specs; specs hit real API + real DB.
   - Per-page visual snapshot uses `fullPage: true, maxDiffPixelRatio: 0.03` — NO mask. Demo screenshot baselines committed under `apps/web/tests/web/visual.spec.ts-snapshots/`.
6. **Sankey: custom SVG, zero deps** (R4):
   - `apps/web/components/providers/sankey-routing.tsx` (~150 LOC) takes `{flows: [{role, endpoint, latency_ms}], unbound: string[]}` and draws role-band → endpoint-band ribbons with absolute SVG positioning.
   - `<g role="img" aria-label="Active routing">` + per-band `aria-label` (`${role} band`).
   - AC #8 warning chip = `<ChipOverlay role="compliance_screen" severity="warn" />` rendered conditionally when `unbound.includes('compliance_screen')`; click-to-fix CTA opens `config.yaml` docs anchor in a new tab.
7. **CSS-only SSE fade-in stagger** (R4):
   - `tailwind.config.ts` extends `keyframes['fade-in'] = { from: {opacity: 0}, to: {opacity: 1} }` and `animation['fade-in-stagger'] = 'fade-in 240ms ease-out calc(var(--i) * 80ms) forwards'`.
   - Kit-detail grid cells set `style={{'--i': i}}` and `className="opacity-0 animate-fade-in-stagger"`. NO `framer-motion` dependency.
8. **Onboarding gate: Next.js middleware → FastAPI** (R5):
   - `apps/web/middleware.ts` matcher `['/', '/zh', '/en']`; on root request, `fetch(${NEXT_PUBLIC_API_BASE_URL}/api/onboarding/needed)` (cache: no-store).
   - Locale resolved via `@formatjs/intl-localematcher` from `Accept-Language` header (zh default).
   - Rewrites to `/${locale === 'zh' ? '' : 'en/'}onboarding` or `.../dashboard`.
   - FastAPI `/api/onboarding/needed` runs v2 predicate `EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL AND length(password_hash) > 0)`.
9. **react-markdown + custom renderers for spec column** (R5):
   - `react-markdown@9` + `remark-gfm@4` for tables/strikethrough.
   - `apps/web/components/kit-detail/spec-markdown.tsx` exports `<SpecMarkdown src={markdown} />` with custom renderers: `h1` Instrument Serif 2xl, `h2` Instrument Serif xl with top-margin, `h3` Inter base, `p` Inter sm/leading-relaxed/ink-muted, `code` JetBrains Mono with surface-02 bg, `table` border-soft.
   - Kit-detail spec markdown source: `GET /api/kits/{kit_id}` already returns `spec_markdown` per EPIC-3 — reuse.
10. **Disabled-state cleanup** (auto-locked by R1):
    - `apps/web/lib/nav.ts`: flip `providers.enabled = true` (drop `comingInEpic: 7`). `editor` stays `comingInEpic: 5` (EPIC-5's job).
    - `apps/web/messages/{zh,en}.json`: add labels for Kit Detail / Providers / Onboarding.
11. **Pending state for Kit Detail compliance/cost panels** (inherited from plan AC #1):
    - When the kit row has `compliance_score IS NULL` or `cost_usd IS NULL` (legacy EPIC-4A → 4B contract; EPIC-4B fills both for new kits but seed fixtures may stub), panels render `pending` state with skeleton + label "computing…" — never crash.
12. **Strict `_get_db` dependency** (inherited): new backend routes use the same `asyncpg.Pool` dependency from `apps/api/lib/db.py` as existing routes. No new DB connection pattern.

## Non-Goals
- New Kit wizard (`/new-kit`) — EPIC-8 deliverable. Onboarding option A links to `/new-kit` which serves a `<Placeholder targetEpic={8} />` until EPIC-8 ships.
- Catalog / Vault / Templates / Queue / Settings pages — all EPIC-8.
- `apps/marketing/` landing page — EPIC-11.
- Image editor (`/editor/[image_id]`) — EPIC-5 (resumes after EPIC-7).
- Light-mode polish — EPIC-10.
- Lighthouse perf ≥85 hardening — EPIC-10 perf sweep.
- Multi-user / billing / auth flow beyond the single-tenant predicate — out of v1 scope per project pillar.
- Provider endpoint editing UI beyond add/remove (rename, reorder, bulk import) — v2.
- Sankey animated transitions on endpoint add (just re-render is fine for v1).

## Acceptance Criteria

- [ ] **AC #1 (Click-through dashboard → kit-detail):** With seed fixtures applied, `/zh/dashboard` renders 6 KitCards in a 3-column grid. Clicking the first card (`SKU=NEW001 / 云感针织开衫`) navigates to `/zh/kits/<id>` where 14 images render via the existing `/api/kits/{id}` payload + the EPIC-4B SSE channel hydrating real-time updates. Compliance panel shows the seeded `compliance_score=92` ring; cost dock shows seeded `cost_usd`. Panels with NULL data render `pending` without crashing. Playwright e2e covers the full flow.
- [ ] **AC #2 (Providers Sankey re-renders on endpoint add):** Adding a new endpoint via the modal triggers a TanStack Query invalidation; Sankey re-renders showing the new endpoint band. Modal POST goes through `/api/providers/endpoints` with `expected_sha256`; server validates checksum and writes via `ConfigIO.save()`. Playwright test asserts the new band appears within 200ms of the success toast.
- [ ] **AC #3 (SSE fade-in stagger):** Loading `/zh/kits/<id>` for a kit being generated streams 14 image-arrival events from `/api/kits/{id}/events`. Each newly-arrived `<img>` enters with the CSS `fade-in-stagger` animation (240ms duration, 80ms × index delay). Playwright asserts via `await expect(grid.locator('img').nth(13)).toHaveCSS('animation-delay', '1040ms')` (= 13 × 80ms).
- [ ] **AC #4 (Config conflict-resolution dialog):**
  - **Happy path:** Save endpoint with current checksum → 200 → success toast.
  - **409 path:** Test writes `config.yaml` from a sibling process AFTER the client reads → client saves with stale checksum → 409 → dialog opens with 3 panes (yours / on-disk / proposed-editable). Clicking `Use on-disk` reloads form; `Force your edit` resubmits with new checksum; `Save merged` POSTs the textarea content.
  - **503 path:** A sibling test holds `LOCK_EX` for 7s → client save returns 503 with `Retry-After: 2` → toast shows "Config is locked — retrying in 2s" + auto-retry.
- [ ] **AC #5 (Visual regression, 4 pages, full-page snapshots):** `apps/web/tests/web/visual.spec.ts` (extended) runs `make seed-fixtures` in `globalSetup`, then captures full-page screenshots for `/zh/dashboard`, `/zh/kits/<seeded-id>`, `/zh/providers`, `/zh/onboarding`. Diff vs committed baseline must satisfy `maxDiffPixelRatio: 0.03`. Same suite runs on `chromium-desktop` and `chromium-mobile` (Pixel 5 viewport). Baselines committed under `tests/web/visual.spec.ts-snapshots/` (8 total: 4 pages × 2 viewports).
- [ ] **AC #6 (Onboarding gate, 3 cases):**
  - **Empty users:** `users` table has 0 rows → GET `/` rewrites to `/onboarding` (zh) / `/en/onboarding` (en).
  - **Non-empty users (real hash):** `users` has 1 row with `password_hash = '$2b$12$...'` → GET `/` rewrites to `/dashboard`.
  - **Partial-row edge case (v2 OD-5):** `users` has 1 row with `password_hash IS NULL` → GET `/` still rewrites to `/onboarding`.
  - Playwright covers all 3.
- [ ] **AC #7 (Workspace-ready card reflects real config.yaml):** Onboarding's `WorkspaceReadyCard` (`apps/web/components/onboarding/workspace-ready-card.tsx`) fetches `/api/providers/health` + reads counts from `config.yaml` via a new `GET /api/providers/summary` (returns `{endpoints_count, monthly_cap_usd, brand_color, default_locale, export_preset}`). Test: write a known config.yaml → load Onboarding → assert visible values match. Never hardcoded.
- [ ] **AC #8 (`compliance_screen_unbound` warning chip):** Sankey accepts `unbound: string[]` prop. When `unbound.includes('compliance_screen')`, a `<ChipOverlay severity="warn" aria-label="compliance_screen_unbound — click for forensic context" />` renders on the `compliance_screen` band with a click-to-fix CTA opening `config.yaml` docs anchor. Telemetry probe: backend exposes `GET /api/providers/health` returning `unbound: ['compliance_screen']` when defense-in-depth fires (should never fire post-startup-fail-loud; if it does, surface forensically). Playwright sets a query-param feature flag `?force_unbound=compliance_screen` for the test.
- [ ] **AC #9 (EPIC-6-grade tooling green, no regression):**
  - `pnpm typecheck` clean (tsc strict).
  - `pnpm lint` clean (biome 1.9; new components conform).
  - `pnpm build` succeeds; total first-load JS for `/zh/dashboard` ≤ 200KB gzip (current 87+163=250 will need to be measured + reasoned about given new deps; soft target — if exceeded, identify the largest contributor in PRD review).
  - `pnpm check:tokens` clean (no inline hex; all new components Tailwind utilities only).
  - `pnpm gen:api` re-runs and captures the 5 new routes + `/api/onboarding/needed` + `/api/providers/summary` (=7 new paths, total ≥12).
  - `bash scripts/grep_providers.sh` clean (no vendor names leaked).
  - `uv run pytest -q` ≥ 305 passing (no backend regression; new routes add tests).
- [ ] **AC #10 (a11y, all 4 pages):** `@axe-core/playwright` runs against all 4 routes (`/zh/dashboard`, `/zh/kits/<id>`, `/zh/providers`, `/zh/onboarding`). Zero `serious|critical` violations. Every interactive element has `aria-label` (chips, buttons, KitCard, Sankey bands, dialog actions). Disabled nav items keep their `aria-disabled` treatment from EPIC-6.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Backend routes already exist | Verified 5 routes missing pre-interview | EPIC-7 ships them as single bundled epic (R1) |
| ADR-010 dialog = "modal with diff" handwave | What lib? What 3-pane semantics? | react-diff-view + shadcn Dialog + 3-action footer (R2) |
| "Visual regression" = mask everything dynamic | EPIC-6 masked because Placeholder; EPIC-7 must un-mask | seed_dashboard_fixtures + globalSetup, fullPage no-mask (R3) |
| Sankey requires d3 + framer | Contrarian: 5×5 data — is Sankey load-bearing? | Custom 150-LOC SVG + CSS-only stagger; zero deps (R4) |
| Onboarding gate location undecided | Next.js middleware ↔ FastAPI redirect ambiguous | Next.js middleware querying `/api/onboarding/needed` (R5) |
| Spec column rendering | Default react-markdown vs MDX vs custom renderers | react-markdown + remark-gfm + Instrument Serif/Inter custom renderers (R5) |

## Technical Context (brownfield findings)

**apps/api/ baseline:**
- `apps/api/routes/`: `copywriter.py`, `health.py`, `kits.py` (POST + SSE), `retrieval.py`. EPIC-7 adds `metrics.py`, `queue.py`, `providers.py`, `onboarding.py`; extends `kits.py` with list endpoint.
- `apps/api/lib/`: existing `db.py` (`asyncpg.Pool` dependency), `config.py` (read-only YAML). EPIC-7 adds `config_io.py` (ADR-010 v2 save+lock+checksum).
- `apps/api/main.py`: register new routers; preserve existing SSE lifecycle.

**apps/web/ baseline (EPIC-6 shipped):**
- `app/[locale]/dashboard/page.tsx` currently renders Placeholder — to be REPLACED with full Dashboard port.
- `app/[locale]/kits/[id]/page.tsx` — to be CREATED.
- `app/[locale]/providers/page.tsx` — to be CREATED.
- `app/[locale]/onboarding/page.tsx` — to be CREATED.
- `middleware.ts` — to be CREATED (root only; locale-aware rewrite).
- `components/atoms/`: 5 atoms shipped in EPIC-6 — reuse all (StatusChip, ComplianceRing, Sparkline, LocaleFlag, Placeholder).
- `components/dashboard/`: NEW — `KitCard.tsx`, `KPICard.tsx`, `QueueRow.tsx`, `QueueProgress.tsx`.
- `components/kit-detail/`: NEW — `ImageGrid.tsx` (SSE-aware), `SpecMarkdown.tsx`, `CompliancePanel.tsx` (pending-aware), `CostDock.tsx`.
- `components/providers/`: NEW — `SankeyRouting.tsx`, `EndpointTable.tsx`, `AddEndpointModal.tsx`, `ConflictResolutionDialog.tsx`, `DiffPane.tsx`.
- `components/onboarding/`: NEW — `WorkspaceReadyCard.tsx`, `OnboardingCTA.tsx`.
- `lib/nav.ts`: flip `providers.enabled = true`.
- `messages/{zh,en}.json`: add `kitDetail.*`, `providers.*`, `onboarding.*` keys.

**Postgres schema deltas:**
- `weekly_metrics` table (new): `(week_starting DATE PRIMARY KEY, kits_count INT, avg_compliance NUMERIC, avg_manual_edit_min NUMERIC, api_spend_usd NUMERIC, spark_data JSONB)` — populated from `cost_events` + `kits` + `compliance_screen_results` aggregations.
- `queue_jobs` table: extend EPIC-4B's queue tables OR snapshot via `GET /api/queue/active` from existing in-memory state (decide in PRD; lean toward snapshot — no new table).
- `provider_endpoints` + `provider_health`: derived from `config.yaml` (no Postgres rows; cached in-memory by `config_io.py`).
- `users` table (existing per EPIC-0 migration): only the predicate query touches it.

**Deps to add:**
- `react-markdown@^9.0.0` + `remark-gfm@^4.0.0` (~30KB combined)
- `react-diff-view@^3.0.0` (~30KB)
- `@formatjs/intl-localematcher@^0.5.0` (~5KB; already a transitive dep of next-intl but add explicit)
- No new backend deps (uses `fcntl`, `hashlib`, `tempfile`, `os.replace` — all stdlib).

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| DashboardPage | hero-page | KPI strip, Recent Kits grid, Queue strip | hosts KPICard×4, KitCard×6, QueueRow×N |
| KitDetailPage | hero-page | image grid, spec column, compliance panel, cost dock | hosts ImageGrid, SpecMarkdown, CompliancePanel, CostDock |
| ProvidersPage | hero-page | Sankey, endpoint table, modal, dialog, YAML viewer | hosts SankeyRouting, EndpointTable, AddEndpointModal, ConflictResolutionDialog |
| OnboardingPage | hero-page | hero copy, 3 CTAs, WorkspaceReadyCard | hosts WorkspaceReadyCard, OnboardingCTA×3 |
| KitCard | component | kit thumbs (14), name, sku, status, locale, compliance score | DashboardPage child; clickable → KitDetailPage |
| KPICard | component | label, value, unit, delta, sparkline | DashboardPage child |
| QueueRow | component | name, sku, stages (5-step), current stage, eta | DashboardPage child |
| ImageGrid | component | 14 images, SSE listener, stagger animation | KitDetailPage child; consumes `/api/kits/{id}/events` |
| SpecMarkdown | component | markdown source, custom renderers | KitDetailPage child; uses react-markdown |
| CompliancePanel | component | score, ring, pending state | KitDetailPage child; uses ComplianceRing atom |
| CostDock | component | cost_usd, per-role breakdown, pending state | KitDetailPage child |
| SankeyRouting | component | flows, unbound, viewBox | ProvidersPage child; custom 150-LOC SVG |
| ChipOverlay | component | severity, aria-label, click-to-fix CTA | SankeyRouting child; conditional on unbound state |
| EndpointTable | component | rows (5 endpoints), edit/remove buttons | ProvidersPage child |
| AddEndpointModal | component | form (name, role, base_url, env_var, model), checksum | ProvidersPage child; POSTs `/api/providers/endpoints` |
| ConflictResolutionDialog | component | 3 panes, 3 actions | ProvidersPage child; opens on 409 |
| DiffPane | component | title, yaml, highlight/editable flag | ConflictResolutionDialog child; uses react-diff-view |
| WorkspaceReadyCard | component | endpoints_count, monthly_cap, brand_color, locale, export_preset | OnboardingPage child; consumes `/api/providers/summary` |
| OnboardingCTA | component | label, icon, route | OnboardingPage child; ×3 (new kit / sample kit / providers) |
| OnboardingMiddleware | infra | matcher, predicate, locale resolver | apps/web/middleware.ts; queries `/api/onboarding/needed` |
| ConfigIO | infra (backend) | save(yaml, sha256), _lock, _atomic_replace | apps/api/lib/config_io.py; raises LockTimeout / ChecksumMismatch |
| LockTimeout | exception | timeout_s | raised by ConfigIO._lock |
| ChecksumMismatch | exception | current_yaml, current_sha256 | raised by ConfigIO.save |
| SaveResult | dto | new_sha256 | returned by ConfigIO.save |
| SaveRequest | dto | new_yaml, expected_sha256 | POST `/api/providers/endpoints` body |
| WeeklyMetrics | dto + table | week_starting, kits_count, avg_compliance, avg_manual_edit_min, api_spend_usd, spark_data | `GET /api/metrics/weekly` |
| KitListResponse | dto | items[], total | `GET /api/kits?recent=true` |
| QueueSnapshot | dto | jobs[] | `GET /api/queue/active` |
| ProviderEndpoint | dto | id, name, role, base_url, env_var, model | derived from config.yaml |
| ProviderHealth | dto | endpoint_id, role, status, latency_ms, last_check, unbound[] | `GET /api/providers/health` |
| OnboardingNeededResponse | dto | needs_onboarding | `GET /api/onboarding/needed` |
| ProvidersSummary | dto | endpoints_count, monthly_cap_usd, brand_color, default_locale, export_preset | `GET /api/providers/summary` |
| seed_dashboard_fixtures | script | inserts 6 kits + 1 metric + 4 queue + 5 endpoints + 5 health + 0 users | scripts/seed_dashboard_fixtures.py |

## Ontology Convergence

| Round | Entity Count | New | Stable | Stability Ratio |
|-------|-------------|-----|--------|----------------|
| 1 (scope) | 14 | 14 | — | N/A |
| 2 (ADR-010 dialog) | 19 | 5 | 14 | 73.7% |
| 3 (viz regression fixtures) | 23 | 4 | 19 | 82.6% |
| 4 (Sankey + animation) | 28 | 5 | 23 | 82.1% |
| 5 (middleware + react-markdown) | 33 | 5 | 28 | 84.8% |

Convergence trend: stability monotonically increasing despite continued entity discovery — interview is converging by *concretizing* the structure rather than churning it.

## Decisions Resolved

| Round | Question | Decision |
|-------|----------|----------|
| 1 | Backend scope: bundled vs split? | All inside EPIC-7 — single bundled epic; 5 routes + ADR-010 lib + 4 pages |
| 2 | ADR-010 conflict-resolution dialog stack? | react-diff-view + shadcn Dialog + 3-pane (yours/on-disk/proposed-editable) + 3 actions |
| 3 | Visual regression fixture strategy? | seed_dashboard_fixtures + make seed-fixtures + Playwright globalSetup + full-page no-mask snapshots |
| 4 | Sankey lib + animation strategy? (Contrarian) | Custom 150-LOC SVG Sankey (zero deps) + CSS-only Tailwind keyframe stagger (no framer-motion) |
| 5 | Onboarding gate + react-markdown wiring? (Simplifier) | Next.js middleware → FastAPI `/api/onboarding/needed`; react-markdown + remark-gfm + custom Instrument Serif/Inter renderers |

## Interview Transcript

<details>
<summary>Full Q&A (5 rounds)</summary>

### Round 1 (Goal Clarity)
**Q:** Where do the 5 missing backend routes (`/api/metrics/weekly`, `/api/kits?recent=true`, `/api/queue/active`, `/api/providers/endpoints`, `/api/providers/health`) live — inside EPIC-7, or split into EPIC-7a (backend) + EPIC-7b (frontend port)?
**A:** All inside EPIC-7 — single bundled epic.
**Ambiguity:** 33.4% (Goal: 0.80, Constraints: 0.45, Criteria: 0.55, Context: 0.90)
**Ontology entities:** 14.

### Round 2 (Constraint Clarity)
**Q:** How should the ADR-010 3-pane conflict-resolution dialog be implemented? (react-diff-view + shadcn Dialog vs Monaco vs custom vs skip)
**A:** react-diff-view + shadcn Dialog; 3-pane yours/on-disk/proposed-editable; 3 actions (Use on-disk / Force / Save merged); server returns full on-disk YAML in 409 body.
**Ambiguity:** 22.6% (Goal: 0.85, Constraints: 0.65, Criteria: 0.70, Context: 0.92)
**Ontology entities:** 19 (added ConfigIO, SaveResult, ChecksumMismatch, LockTimeout, DiffPane).

### Round 3 (Success Criteria)
**Q:** AC #5 visual regression fixture strategy — seed deterministic vs network mock vs hybrid vs keep masking?
**A:** Seed deterministic via seed_dashboard_fixtures + `make seed-fixtures` in Playwright globalSetup; full-page no-mask snapshots; same fixtures cover AC #1 click-through and AC #6 onboarding.
**Ambiguity:** 14.4% (Goal: 0.90, Constraints: 0.75, Criteria: 0.85, Context: 0.93)
**Ontology entities:** 23 (added seed_dashboard_fixtures, WeeklyMetrics, ProviderHealth, globalSetup).

### Round 4 (Constraint Clarity — Contrarian)
**Q:** Sankey is fashionable but 5×5 data could be a table. Is Sankey load-bearing? Plus, AC #3 SSE stagger needs an animation decision.
**A:** Custom 150-LOC SVG Sankey (zero deps, design-brief fidelity preserved) + CSS-only Tailwind keyframe stagger (no framer-motion). AC #8 chip = `<ChipOverlay>` conditional on `unbound`.
**Ambiguity:** 8.9% (Goal: 0.93, Constraints: 0.85, Criteria: 0.92, Context: 0.95)
**Ontology entities:** 28 (added SankeyRouting, ChipOverlay, ribbonPath, fade-in-stagger keyframe, ImageGrid).

### Round 5 (Constraint Clarity — Simplifier)
**Q:** Onboarding gate location + react-markdown wiring — bundle into simplest combined wiring satisfying AC #6 + design-brief.
**A:** (a) Next.js `middleware.ts` querying FastAPI `/api/onboarding/needed`; (b) `react-markdown@9` + `remark-gfm@4` with custom h1-h3/p/code/table renderers (Instrument Serif h1/h2, Inter body, JetBrains Mono code).
**Ambiguity:** 4.3% (Goal: 0.96, Constraints: 0.95, Criteria: 0.95, Context: 0.97)
**Ontology entities:** 33 (added middleware.ts, /api/onboarding/needed, SpecMarkdown, react-markdown, remark-gfm).

</details>

---

## Execution Bridge

Per user pre-direction (deep-interview → ralph): proceed to `/oh-my-claudecode:ralph` with this spec as the task definition. EPIC-5 deep-interview state preserved at `.omc/state/deep-interview-state-epic-5-paused.json` (R6 / 8.8% / 6 decisions locked) — resumes after EPIC-7 ralph closes.
