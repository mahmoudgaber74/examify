from fastapi.testclient import TestClient
import base64
import io
from PIL import Image

from app.main import app
from .conftest import image_payload, signed_headers, synthetic_sheet


client = TestClient(app)


def test_health_and_secure_analyze():
    assert client.get("/health").status_code == 200
    body = image_payload(synthetic_sheet())
    raw = __import__("json").dumps(body, separators=(",", ":")).encode()
    response = client.post("/v1/omr/analyze", content=raw, headers={**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["page_count"] == 1
    assert payload["detected_qr"]
    assert payload["annotated_images"][0].startswith("data:image/jpeg;base64,")
    assert any(question["status"] == "multiple_marks" for question in payload["questions"])
    assert payload["requires_manual_review"] is True


def test_rejects_unauthorized_and_replay():
    body = image_payload(synthetic_sheet(), request_id="replay-request-001")
    assert client.post("/v1/omr/analyze", json=body).status_code == 401
    raw = __import__("json").dumps(body, separators=(",", ":")).encode()
    headers = {**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"}
    assert client.post("/v1/omr/analyze", content=raw, headers=headers).status_code == 200
    assert client.post("/v1/omr/analyze", content=raw, headers=headers).status_code == 409


def test_rejects_tampered_body_and_expired_signature():
    body = image_payload(synthetic_sheet(), request_id="tamper-request-001")
    raw = __import__("json").dumps(body, separators=(",", ":")).encode()
    headers = {**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"}
    altered = raw.replace(b'"image/png"', b'"image/jpeg"')
    assert client.post("/v1/omr/analyze", content=altered, headers=headers).status_code == 401
    expired = dict(headers)
    expired["X-OMR-Timestamp"] = "1"
    assert client.post("/v1/omr/analyze", content=raw, headers=expired).status_code == 401


def test_rejects_qr_template_mismatch():
    body = image_payload(synthetic_sheet(), request_id="mismatch-request-001")
    body["template"]["template_token"] = "different-token"
    raw = __import__("json").dumps(body, separators=(",", ":")).encode()
    response = client.post("/v1/omr/analyze", content=raw, headers={**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"})
    assert response.status_code == 200
    assert "qr_template_token_mismatch" in response.json()["warnings"]
    assert response.json()["requires_manual_review"] is True


def test_rasterizes_multi_page_pdf_inside_service():
    first = Image.open(io.BytesIO(synthetic_sheet())).convert("RGB")
    second = first.copy()
    pdf = io.BytesIO()
    first.save(pdf, format="PDF", save_all=True, append_images=[second])
    body = image_payload(pdf.getvalue(), request_id="pdf-request-001")
    body["content_base64"] = base64.b64encode(pdf.getvalue()).decode("ascii")
    body["content_mime"] = "application/pdf"
    raw = __import__("json").dumps(body, separators=(",", ":")).encode()
    response = client.post("/v1/omr/analyze", content=raw, headers={**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"})
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 2
