# Deep Interview Spec: AI Shop Image Studio

## Metadata
- Interview ID: aishop-img-studio-2026-05-11
- Rounds: 7
- Final Ambiguity Score: **12.3%**
- Type: greenfield (with 3 local reference repos used as knowledge sources)
- Generated: 2026-05-11
- Threshold: 20%
- Initial Context Summarized: no (initial prompt + 3 explored repos fit budget)
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.94 | 0.40 | 0.376 |
| Constraint Clarity | 0.85 | 0.30 | 0.255 |
| Success Criteria | 0.82 | 0.30 | 0.246 |
| **Total Clarity** |  |  | **0.877** |
| **Ambiguity** |  |  | **0.123 (12.3%)** |

---

## Goal

Build a **single-tenant, self-hosted workbench** (modern monorepo, rewritten from scratch) that turns a single product photo + minimal metadata into a complete **"marketing kit"** for both 淘宝/Tmall and cross-border e-commerce (Amazon/Shopify):

1. **Copywriting spec** — markdown that breaks the listing into 5 main images + 8–9 detail-page modules, each with the three-piece (画面 / 图内文案 / 设计说明) structure, then auto-scored by a multi-tier compliance review (中国广告法 + 蓝帽子 + 平台规则).
2. **Image set** — production-ready PNGs: 5 hero images (1024×1024) + 9 detail-page images (1024×1536), 14 in total per SKU.
3. **Bestseller-style RAG** — every new SKU first hits a 1000+ image bestseller corpus via Milvus hybrid retrieval; the retrieved aesthetic is funneled into the prompt as proven style guidance.

Operating principle: **direct-to-listing quality ~95%** with a built-in light text-touchup mini-editor so a human can drag/replace on-image Chinese text in <2 min/SKU. We deliberately keep the human in the loop for the last 5% rather than chasing 100% zero-touch.

Architectural principle: **provider-agnostic by design**. The system speaks only two protocol families at the boundary — `OPENAI-compatible` and `ANTHROPIC-compatible` — so apimart.ai, OpenRouter, official OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, GCP Vertex, vLLM, ollama, etc. are interchangeable backends, chosen per service at runtime via `config.yaml`.

---

## Constraints
- **Form factor:** single-tenant workbench. No multi-tenant SaaS, no billing, no public sign-up.
- **Deliverable:** fused marketing kit (copy spec + 14-image set + bestseller-driven aesthetic).
- **Quality bar:** ~95% direct-to-listing. Light text-touchup UI permitted; full re-generation if needed.
- **Reuse strategy:** rewrite as a clean monorepo. The 3 reference repos are knowledge sources, not forks.
- **Stack:** monorepo containing Next.js 14 (web) + FastAPI (api) + Milvus 2.4 (vector) + Postgres 16 (relational).
- **AI provider layer:** thin adapter abstracting only `OPENAI-compatible` and `ANTHROPIC-compatible` protocols. **No vendor names hard-coded anywhere** outside `config.yaml`.
- **Bestseller corpus:** user owns 1000+ pre-labeled images with sales metadata, Milvus-ingest ready.
- **Locale:** bilingual (中文 + English) from MVP day 1, since the original mandate covers 淘宝 + 跨境.
- **MVP cycle:** 3–4 months (accepted in Round 6).
- **Compliance:** 中国广告法 + 保健食品蓝帽子 + 5 大平台 (淘宝/天猫/京东/拼多多/抖店) for 中文 path; Amazon Listing Policy + general ad standards for English path.

## Non-Goals (Explicitly Excluded)
- Multi-tenant SaaS, user accounts beyond local, billing, public deployment.
- Mobile app / native client.
- Real-time video / dynamic ad generation.
- Direct platform API uploading (no auto-publish to Taobao/Amazon in MVP).
- Hard binding to any single AI vendor.
- Watermark removal or IP-questionable scraping pipelines.
- Fully zero-touch human-free pipeline (light editor is intentional, not a missing feature).
- 100% from-scratch model training (we orchestrate, not pre-train).

---

## Acceptance Criteria

### Functional
- [ ] **Input:** one product photo (jpg/png ≤ 10MB) + metadata (sku, name, category, price, brand, target locale).
- [ ] **Output:** marketing-kit folder per SKU containing:
  - [ ] `spec.md` — 5 main image entries + M1–M9 detail entries, each with (画面 / 图内文案 / 设计说明).
  - [ ] `hero/H1.png … H5.png` — 1024×1024.
  - [ ] `detail/D1.png … D9.png` — 1024×1536.
  - [ ] `compliance.json` — scorecard ≥ 80/100 with rule-by-rule pass/fail.
- [ ] **Bestseller RAG:** every generation pulls top-3 visually + semantically similar bestsellers from Milvus before prompting; retrieved IDs logged in `kit_meta.json`.
- [ ] **Provider hot-swap:** flipping `config.yaml` from one OPENAI-compatible endpoint to another (or to an ANTHROPIC-compatible endpoint) regenerates kits with **zero code changes**.
- [ ] **Brand-color lock:** one hex code enforced across all 14 images in a kit, sampled and verified post-generation.
- [ ] **Text-touchup editor:** in-browser drag/replace for on-image text, with text-only inpainting via the image-edit endpoint; avg human edit time ≤ 2 min/SKU.
- [ ] **Batch mode:** queue 50 SKUs, progress UI with per-SKU status (queued / retrieving / generating / scoring / done / failed).
- [ ] **Dashboard:** upload, review, regenerate single image, regenerate full kit, export zip.
- [ ] **Bilingual:** every prompt template + compliance ruleset has 中/EN variants; locale is per-SKU.

### Non-functional
- [ ] Single-machine Docker Compose runs the whole stack (api + web + milvus + postgres).
- [ ] One SKU end-to-end: ≤ 5 min wall-clock at default settings.
- [ ] Batch of 50 SKUs: ≤ 3 h wall-clock on a single 8-core machine + remote API throughput.
- [ ] Cost target: ≤ ¥20 (~$2.80 USD) per fully-generated SKU at the configured provider.
- [ ] All generative calls go through one of two adapters; grepping the codebase finds **zero** raw `openai`/`anthropic` SDK calls outside `services/providers/`.

---

## Assumptions Exposed & Resolved

| Assumption | Round / Challenge | Resolution |
|------------|-------------------|------------|
| "Platform = SaaS web product" | R1 — form factor | **Single-tenant workbench**, not SaaS |
| Fusing 3 reference projects is feasible in MVP | R2 — core deliverable | Yes — fused marketing kit is the MVP target |
| Direct-to-listing is achievable zero-touch | R4 — CONTRARIAN | **No** — ~95% bar + light text editor; 100% zero-touch is north star, not MVP |
| Need to scrape competitor bestsellers | R5 — asset reality | **Not needed** — user owns labeled 1000+ corpus already |
| Forking 3 repos is the fastest path | R6 — SIMPLIFIER | **Rejected** — user chose clean monorepo rewrite, accepting 3–4 month cycle |
| Lock to one vendor (OpenRouter or apimart) | R7 — CONTRARIAN | **Rejected** — abstract to protocol level (OPENAI / ANTHROPIC), any compliant endpoint pluggable |

---

## Technical Context

### Reference Projects (knowledge sources, not forked)

| Repo | Distilled into |
|------|---------------|
| `/home/kano/Desktop/ecommerce-visual-copywriting-skill` | `services/copywriter/`: 6-step SOP prompt templates (中/EN) + 4-tier compliance rule pipeline + ≥80 scorecard logic. SKILL.md becomes a system prompt. |
| `/home/kano/Desktop/ecom-details-image` | `services/imagegen/templates/`: 25 JSON templates ported. `services/imagegen/prompt_builder.py`: 9 prompt iron rules enforced (hex colors, product %, whitespace %, negation lists, platform reserves, 3-layer info hierarchy, batch-over-iterate, Chinese-char handling, no-text-defaults). `scripts/generate_image.py` ideas → `services/providers/openai_compatible.py` image-gen path. |
| `/home/kano/Desktop/Fashion-AI` | `services/retrieval/`: Milvus hybrid search (dense+sparse+RRF, port of `milvus_store.py`). `services/style/analyzer.py`: multimodal style extraction (port of `style_analyzer.py`) calling the abstracted vision-LLM. |

### Monorepo layout

```
aishop-img-studio/
├── apps/
│   ├── web/                       # Next.js 14, App Router, RSC, shadcn/ui, Tailwind
│   └── api/                       # FastAPI gateway, OpenAPI-typed
├── services/
│   ├── providers/                 # ★ Two-protocol abstraction (the heart of R7)
│   │   ├── base.py                # Protocol interfaces: ChatLLM, VisionLLM, ImageGen, Embedding
│   │   ├── openai_compatible.py   # Backend driver for any OpenAI-spec endpoint
│   │   ├── anthropic_compatible.py# Backend driver for any Anthropic-spec endpoint
│   │   └── registry.py            # config.yaml → factory
│   ├── copywriter/
│   │   ├── prompts/{zh,en}/       # 6-step SOP per locale
│   │   ├── compliance/{zh,en}/    # 广告法/蓝帽子/平台 + Amazon TOS
│   │   └── scorecard.py
│   ├── retrieval/
│   │   ├── ingest.py              # Bestseller corpus loader
│   │   └── hybrid_search.py       # dense+sparse+RRF
│   ├── style/
│   │   └── analyzer.py            # multimodal call via providers/
│   ├── imagegen/
│   │   ├── templates/             # 25 JSON templates
│   │   ├── prompt_builder.py      # 9 iron rules
│   │   └── orchestrator.py        # brand-color-lock, batch, async polling
│   └── editor/
│       └── inpaint_text.py        # on-image text touch-up
├── packages/
│   ├── schemas/                   # shared TS + pydantic models
│   └── ui/                        # shared shadcn components
├── infra/
│   ├── docker-compose.yml         # api + web + milvus + postgres + minio
│   └── migrations/
└── config.yaml                    # ★ Provider routing — the only place vendor names live
```

### Provider abstraction example

```yaml
# config.yaml
providers:
  vision:           # used by style analyzer + multimodal scoring
    protocol: openai_compatible
    base_url: https://api.apimart.ai/v1
    api_key_env: APIMART_API_KEY
    model: gpt-4o-vision
  llm:              # used by copywriter + compliance review
    protocol: anthropic_compatible
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
    model: claude-opus-4-7
  image_gen:        # used by orchestrator
    protocol: openai_compatible
    base_url: https://api.apimart.ai/v1
    api_key_env: APIMART_API_KEY
    model: gpt-image-2
  image_edit:       # used by text touch-up
    protocol: openai_compatible
    base_url: https://api.apimart.ai/v1
    api_key_env: APIMART_API_KEY
    model: gpt-image-2-edit
  embedding:        # used by retrieval
    protocol: openai_compatible
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    model: nvidia/llama-nemotron-embed-vl-1b-v2
```

Switching a provider = changing one section. No rebuild, no code change.

### Tech stack lock

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 14 + shadcn/ui + Tailwind + TanStack Query + Zustand | Modern RSC, single-tenant friendly, fast dev |
| Backend | FastAPI + Pydantic v2 + SQLAlchemy 2 + arq (Redis queue) | Typed, async, lightweight batch |
| Vector DB | Milvus 2.4 self-hosted (docker-compose) | Hybrid search built-in, matches Fashion-AI |
| Relational | Postgres 16 + JSONB | Marketing-kit metadata + audit trail |
| Object storage | MinIO (local S3-compatible) | Easy v2 swap to real S3/COS |
| Models | Two protocol adapters | Per Round 7 mandate |
| Auth | Local password + JWT | Single-tenant |
| Dev tools | uv + pnpm + Docker Compose + Ruff + Biome | Modern Python + Node tooling |

---

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Workbench | core | name, owner, config_path | has many ProductCatalog |
| ProductCatalog | core | sku, name, category, price, brand, locale | has one InputPhoto, has many MarketingKit |
| MarketingKit | core | id, sku, status, score, locale | has one CopywritingSpec, many HeroImage, many DetailImage |
| CopywritingSpec | core | markdown, compliance_passed, version | belongs to MarketingKit |
| HeroImage | core | png_path, template_id, prompt, brand_color | belongs to MarketingKit |
| DetailImage | core | png_path, module_id (M1–M9), prompt, brand_color | belongs to MarketingKit |
| BestsellerCorpus | core | image_path, dense_vec, sparse_vec, sales, category | feeds MilvusIndex |
| ComplianceCheck | core | ruleset_id, score, violations[] | applies to CopywritingSpec |
| QualityGate | supporting | threshold (95%), human_edit_seconds | gates MarketingKit |
| TextEditor | supporting | session_id, edits[], inpaint_model | mutates HeroImage / DetailImage |
| ModelProviderAdapter | supporting | protocol (OPENAI/ANTHROPIC), base_url, model_id, role | injected into all generative services |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|-------|--------------|-----|---------|--------|-----------|
| 1 | 3 | 3 | - | - | N/A |
| 2 | 8 | 5 | 1 (rename) | 2 | 38% |
| 3 | 9 | 1 | 0 | 8 | 89% |
| 4 | 10 | 1 | 0 | 9 | 90% |
| 5 | 10 | 0 | 1 (rename) | 9 | 100% |
| 6 | 10 | 0 | 0 | 10 | 100% |
| 7 | 11 | 1 | 0 | 10 | 91% |

Domain model converged from Round 3 onward; the late additions (`QualityGate`, `TextEditor`, `ModelProviderAdapter`) extended the periphery without disrupting the core.

---

## Interview Transcript

<details>
<summary>Full Q&A (7 rounds)</summary>

### Round 1 — Goal Clarity (form factor)
**Q:** 你心里想的「平台」最接近以下哪种形态？(SaaS / 自用工作台 / Skill 套件 / API+CLI)
**A:** 自用工作台（单租户）
**Ambiguity:** 66% (Goal 0.55, Constraints 0.30, Criteria 0.10)

### Round 2 — Goal Clarity (core deliverable)
**Q:** 工作台 MVP 阶段最优先交付的是什么？(成品图集 / 图+文案套包 / 爆款 RAG 出图 / 三者融合营销套包)
**A:** 三者融合的「营销套包」
**Ambiguity:** 57% (Goal 0.70, Constraints 0.35, Criteria 0.15)

### Round 3 — Success Criteria (quality bar)
**Q:** 你心里的「交付完成」是哪种？(设计师初稿级 / 直接上架级 / A/B 变体草案级 / 对话式打磨级)
**A:** 直接上架级
**Ambiguity:** 40% (Goal 0.78, Constraints 0.40, Criteria 0.55)

### Round 4 — CONTRARIAN: quality vs speed
**Q:** 直接上架级是北极星还是 MVP 门槛？
**A:** 保留轻人工修字，MVP 创造 ~95% 上架级
**Ambiguity:** 26% (Goal 0.85, Constraints 0.55, Criteria 0.78)

### Round 5 — Constraint: asset reality
**Q:** 历史爆款语料现状？(有 1000+ / 只自家 SKU / 能爬 / 简化掉 RAG)
**A:** 有现成爆款库（1000+ 图 + 销量）
**Ambiguity:** 20.0% (Goal 0.88, Constraints 0.70, Criteria 0.80)

### Round 6 — SIMPLIFIER: reuse + locale
**Q:** 复用 + 语种策略？(中文优先 fork / 双语并行 / 跨境优先 / 从零重写)
**A:** 从零重写 monorepo
**Ambiguity:** 16.1% (Goal 0.92, Constraints 0.75, Criteria 0.82)

### Round 7 — Constraint: deploy × locale × provider
**Q:** 部署 × 语种 × 模型供应商组合？
**A:** 不限定厂商 — 抽象到 OPENAI 协议族 + ANTHROPIC 协议族两套
**Ambiguity:** 12.3% (Goal 0.94, Constraints 0.85, Criteria 0.82) ✅

</details>
