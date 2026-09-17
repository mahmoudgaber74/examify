import os
from functools import lru_cache
from pydantic import BaseModel


class Settings(BaseModel):
    service_name: str = "examify-omr-service"
    service_version: str = "0.1.0"
    service_token: str
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
    environment = os.environ.get("OMR_ENVIRONMENT", "production").strip().lower()
    service_token = os.environ.get("OMR_SERVICE_TOKEN")
    if not service_token:
        if environment in {"local", "development", "dev", "test"}:
            service_token = "local-omr-development-token"
        else:
            raise RuntimeError("OMR_SERVICE_TOKEN is required outside explicit local development")
    return Settings(
        service_token=service_token,
        max_request_bytes=int(os.environ.get("OMR_MAX_REQUEST_BYTES", 25 * 1024 * 1024)),
        max_pages=int(os.environ.get("OMR_MAX_PAGES", 20)),
        pdf_dpi=int(os.environ.get("OMR_PDF_DPI", 300)),
    )
