# Chinese-text Fail-rate Spike

Run: 2026-05-11 09:13:03 UTC, mode=mock, n=20, templates=4

## Per-template fail rate

| template_id | n | fails | rate |
|-------------|---|-------|------|
| H-LIGHT-01 | 5 | 0 | 0.0% |
| H-DARK-01 | 5 | 1 | 20.0% |
| M-DETAIL-01 | 5 | 3 | 60.0% |
| M-DETAIL-02 | 5 | 2 | 40.0% |

## Overall fail rate

Overall: 30.0% (6/20)

## Fail-mode taxonomy

| fail mode | count |
|-----------|-------|
| mis-rendered character | 1 |
| wrong character | 2 |
| extra character | 1 |
| missing character | 2 |

## Recommended budget multiplier for EPIC-5

Overall fail rate is 30.0% (≤40% threshold). Default EPIC-5 budget multiplier: 1.0×.
