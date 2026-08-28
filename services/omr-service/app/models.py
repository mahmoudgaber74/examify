from typing import Literal
from pydantic import BaseModel, Field, field_validator


Status = Literal[
    "correct", "incorrect", "blank", "multiple_marks", "low_confidence",
    "unreadable", "needs_review",
]


class TemplateMetadata(BaseModel):
    template_token: str | None = None
    template_version: int = Field(ge=1)
    questions_count: int = Field(gt=0, le=500)
    choices_count: int = Field(ge=2, le=8)
    columns: int | None = Field(default=None, ge=1, le=8)
    model_label: str | None = None
    include_student_name: bool = True
    include_student_id: bool = True
    answer_key: dict[int, str] | None = None


class AnalyzeRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=128)
    template: TemplateMetadata
    signed_url: str | None = None
    content_base64: str | None = None
    content_mime: Literal["image/png", "image/jpeg", "image/webp", "application/pdf"] | None = None

    @field_validator("content_base64", "signed_url")
    @classmethod
    def at_least_one_source(cls, value: str | None, info):
        return value


class QuestionResult(BaseModel):
    question_number: int
    detected_option: str | None
    fill_scores: dict[str, float]
    confidence: float = Field(ge=0, le=1)
    status: Status
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
