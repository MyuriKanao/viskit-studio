"""POST /api/generation/plan — backend-owned output plan contract."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from apps.api.lib.db import get_session
from services.imagegen.template_library import builtin_ref, coerce_custom_template
from services.imagegen.template_loader import Template, list_templates
from services.providers.base import ChatLLM, Message

router = APIRouter(prefix="/api/generation", tags=["generation-plan"])

OutputDestinationType = Literal["kit_slot", "asset"]
OutputPlanSource = Literal["explicit", "recommended", "fallback", "manual"]


def _text_from_unknown(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("value", "title", "name", "label", "text", "evidence", "description"):
            nested = value.get(key)
            if nested not in (None, ""):
                return _text_from_unknown(nested)
        parts = [_text_from_unknown(part) for part in value.values()]
        return "：".join(part for part in parts if part)
    return str(value).strip()


class ProductProfileIn(BaseModel):
    name: str | None = None
    brand: str = ""
    category: str = ""
    product_type: str = ""
    price: float | None = None
    brand_color_hex: str = ""
    selling_points: list[str] = Field(default_factory=list)

    @field_validator("name", mode="before")
    @classmethod
    def _coerce_optional_text(cls, value: Any) -> str | None:
        text_value = _text_from_unknown(value)
        return text_value or None

    @field_validator("brand", "category", "product_type", "brand_color_hex", mode="before")
    @classmethod
    def _coerce_text(cls, value: Any) -> str:
        return _text_from_unknown(value)

    @field_validator("price", mode="before")
    @classmethod
    def _coerce_price(cls, value: Any) -> float | None:
        if isinstance(value, dict):
            value = value.get("value")
        if value in {None, ""}:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @field_validator("selling_points", mode="before")
    @classmethod
    def _coerce_selling_points(cls, value: Any) -> list[str]:
        if value is None:
            return []
        raw_points = value if isinstance(value, list) else [value]
        points: list[str] = []
        for point in raw_points:
            if isinstance(point, str):
                text_value = point.strip()
            elif isinstance(point, dict):
                title = _text_from_unknown(point.get("title") or point.get("name"))
                evidence = _text_from_unknown(
                    point.get("evidence") or point.get("description")
                )
                value = point.get("value")
                if isinstance(value, dict):
                    title = title or _text_from_unknown(value.get("title") or value.get("name"))
                    evidence = evidence or _text_from_unknown(
                        value.get("evidence") or value.get("description")
                    )
                text_value = "：".join(part for part in (title, evidence) if part)
                if not text_value:
                    text_value = _text_from_unknown(value or point)
            else:
                text_value = str(point).strip()
            if text_value:
                points.append(text_value)
        return points


class GenerationPlanRequest(BaseModel):
    kit_client_id: str
    source_image_ref: str
    user_prompt: str | None = None
    locale: Literal["zh", "en"] = "zh"
    product: ProductProfileIn
    explicit_template_refs: list[str] | None = None

    @field_validator("locale", mode="before")
    @classmethod
    def _coerce_locale(cls, value: Any) -> str:
        raw = _text_from_unknown(value).lower() or "zh"
        return "en" if raw.startswith("en") else "zh"

    @field_validator("kit_client_id", "source_image_ref", mode="before")
    @classmethod
    def _coerce_required_text(cls, value: Any) -> str:
        return _text_from_unknown(value)

    @field_validator("user_prompt", mode="before")
    @classmethod
    def _coerce_user_prompt(cls, value: Any) -> str | None:
        text_value = _text_from_unknown(value)
        return text_value or None

    @field_validator("explicit_template_refs", mode="before")
    @classmethod
    def _coerce_explicit_template_refs(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        refs = value if isinstance(value, list) else [value]
        normalized = [_text_from_unknown(ref) for ref in refs]
        return [ref for ref in normalized if ref] or None


class GenerationPlanItemOut(BaseModel):
    id: str
    output_kind: str
    title: str
    reason: str | None = None
    template_ref: str | None = None
    template_name: str | None = None
    aspect_ratio: str | None = None
    destination_type: OutputDestinationType = "asset"
    slot_id: str | None = None
    enabled: bool = True


class GenerationPlanOut(BaseModel):
    plan_id: str
    source_image_ref: str
    plan_source: OutputPlanSource
    requires_confirmation: bool
    items: list[GenerationPlanItemOut]
    user_prompt: str | None = None
    planner_note: str | None = None
    planner_payload: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class TemplateOption:
    ref: str
    template: Template
    extra_text: str = ""


def _plan_item(
    request: GenerationPlanRequest,
    index: int,
    *,
    template_ref: str,
    template_name: str,
    template_id: str,
    output_kind: str,
    title: str,
    reason: str,
    aspect_ratio: str,
) -> GenerationPlanItemOut:
    return GenerationPlanItemOut(
        id=f"recommended-{index + 1}-{template_id}",
        output_kind=output_kind,
        title=title,
        reason=reason,
        template_ref=template_ref,
        template_name=template_name,
        aspect_ratio=aspect_ratio,
        destination_type="asset",
        slot_id=None,
        enabled=True,
    )


_TEMPLATE_INTENTS: dict[str, tuple[str, ...]] = {
    "magazine-editorial": (
        "杂志",
        "杂志大片",
        "杂志封面",
        "封面",
        "大片",
        "时尚大片",
        "magazine",
        "magazine cover",
        "cover",
        "editorial",
        "fashion editorial",
    ),
    "social-media": ("小红书", "社媒", "社交媒体", "rednote", "social", "instagram"),
    "poster-banner": ("促销", "活动", "banner", "poster", "campaign", "sale", "海报"),
    "hero-image": ("白底", "纯色底", "产品主图", "主图", "white background", "main image"),
    "detail-macro": ("细节", "微距", "成分", "texture", "detail", "macro", "材质"),
    "luxury-atmospherics": ("品牌大片", "高级感", "奢华", "luxury", "premium"),
    "model-showcase": ("模特", "人像", "model", "穿搭", "上身"),
    "ugc-style": ("ugc", "买家秀", "真人", "种草"),
}


def _template_kind(template_id: str) -> str:
    if template_id == "hero-image":
        return "product_main"
    if template_id in {"poster-banner", "magazine-editorial", "seasonal-campaign"}:
        return "poster"
    if template_id in {"detail-macro", "size-spec", "infographic", "exploded-view"}:
        return "detail"
    if template_id == "social-media":
        return "custom"
    return "custom"


def _template_aspect_ratio(template_id: str, output_kind: str) -> str:
    if template_id == "poster-banner":
        return "16:9"
    if template_id in {"magazine-editorial", "model-showcase", "ugc-style"}:
        return "4:5"
    if output_kind in {"poster", "detail"}:
        return "3:4"
    return "1:1"


def _template_blob(option: TemplateOption) -> str:
    template = option.template
    values: list[str] = [
        template.id,
        template.name,
        option.extra_text,
        *template.prompt_template.values(),
        *template.defaults.values(),
        *template.category_tips.values(),
        *template.examples,
    ]
    values.extend(str(key) for key in template.variants.keys())
    return " ".join(values).casefold()


def _load_template_options(session: Session, locale: Literal["zh", "en"]) -> list[TemplateOption]:
    options = [
        TemplateOption(ref=builtin_ref(locale, template.id), template=template)
        for template in list_templates(locale)
    ]
    try:
        rows = session.execute(
            text(
                "SELECT id, locale, name, description, prompt_template, defaults, variants,"
                " category_tips, examples, supports_image_reference, enabled"
                " FROM custom_templates WHERE locale = :locale AND enabled = 1 ORDER BY id ASC"
            ),
            {"locale": locale},
        ).all()
    except SQLAlchemyError:
        rows = []
    for row in rows:
        data = row._mapping
        template = coerce_custom_template(data)
        options.append(
            TemplateOption(
                ref=f"custom:{data['id']}",
                template=template,
                extra_text=str(data.get("description") or ""),
            )
        )
    return options


def _score_template(option: TemplateOption, query: str) -> int:
    template_id = option.template.id
    blob = _template_blob(option)
    score = 0
    if template_id in query:
        score += 60
    if option.template.name.casefold() in query:
        score += 60
    for mapped_id, keywords in _TEMPLATE_INTENTS.items():
        matched = [keyword for keyword in keywords if keyword.casefold() in query]
        if not matched:
            continue
        if template_id == mapped_id:
            score += 40 + len(matched) * 8
        elif any(keyword.casefold() in blob for keyword in matched):
            score += len(matched) * 3
    for token in re.findall(r"[a-z0-9_-]{3,}", query):
        if token in blob:
            score += 2
    return score


def _option_by_template_id(options: list[TemplateOption], template_id: str) -> TemplateOption:
    for option in options:
        if option.template.id == template_id:
            return option
    raise LookupError(template_id)


def _json_object_from_text(text_value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text_value)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text_value, re.S)
        if match is None:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def _llm_template_recommendation(
    request: Request,
    *,
    payload: GenerationPlanRequest,
    options: list[TemplateOption],
) -> tuple[list[str], str | None, str | None]:
    registry = getattr(request.app.state, "registry", None)
    if registry is None:
        return [], None, None
    try:
        adapter = registry.get("llm")
    except Exception:
        return [], None, None
    if not isinstance(adapter, ChatLLM):
        return [], None, None

    catalog = [
        {
            "template_ref": option.ref,
            "id": option.template.id,
            "name": option.template.name,
            "keywords": list(_TEMPLATE_INTENTS.get(option.template.id, ())),
            "examples": list(option.template.examples[:2]),
        }
        for option in options
    ]
    prompt = {
        "user_prompt": payload.user_prompt,
        "product": payload.product.model_dump(mode="json"),
        "templates": catalog,
        "instruction": (
            "根据用户提示词选择最匹配的模板引用。只返回 JSON："
            "{\"template_refs\":[...],\"custom_title\":null|string,\"reason\":\"...\"}。"
            "如果模板库没有对应方案，template_refs 返回空数组，并用 custom_title "
            "概括用户真正想生成的画面。"
        ),
    }
    try:
        response = adapter.complete(
            [
                Message(
                    role="system",
                    content=(
                        "You are a template planner for an image-generation product. "
                        "Pick template refs from the provided catalog only. Return JSON only."
                    ),
                ),
                Message(role="user", content=json.dumps(prompt, ensure_ascii=False)),
            ],
            max_tokens=512,
        )
    except Exception:
        return [], None, None

    parsed = _json_object_from_text(response.text)
    if parsed is None:
        return [], None, None
    valid_refs = {option.ref for option in options}
    refs = [
        ref
        for ref in parsed.get("template_refs", [])
        if isinstance(ref, str) and ref in valid_refs
    ][:4]
    custom_title = parsed.get("custom_title")
    reason = parsed.get("reason")
    clean_custom_title = (
        custom_title.strip()[:48]
        if isinstance(custom_title, str) and custom_title.strip()
        else None
    )
    clean_reason = reason.strip()[:160] if isinstance(reason, str) and reason.strip() else None
    return refs, clean_custom_title, clean_reason


def _item_from_option(
    payload: GenerationPlanRequest,
    index: int,
    option: TemplateOption,
    *,
    reason: str,
    title: str | None = None,
) -> GenerationPlanItemOut:
    output_kind = _template_kind(option.template.id)
    return _plan_item(
        payload,
        index,
        template_ref=option.ref,
        template_name=option.template.name,
        template_id=option.template.id,
        output_kind=output_kind,
        title=title or option.template.name,
        reason=reason,
        aspect_ratio=_template_aspect_ratio(option.template.id, output_kind),
    )


@router.post("/plan", response_model=GenerationPlanOut)
def create_generation_plan(
    payload: GenerationPlanRequest,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> GenerationPlanOut:
    """Create the initial editable output plan for the generation workflow.

    This endpoint intentionally owns the compatibility/default planning
    contract so the frontend can fail loudly when the backend route is broken
    instead of silently manufacturing a local plan.
    """
    reason = "根据用户提示词和模板库推荐，可按需编辑。"
    prompt_parts = [
        payload.user_prompt or "",
        payload.product.brand,
        payload.product.category,
        payload.product.product_type,
        *payload.product.selling_points,
    ]
    prompt = " ".join(part for part in prompt_parts if part).casefold()
    options = _load_template_options(session, payload.locale)
    selected: list[TemplateOption] = []
    planner_strategy = "local"
    llm_custom_title: str | None = None
    llm_reason: str | None = None

    explicit_refs = [ref for ref in (payload.explicit_template_refs or []) if ref]
    if explicit_refs:
        refs = set(explicit_refs)
        selected.extend(option for option in options if option.ref in refs)
        planner_strategy = "explicit"

    if not selected:
        llm_refs, llm_custom_title, llm_reason = _llm_template_recommendation(
            request, payload=payload, options=options
        )
        if llm_refs:
            refs = set(llm_refs)
            selected.extend(option for option in options if option.ref in refs)
            planner_strategy = "llm"

    matched_template = bool(selected)
    if not selected:
        scored = sorted(
            ((option, _score_template(option, prompt)) for option in options),
            key=lambda pair: pair[1],
            reverse=True,
        )
        best, best_score = scored[0]
        if best_score >= 20:
            selected.append(best)
            matched_template = True
            planner_strategy = "local"

    if not selected:
        selected.append(_option_by_template_id(options, "creative-concept"))
        planner_strategy = "llm-custom" if llm_custom_title else "user-demand"

    wants_companion_social = bool(re.search(r"宣传|推广|小红书|社媒|social|rednote", prompt, re.I))
    wants_banner = bool(re.search(r"促销|活动|banner|poster|campaign|sale|海报", prompt, re.I))
    companion_id = "poster-banner" if wants_banner else "social-media"
    if matched_template and (wants_companion_social or wants_banner):
        companion = _option_by_template_id(options, companion_id)
        if all(option.template.id != companion.template.id for option in selected):
            selected.append(companion)

    fallback_title = None
    fallback_reason = reason
    if not matched_template and (payload.user_prompt or "").strip():
        fallback_title = llm_custom_title or (payload.user_prompt or "").strip()[:48]
        fallback_reason = (
            llm_reason or "模板库没有命中明确方案，已按用户提示词自动生成自定义输出方案。"
        )

    items = [
        _item_from_option(
            payload,
            index,
            option,
            reason=fallback_reason if index == 0 else reason,
            title=fallback_title if index == 0 else None,
        )
        for index, option in enumerate(selected[:4])
    ]
    return GenerationPlanOut(
        plan_id=f"plan-{int(time.time() * 1000)}",
        source_image_ref=payload.source_image_ref,
        plan_source="recommended",
        requires_confirmation=True,
        items=items,
        user_prompt=payload.user_prompt,
        planner_note="template-library-plan" if matched_template else "user-demand-generated-plan",
        planner_payload={
            "kit_client_id": payload.kit_client_id,
            "product": payload.product.model_dump(mode="json"),
            "explicit_template_refs": payload.explicit_template_refs or [],
            "selected_templates": [item.template_ref for item in items],
            "planner_strategy": planner_strategy,
        },
    )
