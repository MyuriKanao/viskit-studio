# EPIC-4A — 5-SKU Empirical Cost Probe (manual step)

Date scaffold created: 2026-05-11

## EPIC-1 spike acknowledgment

Read `/home/kano/Desktop/aishop-img-studio/.omc/research/chinese-text-fail-rate-spike.md`.

- **Overall zh-text fail rate**: 30.0% (6 of 20 across 4 templates)
- **Threshold**: ≤ 40% (per plan AC #8)
- **EPIC-5 budget multiplier**: **1.0×** (default)
- **Decision**: EPIC-5 budget revision NOT REQUIRED — fail rate 30% ≤ 40% threshold per plan AC #8.
- **User sign-off gate**: NOT REQUIRED — fail rate 30% ≤ 60% threshold (ADR-012 SLA does not apply).

This file acknowledges the spike result and clears EPIC-4A's hard gate per plan
AC #8. The 5-SKU probe described below is a documented manual step — actual
real-LLM probe results, decision-tree branch, and any ADR-012 mini-decision are
appended once executed.

## 5-SKU probe (manual step)

### Entry point

```bash
make epic-4a-probe
# or
uv run python scripts/probe_epic_4a.py --execute
```

Without `--execute`, the script prints a banner and exits cleanly with status 0
(scaffold mode — useful in CI to confirm wiring without burning LLM credits).
With `--execute`, the script runs the 5-SKU probe end-to-end against the
configured `image_gen` role (real network call, real cost) and writes results
to this file.

### Probe protocol

Run EPIC-4A's `single_gen.generate_kit` on 5 fixture SKUs at ΔE<6 with the
default `config.yaml` provider bindings. For each SKU record:

- average regen count per image (v1 — no auto-regen yet, so this is 0)
- median cost per SKU (sum of `cost.json` events, USD → CNY ¥ at probe-time rate)
- color-lock summary (ok / out_of_tolerance / error counts)

Append the table below once the probe has run.

### Decision tree (per plan AC #6, ADR-012)

Apply this matrix verbatim to the probe results:

| Median ¥/SKU | Action |
|--------------|--------|
| ≤ ¥18 | Proceed to EPIC-4B with ΔE<6 / 2-regen / 14-image config. |
| ¥18 - ¥22 | Apply ONE of: (a) relax to ΔE<8 for v1 (ΔE<6 reported as stretch), (b) cap auto-regen at 1 attempt (not 2), (c) shrink kit from 14 → 10 images. **Decision SLA: 24h from probe report (ADR-012).** Decision-maker: project owner. If no decision within 24h, default to `ΔE<8` (least disruptive — preserves 14-image kit format that EPIC-10 ceremony rubric assumes). |
| > ¥22 | Stop. Escalate to project owner via the same 24h SLA. Likely root cause: image-gen pricing assumption wrong OR fail rate higher than assumed; revise spec acceptance criterion ≤ ¥20/SKU. If no decision within 24h, default to **10-image kit fallback** (strictest preserved contingency). |

### Probe results

_(populated on `--execute` run; left empty in scaffold mode)_

| SKU | Median cost (¥) | Avg regen | Color-lock ok/out/err |
|-----|-----------------|-----------|------------------------|
| _pending_ | _pending_ | _pending_ | _pending_ |

### ADR-012 mini-decision

_(populated only when median cost lands in the ¥18-¥22 or > ¥22 branch)_

- Branch:
- Chosen action:
- Decision-maker:
- Timestamp:
- Notes:
