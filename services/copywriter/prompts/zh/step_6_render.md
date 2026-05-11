# Step 6 — 输出格式

返回一个 **JSON 对象**，包含两个键：

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

`hero_sections` 必须正好 5 条且 id 按 H1..H5 排列；
`detail_sections` 必须正好 9 条且 id 按 M1..M9 排列。
不要返回任何额外的文字、注释或 markdown。
