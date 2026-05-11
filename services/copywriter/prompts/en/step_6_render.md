# Step 6 — Output format

Return a **single JSON object** with two keys:

```json
{
  "hero_sections": [
    {"id": "H1", "visual": "...", "copy": "...", "design_note": "..."},
    {"id": "H2", "visual": "...", "copy": "...", "design_note": "..."},
    ...
  ],
  "detail_sections": [
    {"id": "M1", "visual": "...", "copy": "...", "design_note": "..."},
    ...
  ]
}
```

`hero_sections` must be exactly 5 entries with ids in order H1..H5;
`detail_sections` must be exactly 9 entries with ids in order M1..M9.
Return no extra prose, comments, or markdown around the JSON.
