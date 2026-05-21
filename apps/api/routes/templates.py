"""Template library routes backed by built-in imagegen templates and custom DB rows."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from services.copywriter.sop import SkuMeta, ThreePiece
from services.imagegen.prompt_builder import PromptInputs, build_prompt
from services.imagegen.template_library import (
    DEFAULT_SCHEME_REF,
    SLOTS,
    TemplateLibraryError,
    builtin_ref,
    coerce_custom_template,
    custom_ref,
    default_slot_refs,
    resolve_template_ref,
    validate_template_payload,
)
from services.imagegen.template_loader import (
    SUPPORTED_LOCALES,
    Template,
    TemplateLoadError,
    list_templates,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])

Category = Literal["hero", "detail_m3", "lifestyle", "short_video", "amazon_hero"]
LocaleT = Literal["zh", "en"]
SourceT = Literal["built_in", "custom"]


class TemplateSummary(BaseModel):
    id: str
    name: str
    name_en: str | None = None
    category: Category
    tags: list[str]
    locale: LocaleT
    description: str | None
    thumbnail_url: str | None
    source: SourceT = "built_in"
    editable: bool = False
    copyable: bool = True
    enabled: bool = True
    prompt_template: dict[str, str] | None = None
    defaults: dict[str, str] | None = None
    examples: list[str] = Field(default_factory=list)


class TemplatePayload(BaseModel):
    locale: LocaleT
    name: str = Field(min_length=1)
    description: str | None = None
    category: Category = "lifestyle"
    tags: list[str] = Field(default_factory=list)
    prompt_template: dict[str, str] = Field(min_length=1)
    defaults: dict[str, str] = Field(default_factory=dict)
    variants: dict[str, Any] = Field(default_factory=dict)
    category_tips: dict[str, str] = Field(default_factory=dict)
    examples: list[str] = Field(default_factory=list)
    supports_image_reference: bool = False
    enabled: bool = True


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: Category | None = None
    tags: list[str] | None = None
    prompt_template: dict[str, str] | None = None
    defaults: dict[str, str] | None = None
    variants: dict[str, Any] | None = None
    category_tips: dict[str, str] | None = None
    examples: list[str] | None = None
    supports_image_reference: bool | None = None
    enabled: bool | None = None


class CopyTemplateRequest(BaseModel):
    source_ref: str
    name: str | None = None


class SchemeSlot(BaseModel):
    slot_id: Literal[
        "H1", "H2", "H3", "H4", "H5", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"
    ]
    template_ref: str


class SchemeSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    locale: LocaleT
    source: SourceT = "custom"
    editable: bool = True
    enabled: bool = True
    slots: list[SchemeSlot]


class SchemePayload(BaseModel):
    locale: LocaleT
    name: str = Field(min_length=1)
    description: str | None = None
    enabled: bool = True
    slots: list[SchemeSlot] = Field(min_length=14, max_length=14)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    template_ref: str
    locale: LocaleT
    sample_name: str = "示例商品"
    sample_brand: str = "示例品牌"
    sample_category: str = "服饰"
    brand_color_hex: str = Field(default="#C4513A", pattern=r"^#[0-9A-Fa-f]{6}$")
    style_prompt: str = "warm minimalist studio, soft daylight"
    visual: str = "single product hero image, clean ecommerce composition"
    copy_text: str = Field(default="新品上市", validation_alias="copy", serialization_alias="copy")
    design_note: str = "keep product centered with premium spacing"


class PreviewResponse(BaseModel):
    prompt: str
    png_path: str | None
    cost_usd: float


_CATEGORY_BY_ID: dict[str, Category] = {
    "hero-image": "hero",
    "ghost-mannequin": "hero",
    "device-mockup": "hero",
    "lifestyle-scene": "lifestyle",
    "flat-lay": "lifestyle",
    "model-showcase": "lifestyle",
    "try-on-virtual": "lifestyle",
    "magazine-editorial": "lifestyle",
    "luxury-atmospherics": "lifestyle",
    "storefront": "lifestyle",
    "detail-macro": "detail_m3",
    "before-after": "detail_m3",
    "packaging": "detail_m3",
    "infographic": "detail_m3",
    "size-spec": "detail_m3",
    "exploded-view": "detail_m3",
    "multi-angle-grid": "detail_m3",
    "social-media": "short_video",
    "ugc-style": "short_video",
    "livestream": "short_video",
    "sports-campaign": "short_video",
    "poster-banner": "amazon_hero",
    "creative-concept": "amazon_hero",
    "multi-product": "amazon_hero",
    "seasonal-campaign": "amazon_hero",
}


def _category_for_template(tpl: Template) -> Category:
    raw = _CATEGORY_BY_ID.get(tpl.id.replace("custom-", ""))
    return raw or "lifestyle"


def _summary_from_template(
    tpl: Template,
    *,
    ref: str,
    source: SourceT,
    enabled: bool = True,
    description: str | None = None,
    tags: list[str] | None = None,
    category: Category | None = None,
) -> TemplateSummary:
    return TemplateSummary(
        id=ref,
        name=tpl.name,
        category=category or _category_for_template(tpl),
        tags=tags or [],
        locale=tpl.locale,
        description=description,
        thumbnail_url=None,
        source=source,
        editable=source == "custom",
        copyable=True,
        enabled=enabled,
        prompt_template=tpl.prompt_template,
        defaults=tpl.defaults,
        examples=list(tpl.examples),
    )


def _builtin_templates() -> list[TemplateSummary]:
    result: list[TemplateSummary] = []
    for locale in sorted(SUPPORTED_LOCALES):
        locale_t = cast(LocaleT, locale)
        for tpl in list_templates(locale_t):
            result.append(
                _summary_from_template(tpl, ref=builtin_ref(locale_t, tpl.id), source="built_in")
            )
    return result


def _custom_templates(session: Session) -> list[TemplateSummary]:
    try:
        rows = session.execute(text("SELECT * FROM custom_templates ORDER BY id ASC")).all()
    except SQLAlchemyError:
        return []
    out: list[TemplateSummary] = []
    for row in rows:
        data = row._mapping
        tpl = coerce_custom_template(data)
        out.append(
            _summary_from_template(
                tpl,
                ref=custom_ref(data["id"]),
                source="custom",
                enabled=bool(data["enabled"]),
                description=data.get("description"),
                tags=list(data.get("tags") or []),
                category=cast(Category, data.get("category") or _category_for_template(tpl)),
            )
        )
    return out


@router.get("", response_model=list[TemplateSummary])
def get_templates() -> list[TemplateSummary]:
    try:
        return _builtin_templates()
    except TemplateLoadError as exc:
        msg = str(exc)
        if "not found" in msg:
            raise HTTPException(
                status_code=503,
                detail={"code": "TEMPLATES_DIR_MISSING", "message": msg},
            ) from exc
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATES_LOAD_INVALID", "message": msg},
        ) from exc


@router.get("/managed", response_model=list[TemplateSummary])
def get_managed_templates(
    session: Annotated[Session, Depends(get_session)],
) -> list[TemplateSummary]:
    return _builtin_templates() + _custom_templates(session)


@router.post("", response_model=TemplateSummary)
def create_template(
    payload: TemplatePayload, session: Annotated[Session, Depends(get_session)]
) -> TemplateSummary:
    try:
        tpl = validate_template_payload(
            **payload.model_dump(exclude={"description", "category", "tags", "enabled"})
        )
    except TemplateLibraryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = session.execute(
        text(
            "INSERT INTO custom_templates "
            "(locale, name, description, category, tags, prompt_template, defaults, "
            "variants, category_tips, examples, supports_image_reference, enabled) "
            "VALUES (:locale, :name, :description, :category, :tags, "
            "CAST(:prompt_template AS JSONB), CAST(:defaults AS JSONB), "
            "CAST(:variants AS JSONB), CAST(:category_tips AS JSONB), "
            "CAST(:examples AS JSONB), :supports_image_reference, :enabled) "
            "RETURNING id"
        ),
        {
            "locale": payload.locale,
            "name": tpl.name,
            "description": payload.description,
            "category": payload.category,
            "tags": payload.tags,
            "prompt_template": json.dumps(tpl.prompt_template, ensure_ascii=False),
            "defaults": json.dumps(tpl.defaults, ensure_ascii=False),
            "variants": json.dumps(tpl.variants, ensure_ascii=False),
            "category_tips": json.dumps(tpl.category_tips, ensure_ascii=False),
            "examples": json.dumps(list(tpl.examples), ensure_ascii=False),
            "supports_image_reference": tpl.supports_image_reference,
            "enabled": payload.enabled,
        },
    ).scalar_one()
    return _summary_from_template(
        tpl,
        ref=custom_ref(int(row)),
        source="custom",
        enabled=payload.enabled,
        description=payload.description,
        tags=payload.tags,
        category=payload.category,
    )


@router.post("/copy", response_model=TemplateSummary)
def copy_template(
    payload: CopyTemplateRequest, session: Annotated[Session, Depends(get_session)]
) -> TemplateSummary:
    try:
        resolved = resolve_template_ref(
            session,
            payload.source_ref,
            locale=cast(
                LocaleT,
                payload.source_ref.split(":")[1]
                if payload.source_ref.startswith("builtin:")
                else "zh",
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    tpl = resolved.template
    create_payload = TemplatePayload(
        locale=tpl.locale,
        name=payload.name or f"{tpl.name} copy",
        category=_category_for_template(tpl),
        prompt_template=tpl.prompt_template,
        defaults=tpl.defaults,
        variants=tpl.variants,
        category_tips=tpl.category_tips,
        examples=list(tpl.examples),
        supports_image_reference=tpl.supports_image_reference,
    )
    return create_template(create_payload, session)


@router.patch("/{template_ref:path}", response_model=TemplateSummary)
def update_template(
    template_ref: str, payload: TemplateUpdate, session: Annotated[Session, Depends(get_session)]
) -> TemplateSummary:
    if not template_ref.startswith("custom:"):
        raise HTTPException(status_code=403, detail="built-in templates are read-only")
    template_id = int(template_ref.split(":", 1)[1])
    row = session.execute(
        text("SELECT * FROM custom_templates WHERE id = :id"), {"id": template_id}
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="custom template not found")
    data = dict(row._mapping)
    patch = payload.model_dump(exclude_unset=True)
    data.update(patch)
    try:
        tpl = validate_template_payload(
            locale=cast(LocaleT, data["locale"]),
            name=data["name"],
            prompt_template=data["prompt_template"],
            defaults=data.get("defaults"),
            variants=data.get("variants"),
            category_tips=data.get("category_tips"),
            examples=data.get("examples"),
            supports_image_reference=bool(data.get("supports_image_reference", False)),
        )
    except TemplateLibraryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session.execute(
        text(
            "UPDATE custom_templates SET name=:name, description=:description, "
            "category=:category, tags=:tags, "
            "prompt_template=CAST(:prompt_template AS JSONB), "
            "defaults=CAST(:defaults AS JSONB), variants=CAST(:variants AS JSONB), "
            "category_tips=CAST(:category_tips AS JSONB), "
            "examples=CAST(:examples AS JSONB), "
            "supports_image_reference=:supports_image_reference, "
            "enabled=:enabled, updated_at=NOW() WHERE id=:id"
        ),
        {
            "id": template_id,
            "name": tpl.name,
            "description": data.get("description"),
            "category": data.get("category") or "lifestyle",
            "tags": data.get("tags") or [],
            "prompt_template": json.dumps(tpl.prompt_template, ensure_ascii=False),
            "defaults": json.dumps(tpl.defaults, ensure_ascii=False),
            "variants": json.dumps(tpl.variants, ensure_ascii=False),
            "category_tips": json.dumps(tpl.category_tips, ensure_ascii=False),
            "examples": json.dumps(list(tpl.examples), ensure_ascii=False),
            "supports_image_reference": tpl.supports_image_reference,
            "enabled": bool(data.get("enabled", True)),
        },
    )
    return _summary_from_template(
        tpl,
        ref=template_ref,
        source="custom",
        enabled=bool(data.get("enabled", True)),
        description=data.get("description"),
        tags=list(data.get("tags") or []),
        category=cast(Category, data.get("category") or "lifestyle"),
    )


@router.delete("/{template_ref:path}")
def delete_template(
    template_ref: str, session: Annotated[Session, Depends(get_session)]
) -> dict[str, bool]:
    if not template_ref.startswith("custom:"):
        raise HTTPException(status_code=403, detail="built-in templates are read-only")
    session.execute(
        text("DELETE FROM custom_templates WHERE id=:id"),
        {"id": int(template_ref.split(":", 1)[1])},
    )
    return {"ok": True}


def _default_scheme(locale: LocaleT) -> SchemeSummary:
    return SchemeSummary(
        id=DEFAULT_SCHEME_REF,
        name="Default template scheme",
        description="Built-in 5 hero + 9 detail mapping",
        locale=locale,
        source="built_in",
        editable=False,
        enabled=True,
        slots=[
            SchemeSlot(slot_id=cast(Any, slot), template_ref=ref)
            for slot, ref in default_slot_refs(locale).items()
        ],
    )


@router.get("/schemes", response_model=list[SchemeSummary])
def list_schemes(
    session: Annotated[Session, Depends(get_session)],
    locale: LocaleT = "zh",
) -> list[SchemeSummary]:
    result = [_default_scheme(locale)]
    try:
        rows = session.execute(
            text("SELECT * FROM template_schemes WHERE locale=:locale ORDER BY id"),
            {"locale": locale},
        ).all()
    except SQLAlchemyError:
        return result
    for row in rows:
        data = row._mapping
        slots = session.execute(
            text(
                "SELECT slot_id, template_ref FROM template_scheme_slots "
                "WHERE scheme_id=:id ORDER BY slot_id"
            ),
            {"id": data["id"]},
        ).all()
        result.append(
            SchemeSummary(
                id=f"scheme:{data['id']}",
                name=data["name"],
                description=data.get("description"),
                locale=locale,
                source="custom",
                editable=True,
                enabled=bool(data["enabled"]),
                slots=[
                    SchemeSlot(
                        slot_id=cast(Any, s._mapping["slot_id"]),
                        template_ref=s._mapping["template_ref"],
                    )
                    for s in slots
                ],
            )
        )
    return result


def _validate_scheme(payload: SchemePayload) -> None:
    slots = [s.slot_id for s in payload.slots]
    if set(slots) != set(SLOTS) or len(slots) != len(set(slots)):
        raise HTTPException(
            status_code=422, detail="scheme must contain exactly H1-H5 and M1-M9 once"
        )


@router.post("/schemes", response_model=SchemeSummary)
def create_scheme(
    payload: SchemePayload, session: Annotated[Session, Depends(get_session)]
) -> SchemeSummary:
    _validate_scheme(payload)
    row = session.execute(
        text(
            "INSERT INTO template_schemes (name, description, locale, enabled) "
            "VALUES (:name, :description, :locale, :enabled) RETURNING id"
        ),
        payload.model_dump(exclude={"slots"}),
    ).scalar_one()
    scheme_id = int(row)
    for slot in payload.slots:
        session.execute(
            text(
                "INSERT INTO template_scheme_slots (scheme_id, slot_id, template_ref) "
                "VALUES (:scheme_id, :slot_id, :template_ref)"
            ),
            {"scheme_id": scheme_id, **slot.model_dump()},
        )
    return SchemeSummary(
        id=f"scheme:{scheme_id}",
        name=payload.name,
        description=payload.description,
        locale=payload.locale,
        source="custom",
        editable=True,
        enabled=payload.enabled,
        slots=payload.slots,
    )


@router.post("/preview", response_model=PreviewResponse)
def preview_template(
    payload: PreviewRequest, req: Request, session: Annotated[Session, Depends(get_session)]
) -> PreviewResponse:
    registry = getattr(req.app.state, "registry", None)
    if registry is None:
        raise HTTPException(status_code=503, detail="registry not booted")
    try:
        resolved = resolve_template_ref(session, payload.template_ref, locale=payload.locale)
        prompt = build_prompt(
            PromptInputs(
                template=resolved.template,
                image_brief=ThreePiece(
                    visual=payload.visual, copy=payload.copy_text, design_note=payload.design_note
                ),
                sku_meta=SkuMeta(
                    sku="PREVIEW",
                    name=payload.sample_name,
                    brand=payload.sample_brand,
                    category=payload.sample_category,
                    product_type="other",
                    price=0.0,
                ),
                brand_color_hex=payload.brand_color_hex,
                style_prompt=payload.style_prompt,
                locale=payload.locale,
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    adapter = (
        registry.get("image")
        if hasattr(registry, "adapters") and "image" in getattr(registry, "adapters", {})
        else registry.get("image_gen")
    )
    response = adapter.generate(prompt, size="1024x1024", n=1)
    png_path: str | None = None
    if response.images:
        root = (
            Path(os.environ.get("IMAGEGEN_OUTPUT_DIR", "/tmp/viskit-imagegen"))
            / "template-previews"
        )
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"preview-{int(time.time() * 1000)}.png"
        path.write_bytes(response.images[0])
        png_path = str(path)
    cost = 0.0
    if isinstance(response.raw, dict) and isinstance(response.raw.get("cost_usd"), (int, float)):
        cost = float(response.raw["cost_usd"])
    try:
        session.execute(
            text(
                "INSERT INTO template_preview_runs "
                "(template_ref, locale, sample_payload, prompt, png_path, cost_usd, status) "
                "VALUES (:template_ref, :locale, CAST(:sample_payload AS JSONB), "
                ":prompt, :png_path, :cost_usd, 'ready')"
            ),
            {
                "template_ref": payload.template_ref,
                "locale": payload.locale,
                "sample_payload": payload.model_dump_json(),
                "prompt": prompt,
                "png_path": png_path,
                "cost_usd": cost,
            },
        )
    except SQLAlchemyError:
        pass
    return PreviewResponse(prompt=prompt, png_path=png_path, cost_usd=cost)


__all__ = ["router", "TemplateSummary", "_CATEGORY_BY_ID"]
