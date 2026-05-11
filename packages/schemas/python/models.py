"""
Stub Pydantic v2 models for AIShop schemas.
Handwritten fallback — overwritten by `pnpm gen:py` / `python3 scripts/gen-py.py`.
Source of truth: packages/schemas/openapi.yaml
"""
from __future__ import annotations

from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class LocaleEnum(str, Enum):
    zh = "zh"
    en = "en"


class MarketingKitStatus(str, Enum):
    queued = "queued"
    generating = "generating"
    ready = "ready"
    needs_review = "needs_review"
    failed = "failed"


class ModuleIdEnum(str, Enum):
    M1 = "M1"
    M2 = "M2"
    M3 = "M3"
    M4 = "M4"
    M5 = "M5"
    M6 = "M6"
    M7 = "M7"
    M8 = "M8"
    M9 = "M9"


class ProtocolEnum(str, Enum):
    openai_compatible = "openai_compatible"
    anthropic_compatible = "anthropic_compatible"


class RoleEnum(str, Enum):
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
    config_path: Optional[str] = None
    created_at: str = Field(..., description="ISO 8601 date-time")


class ProductCatalog(BaseModel):
    id: str = Field(..., description="UUID")
    workbench_id: str = Field(..., description="UUID")
    sku: str
    name: str
    category: Optional[str] = None
    price: Optional[float] = None
    brand: Optional[str] = None
    locale: LocaleEnum


class MarketingKit(BaseModel):
    id: str = Field(..., description="UUID")
    product_catalog_id: str = Field(..., description="UUID")
    status: MarketingKitStatus
    score: Optional[int] = Field(None, ge=0, le=100)
    locale: LocaleEnum
    brand_color_hex: str = Field(..., pattern=r'^#[0-9A-Fa-f]{6}$')
    style_prompt: str = Field(..., min_length=1)
    created_at: str = Field(..., description="ISO 8601 date-time")
    updated_at: Optional[str] = None


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
    template_id: Optional[str] = None
    prompt: str
    brand_color_hex: Optional[str] = None


class DetailImage(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    module_id: ModuleIdEnum
    png_path: str
    prompt: str
    brand_color_hex: Optional[str] = None


class BestsellerCorpus(BaseModel):
    id: str = Field(..., description="UUID")
    image_path: str
    dense_vec: Optional[List[float]] = None
    sparse_vec: Optional[dict[str, Any]] = None
    sales: int
    category: str
    locale: LocaleEnum


class ViolationItem(BaseModel):
    rule_id: Optional[str] = None
    severity: Optional[str] = None
    location: Optional[str] = None
    suggestion: Optional[str] = None


class ComplianceCheck(BaseModel):
    id: str = Field(..., description="UUID")
    copywriting_spec_id: str = Field(..., description="UUID")
    ruleset_id: str
    score: int = Field(..., ge=0, le=100)
    violations: List[ViolationItem]
    advisory: bool = Field(default=False)


class QualityGate(BaseModel):
    id: str = Field(..., description="UUID")
    marketing_kit_id: str = Field(..., description="UUID")
    threshold: int = Field(default=95)
    human_edit_seconds: Optional[int] = None
    passed_at: Optional[str] = None


class EditItem(BaseModel):
    index: Optional[int] = None
    original: Optional[str] = None
    new: Optional[str] = None


class TextEditor(BaseModel):
    id: str = Field(..., description="UUID")
    image_id: str = Field(..., description="UUID")
    edits: List[EditItem]
    inpaint_model: Optional[str] = None


class ModelProviderAdapter(BaseModel):
    id: str = Field(..., description="UUID")
    protocol: ProtocolEnum
    base_url: str = Field(..., description="URI")
    model_id: str
    role: RoleEnum
