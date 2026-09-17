"""Durable OMR worker: claim, process, persist, retry, and recover stale jobs."""
import base64
import hashlib
import hmac
import json
import logging
import os
import signal
import threading
import time
import uuid
from typing import Any

import httpx
import cv2
import numpy as np
import pypdfium2 as pdfium

from app.models import V2PageProcessingContext
from app.processing.qr_reader import read_qr

logging.basicConfig(level=os.getenv("OMR_LOG_LEVEL", "INFO"), format="%(message)s")
log = logging.getLogger("omr-worker")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_ID = os.getenv("OMR_WORKER_ID", f"worker-{uuid.uuid4()}")
SERVICE_URL = os.getenv("OMR_SERVICE_URL", "http://omr-service:8080").rstrip("/")
OMR_ENVIRONMENT = os.getenv("OMR_ENVIRONMENT", "production").strip().lower()
TOKEN = os.getenv("OMR_SERVICE_TOKEN")
if not TOKEN and OMR_ENVIRONMENT in {"local", "development", "dev", "test"}:
    TOKEN = "local-omr-development-token"
if not TOKEN:
    raise RuntimeError("OMR_SERVICE_TOKEN is required outside explicit local development")
POLL_SECONDS = float(os.getenv("OMR_WORKER_POLL_SECONDS", "2"))
CONCURRENCY = max(1, min(int(os.getenv("OMR_WORKER_CONCURRENCY", "2")), 10))
TIMEOUT = float(os.getenv("OMR_WORKER_TIMEOUT_SECONDS", "120"))
stop_event = threading.Event()


def _headers() -> dict[str, str]:
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json"}


def rpc(name: str, payload: dict[str, Any]) -> Any:
    response = httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}", headers=_headers(), json=payload, timeout=30)
    if response.status_code >= 400:
        raise RuntimeError(f"rpc_{name}_{response.status_code}:{response.text[:500]}")
    return response.json()


def query(table: str, params: dict[str, str]) -> Any:
    response = httpx.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(), params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def storage_download(bucket: str, path: str) -> bytes:
    response = httpx.get(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}", headers=_headers(), timeout=60)
    response.raise_for_status()
    return response.content


def storage_upload(bucket: str, path: str, content: bytes, content_type: str) -> None:
    headers = {**_headers(), "Content-Type": content_type, "x-upsert": "false"}
    response = httpx.post(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}", headers=headers, content=content, timeout=30)
    if response.status_code not in (200, 201):
        # A previous attempt may have uploaded the immutable artifact.
        if response.status_code != 409:
            response.raise_for_status()


def signed_body(body: str, request_id: str) -> dict[str, str]:
    timestamp = str(int(time.time()))
    digest = hashlib.sha256(body.encode()).hexdigest()
    signature = hmac.new(TOKEN.encode(), f"{timestamp}.{request_id}.{digest}".encode(), hashlib.sha256).hexdigest()
    return {"Content-Type": "application/json", "X-OMR-Request-Id": request_id, "X-OMR-Timestamp": timestamp, "X-OMR-Body-SHA256": digest, "X-OMR-Signature": signature}


def heartbeat(job_id: str) -> None:
    try:
        rpc("heartbeat_omr_processing_job", {"p_job_id": job_id, "p_worker_id": WORKER_ID})
    except Exception as exc:
        log.warning(json.dumps({"event": "heartbeat_failed", "job_id": job_id, "error": type(exc).__name__}))


def resolve_v2_page(token: str) -> dict[str, Any]:
    rows = rpc("resolve_v2_page_identity", {"p_page_token": token})
    if not rows:
        raise ValueError("omr_page_identity_not_found")
    return rows if isinstance(rows, dict) else rows[0]


def decode_v2_page_token(content: bytes, mime: str) -> str:
    pages: list[np.ndarray] = []
    if mime == "application/pdf" or content.startswith(b"%PDF-"):
        document = pdfium.PdfDocument(content)
        scale = 300 / 72.0
        for index in range(len(document)):
            bitmap = document[index].render(scale=scale)
            array = bitmap.to_numpy()
            pages.append(cv2.cvtColor(array, cv2.COLOR_RGBA2BGR) if array.shape[-1] == 4 else cv2.cvtColor(array, cv2.COLOR_RGB2BGR))
    else:
        image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is not None:
            pages.append(image)
    for image in pages:
        value, _warnings = read_qr(image)
        if value and value.startswith("v2:"):
            return value[3:]
    raise ValueError("omr_v2_page_identity_not_detected")


def load_v2_page_context(
    template: dict[str, Any],
    scan: dict[str, Any],
    job: dict[str, Any],
    content: bytes,
    mime: str,
) -> tuple[dict[str, Any], str] | None:
    if int(template.get("layout_schema_version", 1)) < 2:
        return None
    page_token = decode_v2_page_token(content, mime)
    page = resolve_v2_page(page_token)
    if str(page.get("bubble_sheet_id")) != str(template["id"]):
        raise ValueError("omr_v2_page_identity_sheet_mismatch")
    context_payload = rpc("get_v2_finalized_page_processing_context", {
        "p_page_token": page_token,
        "p_expected_bubble_sheet_id": template["id"],
    })
    context = V2PageProcessingContext.model_validate(context_payload)
    if str(context.sheet_id) != str(template["id"]) or str(context.exam_id) != str(scan["exam_id"]) or str(context.institution_id) != str(scan["institution_id"]):
        raise ValueError("omr_v2_page_context_identity_mismatch")
    if context.layout_schema_version != 2 or context.page_index != page["page_index"] or context.page_count != page["page_count"]:
        raise ValueError("omr_v2_page_context_metadata_mismatch")
    if any(question.page_number != context.page_index for question in context.questions):
        raise ValueError("omr_v2_page_context_question_page_mismatch")
    return context.model_dump(mode="json"), page_token


def classify(exc: Exception) -> tuple[str, str, str, bool]:
    text = str(exc).lower()
    permanent_tokens = (
        "invalid_omr_source", "unsupported_or_corrupt_image", "invalid_content_base64",
        "invalid_or_encrypted_pdf", "pdf_page_limit_exceeded", "omr_request_too_large",
        "omr_v2_page_identity_not_detected", "omr_v2_page_identity_sheet_mismatch",
        "omr_v2_page_context_identity_mismatch", "omr_v2_page_context_metadata_mismatch",
        "omr_v2_page_context_question_page_mismatch", "omr_page_identity_not_found",
        "omr_page_identity_version_mismatch", "qr_not_detected", "qr_payload_invalid",
        "qr_page_token_mismatch", "omr_template", "geometry", "page_mismatch",
        "template_scan_mismatch", "signed_url_host_not_allowed", "404 client error",
        "422", "400", "409",
    )
    if any(token in text for token in permanent_tokens):
        if "page" in text or "qr" in text or "template" in text or "geometry" in text:
            return "permanent", "omr_page_identity_invalid", "Page identity or template geometry is invalid; review the scan in Operations.", False
        return "permanent", "omr_invalid_input", "The scan is invalid or does not match the exam template.", False
    if any(token in text for token in ("timeout", "connect", "503", "502", "504", "429", "temporarily")):
        return "transient", "omr_transient_dependency", "تعذر الوصول إلى خدمة المعالجة مؤقتًا", True
    if any(token in text for token in ("invalid_or_encrypted_pdf", "corrupt", "unsupported", "413", "invalid_content")):
        return "permanent", "omr_invalid_input", "الملف غير صالح للمعالجة", False
    if "401" in text or "403" in text:
        return "permanent", "omr_dependency_unauthorized", "فشل التفويض لخدمة المعالجة", False
    return "transient", "omr_worker_exception", "حدث خطأ مؤقت أثناء المعالجة", True


def process(job: dict[str, Any]) -> None:
    job_id = job["id"]
    try:
        scan_rows = query("omr_results", {"select": "id,exam_id,bubble_sheet_id,original_storage_path,institution_id,student_profile_id,uploaded_by", "id": f"eq.{job['scan_id']}"})
        template_rows = query("bubble_sheets", {"select": "id,qr_token,questions_count,choices_count,layout_schema_version", "id": f"eq.{job['template_id']}"})
        if not scan_rows or not template_rows or not scan_rows[0].get("original_storage_path"):
            raise ValueError("invalid_omr_source")
        scan, template = scan_rows[0], template_rows[0]
        if scan.get("bubble_sheet_id") and str(job.get("template_id")) != str(scan["bubble_sheet_id"]):
            raise ValueError("omr_job_template_scan_mismatch")
        source_path = scan["original_storage_path"]
        content = storage_download("exam-sheets", source_path)
        mime = "application/pdf" if source_path.lower().endswith(".pdf") else "image/jpeg" if source_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        request_id = job["request_id"]
        loaded_v2_context = load_v2_page_context(template, scan, job, content, mime)
        v2_context, expected_v2_page_token = loaded_v2_context if loaded_v2_context is not None else (None, None)
        question_count = len(v2_context["questions"]) if v2_context is not None else template["questions_count"]
        choices_count = max((len(question["options"]) for question in (v2_context or {}).get("questions", [])), default=template["choices_count"])
        payload = {"request_id": request_id, "content_base64": base64.b64encode(content).decode(), "content_mime": mime,
                   "template": {"template_token": str(template["qr_token"]), "template_version": 1, "layout_schema_version": template.get("layout_schema_version", 1), "questions_count": question_count, "choices_count": max(2, choices_count), "columns": None},
                   **({
                       "v2_page_context": v2_context,
                       "expected_v2_page_token": expected_v2_page_token,
                   } if v2_context is not None else {})}
        body = json.dumps(payload, separators=(",", ":"))
        heartbeat(job_id)
        response = httpx.post(f"{SERVICE_URL}/v1/omr/analyze", headers=signed_body(body, request_id), content=body, timeout=TIMEOUT)
        if response.status_code >= 400:
            raise RuntimeError(response.text[:500])
        result = response.json()
        if template.get("layout_schema_version", 1) >= 2:
            detected = result.get("detected_qr") or ""
            if not detected.startswith("v2:"):
                raise ValueError("omr_v2_page_identity_not_detected")
            page = resolve_v2_page(detected[3:])
            if str(page.get("bubble_sheet_id")) != str(template["id"]):
                raise ValueError("omr_v2_page_identity_sheet_mismatch")
        annotated_path = None
        annotated = result.get("annotated_images") or []
        if annotated:
            annotated_path = f"{scan['institution_id']}/omr-processed/{scan['uploaded_by']}/{scan['exam_id']}/{job_id}/annotated.jpg"
            storage_upload("exam-sheets", annotated_path, base64.b64decode(annotated[0]), "image/jpeg")
        heartbeat(job_id)
        rpc("worker_complete_omr_processing_job", {"p_job_id": job_id, "p_worker_id": WORKER_ID, "p_status": result.get("processing_status", "failed"), "p_engine_version": "0.1.0", "p_processing_time_ms": result.get("processing_time_ms", 0), "p_document_confidence": result.get("document_confidence", 0), "p_warnings": result.get("warnings", []), "p_annotated_storage_path": annotated_path, "p_questions": result.get("questions", [])})
        log.info(json.dumps({"event": "job_completed", "job_id": job_id, "status": result.get("processing_status"), "attempt": job.get("attempt_count")}))
    except Exception as exc:
        error_class, code, safe, retryable = classify(exc)
        try:
            rpc("fail_omr_processing_job", {"p_job_id": job_id, "p_worker_id": WORKER_ID, "p_error_class": error_class, "p_error_code": code, "p_error_message_safe": safe, "p_retryable": retryable})
        except Exception as fail_exc:
            log.error(json.dumps({"event": "job_fail_persist_failed", "job_id": job_id, "error": type(fail_exc).__name__}))
        log.warning(json.dumps({"event": "job_failed", "job_id": job_id, "error_class": error_class, "error_code": code, "attempt": job.get("attempt_count")}))


def loop() -> None:
    last_recovery = 0.0
    while not stop_event.is_set():
        now = time.time()
        if now - last_recovery >= 30:
            try:
                rpc("recover_stale_omr_processing_jobs", {"p_timeout_seconds": 180})
            except Exception as exc:
                log.warning(json.dumps({"event": "recovery_failed", "error": type(exc).__name__}))
            last_recovery = now
        try:
            jobs = rpc("claim_next_omr_processing_jobs", {"p_worker_id": WORKER_ID, "p_limit": CONCURRENCY}) or []
            for job in jobs:
                if stop_event.is_set(): break
                process(job)
        except Exception as exc:
            log.warning(json.dumps({"event": "poll_failed", "error": type(exc).__name__}))
        stop_event.wait(POLL_SECONDS)


def shutdown(signum: int, _frame: Any) -> None:
    log.info(json.dumps({"event": "worker_shutdown", "signal": signum, "worker_id": WORKER_ID}))
    stop_event.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    log.info(json.dumps({"event": "worker_started", "worker_id": WORKER_ID, "concurrency": CONCURRENCY}))
    loop()
