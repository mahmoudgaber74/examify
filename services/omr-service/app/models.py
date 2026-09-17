from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


Status = Literal[
    "correct", "incorrect", "selected", "blank", "multiple_marks", "low_confidence",
    "unreadable", "needs_review",
]


class TemplateMetadata(BaseModel):
    template_token: str | None = None
    template_version: int = Field(ge=1)
    layout_schema_version: int = Field(default=1, ge=1)
    questions_count: int = Field(gt=0, le=500)
    choices_count: int = Field(ge=2, le=8)
    columns: int | None = Field(default=None, ge=1, le=8)
    model_label: str | None = None
    include_student_name: bool = True
    include_student_id: bool = True
    answer_key: dict[int, str] | None = None


class NormalizedRegion(BaseModel):
    x: float
    y: float
    width: float
    height: float


class V2PageProcessingOption(BaseModel):
    snapshot_option_id: UUID
    source_option_id: UUID
    label: str
    visual_index: int
    canonical_option_ordinal: int | None = None
    region: NormalizedRegion


class V2PageProcessingQuestion(BaseModel):
    snapshot_question_id: UUID
    exam_question_id: UUID | None = None
    question_id: UUID
    question_type: str | None = None
    points_snapshot: float | None = None
    global_question_number: int
    page_number: int
    region: NormalizedRegion
    options: list[V2PageProcessingOption]


class V2PageProcessingContext(BaseModel):
    sheet_id: UUID
    page_id: UUID
    page_index: int
    page_count: int
    institution_id: UUID
    exam_id: UUID
    layout_schema_version: int
    orientation: str
    questions: list[V2PageProcessingQuestion]


class AnalyzeRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=128)
    template: TemplateMetadata
    signed_url: str | None = None
    content_base64: str | None = None
    content_mime: Literal["image/png", "image/jpeg", "image/webp", "application/pdf"] | None = None
    v2_page_context: V2PageProcessingContext | None = None
    expected_v2_page_token: UUID | None = None

    @field_validator("content_base64", "signed_url")
    @classmethod
    def at_least_one_source(cls, value: str | None, info):
        return value


class QuestionResult(BaseModel):
    question_number: int
    detected_option: str | None
    detected_option_id: str | None = None
    fill_scores: dict[str, float]
    confidence: float = Field(ge=0, le=1)
    status: Status
    needs_manual_review: bool = False
    is_correct: bool | None = None
    score: float = 0
    bounding_boxes: dict[str, list[int]] = {}
    warnings: list[str] = []


class AnalyzeResponse(BaseModel):
    request_id: str
    template_token: str | None
    page_count: int
    processing_status: Literal["completed", "needs_review", "failed"]
    processing_time_ms: int
    detected_qr: str | None
    document_confidence: float
    questions: list[QuestionResult]
    warnings: list[str]
    requires_manual_review: bool
    annotated_images: list[str] = []


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    opencv_version: str
    supported_formats: list[str]
