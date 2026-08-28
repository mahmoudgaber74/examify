import base64
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from collections import deque

import cv2
import numpy as np
import pypdfium2 as pdfium
from fastapi import FastAPI, HTTPException, Request

from .config import get_settings
from .models import AnalyzeRequest, AnalyzeResponse, HealthResponse, TemplateMetadata
from .processing.annotations import annotate
from .processing.bubble_detector import build_grid, detect_bubbles
from .processing.document_detector import registration_mark_confidence
from .processing.preprocess import detect_document, normalize_for_omr
from .processing.qr_reader import read_qr
from .processing.scoring import summarize

settings = get_settings()
app = FastAPI(title="Examify OpenCV OMR Service", version=settings.service_version)
seen_requests: deque[tuple[str, float]] = deque(maxlen=2048)


def _authorize(request: Request, body: bytes, request_id: str) -> None:
    timestamp = request.headers.get("x-omr-timestamp", "")
    signature = request.headers.get("x-omr-signature", "")
    body_hash = request.headers.get("x-omr-body-sha256", "")
    if request.headers.get("x-omr-request-id", "") != request_id:
        raise HTTPException(status_code=401, detail="omr_request_id_mismatch")
    expected_hash = hashlib.sha256(body).hexdigest()
    try:
        age = abs(time.time() - float(timestamp))
    except ValueError:
        age = settings.request_timeout_seconds + 1
    expected = hmac.new(settings.service_token.encode(), f"{timestamp}.{request_id}.{body_hash}".encode(), hashlib.sha256).hexdigest()
    if age > settings.request_timeout_seconds or not hmac.compare_digest(body_hash, expected_hash) or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="unauthorized_omr_request")
    now = time.time()
    while seen_requests and now - seen_requests[0][1] > settings.request_timeout_seconds:
        seen_requests.popleft()
    if any(item[0] == request_id for item in seen_requests):
        raise HTTPException(status_code=409, detail="omr_request_replay")
    seen_requests.append((request_id, now))


def _read_url(url: str) -> tuple[bytes, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise HTTPException(status_code=400, detail="signed_url_host_not_allowed_local")
    request = urllib.request.Request(url, headers={"User-Agent": "Examify-OMR/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=settings.request_timeout_seconds) as response:
            content_type = (response.headers.get_content_type() or "").lower()
            body = response.read(settings.max_request_bytes + 1)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="signed_url_fetch_failed") from exc
    if len(body) > settings.max_request_bytes:
        raise HTTPException(status_code=413, detail="omr_request_too_large")
    return body, content_type


def _source(payload: AnalyzeRequest) -> tuple[bytes, str]:
    if bool(payload.signed_url) == bool(payload.content_base64):
        raise HTTPException(status_code=400, detail="exactly_one_scan_source_required")
    if payload.content_base64:
        try:
            body = base64.b64decode(payload.content_base64, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid_content_base64") from exc
        if len(body) > settings.max_request_bytes:
            raise HTTPException(status_code=413, detail="omr_request_too_large")
        return body, payload.content_mime or "application/octet-stream"
    return _read_url(payload.signed_url or "")


def _pages(body: bytes, mime: str) -> list[np.ndarray]:
    if body.startswith(b"%PDF-") or mime == "application/pdf":
        try:
            document = pdfium.PdfDocument(body)
            if len(document) > settings.max_pages:
                raise HTTPException(status_code=413, detail="pdf_page_limit_exceeded")
            pages: list[np.ndarray] = []
            scale = settings.pdf_dpi / 72.0
            for index in range(len(document)):
                bitmap = document[index].render(scale=scale)
                array = bitmap.to_numpy()
                pages.append(cv2.cvtColor(array, cv2.COLOR_RGBA2BGR) if array.shape[-1] == 4 else cv2.cvtColor(array, cv2.COLOR_RGB2BGR))
            return pages
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid_or_encrypted_pdf") from exc
    array = np.frombuffer(body, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="unsupported_or_corrupt_image")
    if max(image.shape[:2]) > settings.max_dimension:
        scale = settings.max_dimension / max(image.shape[:2])
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return [image]


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service=settings.service_name, version=settings.service_version, opencv_version=cv2.__version__, supported_formats=["image/png", "image/jpeg", "image/webp", "application/pdf"])


@app.post("/v1/omr/analyze", response_model=AnalyzeResponse)
async def analyze(request: Request) -> AnalyzeResponse:
    started = time.perf_counter()
    body = await request.body()
    if len(body) > settings.max_request_bytes * 2:
        raise HTTPException(status_code=413, detail="omr_request_too_large")
    try:
        payload = AnalyzeRequest.model_validate(json.loads(body))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid_omr_request") from exc
    _authorize(request, body, payload.request_id)
    raw, mime = _source(payload)
    pages = _pages(raw, mime)
    all_questions = []
    all_annotations = []
    all_warnings: list[str] = []
    detected_qr: str | None = None
    document_scores: list[float] = []
    offset = 0
    for page in pages:
        prepared = detect_document(page)
        document_scores.append(prepared.document_confidence)
        gray, binary = normalize_for_omr(prepared.image)
        qr_value, qr_warnings = read_qr(prepared.image)
        detected_qr = detected_qr or qr_value
        mark_confidence = registration_mark_confidence(binary)
        page_warnings = prepared.warnings + qr_warnings
        page_capacity = build_grid(payload.template).rows_per_column * build_grid(payload.template).columns
        page_count = min(page_capacity, payload.template.questions_count - offset)
        if page_count <= 0:
            break
        key = {number - offset: label for number, label in (payload.template.answer_key or {}).items() if offset < number <= offset + page_count}
        page_template = payload.template.model_copy(update={"questions_count": page_count, "answer_key": key})
        page_questions = detect_bubbles(binary, page_template, settings)
        for question in page_questions:
            question.question_number += offset
        all_questions.extend(page_questions)
        all_warnings.extend(page_warnings)
        all_annotations.append(annotate(prepared.image, page_questions))
        document_scores.append(mark_confidence)
        offset += page_count
    document_confidence = round(float(np.mean(document_scores)) if document_scores else 0.0, 4)
    question_confidence, needs_review, warnings = summarize(all_questions, document_confidence, all_warnings)
    processing_status = "needs_review" if needs_review else "completed"
    if detected_qr and payload.template.template_token:
        try:
            token = json.loads(detected_qr).get("t")
            if token != payload.template.template_token:
                warnings.append("qr_template_token_mismatch")
                needs_review = True
                processing_status = "needs_review"
        except (json.JSONDecodeError, AttributeError):
            warnings.append("qr_payload_invalid")
            needs_review = True
            processing_status = "needs_review"
    return AnalyzeResponse(request_id=payload.request_id, template_token=payload.template.template_token, page_count=len(pages), processing_status=processing_status, processing_time_ms=int((time.perf_counter() - started) * 1000), detected_qr=detected_qr, document_confidence=document_confidence, questions=all_questions, warnings=sorted(set(warnings)), requires_manual_review=needs_review, annotated_images=all_annotations)
