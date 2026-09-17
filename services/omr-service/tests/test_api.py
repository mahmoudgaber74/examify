from fastapi.testclient import TestClient
import base64
import io
import json
import cv2
import numpy as np
import pytest
from PIL import Image

from app import main as main_module
from app.main import _qr_validation_warning, app
from app.models import QuestionResult, TemplateMetadata
from .conftest import image_payload, signed_headers, synthetic_sheet


client = TestClient(app)


def _v2_api_image(mark_indexes=(0, 1, 2, 3), shape=(1782, 1260)) -> bytes:
    height, width = shape
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    centers = (
        (10.0 / 210.0, 10.0 / 297.0),
        (200.0 / 210.0, 10.0 / 297.0),
        (10.0 / 210.0, 287.0 / 297.0),
        (200.0 / 210.0, 287.0 / 297.0),
    )
    mark_width = max(4, round((6.0 / 210.0) * width))
    mark_height = max(4, round((6.0 / 297.0) * height))
    for index in mark_indexes:
        center_x, center_y = centers[index]
        left = round(center_x * width - mark_width / 2)
        top = round(center_y * height - mark_height / 2)
        cv2.rectangle(image, (left, top), (left + mark_width - 1, top + mark_height - 1), (0, 0, 0), -1)
    cv2.rectangle(
        image,
        (round(0.20 * width), round(0.40 * height)),
        (round(0.25 * width), round(0.45 * height)),
        (0, 0, 0),
        -1,
    )
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def _v2_api_payload(image: bytes, request_id: str) -> dict:
    return {
        "request_id": request_id,
        "content_base64": base64.b64encode(image).decode("ascii"),
        "content_mime": "image/png",
        "expected_v2_page_token": "14162b32-b469-4377-ac76-c9ae8943a201",
        "template": {
            "template_token": "v2-sheet-token",
            "template_version": 1,
            "layout_schema_version": 2,
            "questions_count": 1,
            "choices_count": 2,
        },
        "v2_page_context": {
            "sheet_id": "b7000000-0000-4000-8000-000000000101",
            "page_id": "b7500000-0000-4000-8000-000000000001",
            "page_index": 1,
            "page_count": 1,
            "institution_id": "10000000-0000-4000-8000-000000000001",
            "exam_id": "b7000000-0000-4000-8000-000000000001",
            "layout_schema_version": 2,
            "orientation": "portrait",
            "questions": [{
                "snapshot_question_id": "b7600000-0000-4000-8000-000000000001",
                "exam_question_id": "b7200000-0000-4000-8000-000000000001",
                "question_id": "b7100000-0000-4000-8000-000000000001",
                "question_type": "multiple_choice",
                "points_snapshot": 1,
                "global_question_number": 1,
                "page_number": 1,
                "region": {"x": 0.15, "y": 0.35, "width": 0.30, "height": 0.15},
                "options": [
                    {
                        "snapshot_option_id": "b7400000-0000-4000-8000-000000000001",
                        "source_option_id": "b7300000-0000-4000-8000-000000000001",
                        "label": "A",
                        "visual_index": 0,
                        "canonical_option_ordinal": 1,
                        "region": {"x": 0.20, "y": 0.40, "width": 0.05, "height": 0.05},
                    },
                    {
                        "snapshot_option_id": "b7400000-0000-4000-8000-000000000002",
                        "source_option_id": "b7300000-0000-4000-8000-000000000002",
                        "label": "B",
                        "visual_index": 1,
                        "canonical_option_ordinal": 2,
                        "region": {"x": 0.30, "y": 0.40, "width": 0.05, "height": 0.05},
                    },
                ],
            }],
        },
    }


def _post_payload(body: dict):
    raw = json.dumps(body, separators=(",", ":")).encode()
    return client.post(
        "/v1/omr/analyze",
        content=raw,
        headers={**signed_headers(raw, body["request_id"]), "Content-Type": "application/json"},
    )


def _post_v2(image: bytes, request_id: str):
    return _post_payload(_v2_api_payload(image, request_id))


def _selected_v2_result(*_args, **_kwargs):
    return [QuestionResult(
        question_number=1,
        detected_option="A",
        detected_option_id="b7300000-0000-4000-8000-000000000001",
        fill_scores={"b7300000-0000-4000-8000-000000000001": 0.77},
        confidence=0.77,
        status="selected",
        needs_manual_review=False,
    )]


def test_valid_v2_qr_is_not_treated_as_legacy_json():
    template = TemplateMetadata(
        template_token="sheet-token",
        template_version=1,
        layout_schema_version=2,
        questions_count=1,
        choices_count=4,
    )
    assert _qr_validation_warning("v2:14162b32-b469-4377-ac76-c9ae8943a201", template) is None


def test_malformed_or_missing_v2_qr_remains_fail_closed():
    template = TemplateMetadata(
        template_token="sheet-token",
        template_version=1,
        layout_schema_version=2,
        questions_count=1,
        choices_count=4,
    )
    assert _qr_validation_warning("v2:not-a-page-token", template) == "qr_payload_invalid"
    assert _qr_validation_warning(None, template) == "qr_not_detected"


def test_legacy_json_qr_validation_is_unchanged():
    template = TemplateMetadata(
        template_token="legacy-token",
        template_version=1,
        questions_count=1,
        choices_count=4,
    )
    assert _qr_validation_warning('{"v":1,"t":"legacy-token"}', template) is None
    assert _qr_validation_warning('{"v":1,"t":"different-token"}', template) == "qr_template_token_mismatch"
    assert _qr_validation_warning("v2:not-legacy-json", template) == "qr_payload_invalid"


def test_v2_registered_full_frame_completes_without_false_document_review(monkeypatch):
    monkeypatch.setattr(main_module, "read_qr", lambda _image: ("v2:14162b32-b469-4377-ac76-c9ae8943a201", []))
    monkeypatch.setattr(main_module, "detect_v2_bubbles", _selected_v2_result)
    response = _post_v2(_v2_api_image(), "v2-trusted-frame-001")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["document_confidence"] >= 0.70
    assert result["questions"][0]["status"] == "selected"
    assert result["processing_status"] == "completed"
    assert result["requires_manual_review"] is False
    assert "document_boundary_not_detected" not in result["warnings"]
    assert "document_confidence_below_threshold" not in result["warnings"]


def test_v2_registered_frame_with_malformed_qr_remains_reviewable(monkeypatch):
    monkeypatch.setattr(main_module, "read_qr", lambda _image: ("v2:not-a-page-token", ["qr_payload_invalid"]))
    monkeypatch.setattr(main_module, "detect_v2_bubbles", _selected_v2_result)
    response = _post_v2(_v2_api_image(), "v2-invalid-qr-frame-001")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["document_confidence"] == 0.45
    assert result["processing_status"] == "needs_review"
    assert result["requires_manual_review"] is True
    assert "qr_payload_invalid" in result["warnings"]
    assert "document_boundary_not_detected" in result["warnings"]


def test_v2_different_valid_page_token_cannot_become_trusted_full_frame(monkeypatch):
    monkeypatch.setattr(main_module, "read_qr", lambda _image: ("v2:24162b32-b469-4377-ac76-c9ae8943a202", []))
    monkeypatch.setattr(main_module, "detect_v2_bubbles", _selected_v2_result)
    response = _post_v2(_v2_api_image(), "v2-mismatched-token-001")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["document_confidence"] == 0.45
    assert result["processing_status"] == "needs_review"
    assert result["requires_manual_review"] is True
    assert "qr_page_token_mismatch" in result["warnings"]
    assert "document_boundary_not_detected" in result["warnings"]


def test_v2_request_without_expected_page_token_is_rejected():
    body = _v2_api_payload(_v2_api_image(), "v2-missing-expected-token-001")
    body.pop("expected_v2_page_token")
    response = _post_payload(body)
    assert response.status_code == 422
    assert response.json()["detail"] == "expected_v2_page_token_required"


@pytest.mark.parametrize(
    ("image", "request_id"),
    [
        (_v2_api_image(shape=(1500, 1260)), "v2-cropped-frame-001"),
        (_v2_api_image(mark_indexes=(0, 1, 2)), "v2-missing-mark-001"),
        (_v2_api_image(mark_indexes=()), "v2-arbitrary-frame-001"),
    ],
    ids=["cropped-frame", "missing-registration-mark", "arbitrary-full-frame"],
)
def test_v2_unsafe_full_frame_candidates_remain_reviewable(monkeypatch, image, request_id):
    monkeypatch.setattr(main_module, "read_qr", lambda _image: ("v2:14162b32-b469-4377-ac76-c9ae8943a201", []))
    monkeypatch.setattr(main_module, "detect_v2_bubbles", _selected_v2_result)
    response = _post_v2(image, request_id)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["document_confidence"] == 0.45
    assert result["processing_status"] == "needs_review"
    assert result["requires_manual_review"] is True
    assert "document_boundary_not_detected" in result["warnings"]
    assert "document_confidence_below_threshold" in result["warnings"]


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
