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

logging.basicConfig(level=os.getenv("OMR_LOG_LEVEL", "INFO"), format="%(message)s")
log = logging.getLogger("omr-worker")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_ID = os.getenv("OMR_WORKER_ID", f"worker-{uuid.uuid4()}")
SERVICE_URL = os.getenv("OMR_SERVICE_URL", "http://omr-service:8080").rstrip("/")
TOKEN = os.getenv("OMR_SERVICE_TOKEN", "local-omr-development-token")
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


def classify(exc: Exception) -> tuple[str, str, str, bool]:
    text = str(exc).lower()
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
        template_rows = query("bubble_sheets", {"select": "id,qr_token,questions_count,choices_count", "id": f"eq.{job['template_id']}"})
        if not scan_rows or not template_rows or not scan_rows[0].get("original_storage_path"):
            raise ValueError("invalid_omr_source")
        scan, template = scan_rows[0], template_rows[0]
        source_path = scan["original_storage_path"]
        content = storage_download("exam-sheets", source_path)
        mime = "application/pdf" if source_path.lower().endswith(".pdf") else "image/jpeg" if source_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        request_id = job["request_id"]
        payload = {"request_id": request_id, "content_base64": base64.b64encode(content).decode(), "content_mime": mime,
                   "template": {"template_token": str(template["qr_token"]), "template_version": 1, "questions_count": template["questions_count"], "choices_count": template["choices_count"], "columns": None}}
        body = json.dumps(payload, separators=(",", ":"))
        heartbeat(job_id)
        response = httpx.post(f"{SERVICE_URL}/v1/omr/analyze", headers=signed_body(body, request_id), content=body, timeout=TIMEOUT)
        if response.status_code >= 400:
            raise RuntimeError(response.text[:500])
        result = response.json()
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


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)
log.info(json.dumps({"event": "worker_started", "worker_id": WORKER_ID, "concurrency": CONCURRENCY}))
loop()
