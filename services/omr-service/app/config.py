from functools import lru_cache
from pydantic import BaseModel, Field


class Settings(BaseModel):
    service_name: str = "examify-omr-service"
    service_version: str = "0.1.0"
    service_token: str = Field(default="local-omr-development-token")
    max_request_bytes: int = 25 * 1024 * 1024
    max_pages: int = 20
    pdf_dpi: int = 300
    max_dimension: int = 5000
    request_timeout_seconds: float = 10.0
    minimum_mark_fill: float = 0.22
    blank_threshold: float = 0.16
    multiple_mark_delta: float = 0.10
    low_confidence_threshold: float = 0.62
    document_confidence_threshold: float = 0.70
    maximum_skew_angle: float = 12.0


@lru_cache
def get_settings() -> Settings:
    return Settings(
        service_token=__import__("os").environ.get(
            "OMR_SERVICE_TOKEN", "local-omr-development-token"
        ),
        max_request_bytes=int(__import__("os").environ.get("OMR_MAX_REQUEST_BYTES", 25 * 1024 * 1024)),
        max_pages=int(__import__("os").environ.get("OMR_MAX_PAGES", 20)),
        pdf_dpi=int(__import__("os").environ.get("OMR_PDF_DPI", 300)),
    )
