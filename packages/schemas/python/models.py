"""
Stub Pydantic v2 models for AIShop schemas.
Handwritten fallback — overwritten by `pnpm gen:py` / `python3 scripts/gen-py.py`.
Source of truth: packages/schemas/openapi.yaml
"""
from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class LocaleEnum(StrEnum):
    zh = "zh"
    en = "en"


class MarketingKitStatus(StrEnum):
    queued = "queued"
    generating = "generating"
    ready = "ready"
    needs_review = "needs_review"
    failed = "failed"


class ModuleIdEnum(StrEnum):
    M1 = "M1"
    M2 = "M2"
    M3 = "M3"
    M4 = "M4"
    M5 = "M5"
    M6 = "M6"
    M7 = "M7"
    M8 = "M8"
    M9 = "M9"


class ProtocolEnum(StrEnum):
    openai_compatible = "openai_compatible"
    anthropic_compatible = "anthropic_compatible"


class RoleEnum(StrEnum):
    vision = "vision"
    llm = "llm"
    image_gen = "image_gen"
    image_edit = "image_edit"
    embedding = "embedding"
    compliance_screen = "compliance_screen"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Workbench(BaseModel):
    id: str = Field(..., description="UUID")
    name: str
    owner_user_id: str = Field(..., description="UUID")
    config_path: str | None = None
    created_at: str = Field(..., description="ISO 8601 date-time")


class ProductCatalog(BaseModel):
    id: str = Field(..., description="UUID")
    workbench_id: str = Field(..., description="UUID")
    sku: str
    name: str
    category: str | None = None
    price: float | None = None
    brand: str | None = None
    locale: LocaleEnum


class MarketingKit(BaseModel):
    id: str = Field(..., description="UUID")
    product_catalog_id: str = Field(..., description="UUID")
    status: MarketingKitStatus
    score: int | None = Field(None, ge=0, le=100)
    locale: LocaleEnum
    brand_color_hex: str = Field(..., pattern=r'^#[0-9A-Fa-f]{6}$')
    style_prompt: str = Field(..., min_length=1)
    created_at: str = Field(..., description="ISO 8601 date-time")
    updated_at: str | None = None


class CopywritingSpec(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    markdown: str
    compliance_passed: bool
    version: int = Field(default=1)


class HeroImage(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    slot_index: int = Field(..., ge=1, le=5)
    png_path: str
    template_id: str | None = None
    prompt: str
    brand_color_hex: str | None = None


class DetailImage(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    module_id: ModuleIdEnum
    png_path: str
    prompt: str
    brand_color_hex: str | None = None


class BestsellerCorpus(BaseModel):
    id: str = Field(..., description="UUID")
    image_path: str
    dense_vec: list[float] | None = None
    sparse_vec: dict[str, Any] | None = None
    sales: int
    category: str
    locale: LocaleEnum


class ViolationItem(BaseModel):
    rule_id: str | None = None
    severity: str | None = None
    location: str | None = None
    suggestion: str | None = None


class ComplianceCheck(BaseModel):
    id: str = Field(..., description="UUID")
    copywriting_spec_id: str = Field(..., description="UUID")
    ruleset_id: str
    score: int = Field(..., ge=0, le=100)
    violations: list[ViolationItem]
    advisory: bool = Field(default=False)


class QualityGate(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    threshold: int = Field(default=95)
    human_edit_seconds: int | None = None
    passed_at: str | None = None


class EditItem(BaseModel):
    index: int | None = None
    original: str | None = None
    new: str | None = None


class TextEditor(BaseModel):
    id: str = Field(..., description="UUID")
    image_id: str = Field(..., description="UUID")
    edits: list[EditItem]
    inpaint_model: str | None = None


class ModelProviderAdapter(BaseModel):
    id: str = Field(..., description="UUID")
    protocol: ProtocolEnum
    base_url: str = Field(..., description="URI")
    model_id: str
    role: RoleEnum
