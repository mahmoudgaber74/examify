import uuid
import json
from unittest.mock import Mock, patch

from app.models import V2PageProcessingContext
from app import worker
from app.worker import load_v2_page_context


def context_payload():
    sheet_id = uuid.UUID("b7000000-0000-4000-8000-000000000101")
    exam_id = uuid.UUID("b7000000-0000-4000-8000-000000000001")
    institution_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    question_id = uuid.UUID("b7100000-0000-4000-8000-000000000001")
    option_id = uuid.UUID("b7300000-0000-4000-8000-000000000010")
    return {
        "sheet_id": str(sheet_id), "page_id": "b7500000-0000-4000-8000-000000000001",
        "page_index": 1, "page_count": 1, "institution_id": str(institution_id),
        "exam_id": str(exam_id), "layout_schema_version": 2, "orientation": "portrait",
        "questions": [{
            "snapshot_question_id": "b7600000-0000-4000-8000-000000000001",
            "exam_question_id": "b7200000-0000-4000-8000-000000000001",
            "question_id": str(question_id), "question_type": "multiple_choice",
            "points_snapshot": 1, "global_question_number": 1, "page_number": 1,
            "region": {"x": 0.1, "y": 0.2, "width": 0.8, "height": 0.05},
            "options": [{
                "snapshot_option_id": "b7400000-0000-4000-8000-000000000001",
                "source_option_id": str(option_id), "label": "A", "visual_index": 0,
                "canonical_option_ordinal": 1,
                "region": {"x": 0.1, "y": 0.2, "width": 0.05, "height": 0.05},
            }],
        }],
    }


def test_worker_loads_and_serializes_authoritative_v2_context():
    template = {"id": "b7000000-0000-4000-8000-000000000101", "layout_schema_version": 2}
    scan = {"exam_id": "b7000000-0000-4000-8000-000000000001", "institution_id": "10000000-0000-4000-8000-000000000001"}
    job = {"id": "b8000000-0000-4000-8000-000000000001"}
    with patch("app.worker.decode_v2_page_token", return_value="page-token"), \
         patch("app.worker.resolve_v2_page", return_value={"bubble_sheet_id": template["id"], "page_index": 1, "page_count": 1}), \
         patch("app.worker.rpc", return_value=context_payload()):
        loaded = load_v2_page_context(template, scan, job, b"image", "image/png")
    assert loaded is not None
    result, expected_page_token = loaded
    context = V2PageProcessingContext.model_validate(result)
    assert expected_page_token == "page-token"
    assert context.layout_schema_version == 2
    assert context.page_index == 1 and context.page_count == 1
    assert len(context.questions) == 1
    assert len(context.questions[0].options) == 1
    assert not any(key in str(result) for key in ("is_correct", "answer_key", "score"))


def test_worker_rejects_context_identity_mismatch():
    template = {"id": "b7000000-0000-4000-8000-000000000101", "layout_schema_version": 2}
    scan = {"exam_id": "wrong", "institution_id": "10000000-0000-4000-8000-000000000001"}
    with patch("app.worker.decode_v2_page_token", return_value="page-token"), \
         patch("app.worker.resolve_v2_page", return_value={"bubble_sheet_id": template["id"], "page_index": 1, "page_count": 1}), \
         patch("app.worker.rpc", return_value=context_payload()):
        try:
            load_v2_page_context(template, scan, {}, b"image", "image/png")
        except ValueError as exc:
            assert str(exc) == "omr_v2_page_context_identity_mismatch"
        else:
            raise AssertionError("context identity mismatch was accepted")


def test_worker_forwards_the_exact_token_used_to_load_v2_context():
    page_token = "14162b32-b469-4377-ac76-c9ae8943a201"
    sheet_id = "b7000000-0000-4000-8000-000000000101"
    scan = {
        "id": "b8100000-0000-4000-8000-000000000001",
        "exam_id": "b7000000-0000-4000-8000-000000000001",
        "bubble_sheet_id": sheet_id,
        "original_storage_path": "test/page.png",
        "institution_id": "10000000-0000-4000-8000-000000000001",
        "student_profile_id": None,
        "uploaded_by": "10000000-0000-4000-8000-000000000002",
    }
    template = {
        "id": sheet_id,
        "qr_token": "b7900000-0000-4000-8000-000000000001",
        "questions_count": 1,
        "choices_count": 2,
        "layout_schema_version": 2,
    }
    response = Mock(status_code=200)
    response.json.return_value = {
        "processing_status": "completed",
        "detected_qr": f"v2:{page_token}",
        "processing_time_ms": 1,
        "document_confidence": 0.9,
        "warnings": [],
        "questions": [],
        "annotated_images": [],
    }

    def fake_query(table, _params):
        return [scan] if table == "omr_results" else [template]

    job = {
        "id": "b8000000-0000-4000-8000-000000000001",
        "scan_id": scan["id"],
        "template_id": sheet_id,
        "request_id": "worker-token-binding-001",
        "attempt_count": 1,
    }
    with patch.object(worker, "query", side_effect=fake_query), \
         patch.object(worker, "storage_download", return_value=b"image"), \
         patch.object(worker, "load_v2_page_context", return_value=(context_payload(), page_token)), \
         patch.object(worker, "heartbeat"), \
         patch.object(worker.httpx, "post", return_value=response) as post, \
         patch.object(worker, "resolve_v2_page", return_value={"bubble_sheet_id": sheet_id}), \
         patch.object(worker, "rpc"):
        worker.process(job)

    forwarded = json.loads(post.call_args.kwargs["content"])
    assert forwarded["expected_v2_page_token"] == page_token
    assert forwarded["v2_page_context"]["page_id"] == context_payload()["page_id"]
