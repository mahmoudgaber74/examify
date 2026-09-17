from app.config import Settings
from app.models import TemplateMetadata
from app.processing.bubble_detector import detect_bubbles
from app.processing.preprocess import detect_document, normalize_for_omr
from app.models import V2PageProcessingContext
from app.processing import v2_detector
from app.processing.v2_detector import detect_v2_bubbles

from .conftest import synthetic_sheet
import cv2
import numpy as np


def test_document_and_bubble_pipeline_has_reviewable_states():
    image = cv2.imdecode(np.frombuffer(synthetic_sheet(), dtype=np.uint8), cv2.IMREAD_COLOR)
    prepared = detect_document(image)
    _, binary = normalize_for_omr(prepared.image)
    template = TemplateMetadata(template_token="local-token", template_version=1, questions_count=6, choices_count=4, columns=1, answer_key={1: "A", 2: "A"})
    questions = detect_bubbles(binary, template, Settings(service_token="local-omr-development-token"))
    assert len(questions) == 6
    assert questions[0].detected_option == "A"
    assert questions[1].status == "multiple_marks"
    assert questions[3].status == "blank"
    assert all(question.bounding_boxes for question in questions)


def v2_context(option_counts=(2,), orientation="portrait"):
    questions = []
    for question_index, option_count in enumerate(option_counts):
        options = []
        for option_index in range(option_count):
            options.append({
                "snapshot_option_id": f"b7400000-0000-4000-8000-{question_index:010d}{option_index:02d}",
                "source_option_id": f"b7300000-0000-4000-8000-{question_index:010d}{option_index:02d}",
                "label": chr(65 + option_index), "visual_index": option_index,
                "canonical_option_ordinal": option_index + 1,
                "region": {"x": 0.10 + option_index * 0.10, "y": 0.20 + question_index * 0.12, "width": 0.06, "height": 0.06},
            })
        questions.append({
            "snapshot_question_id": f"b7600000-0000-4000-8000-{question_index + 1:012d}",
            "exam_question_id": f"b7200000-0000-4000-8000-{question_index + 1:012d}",
            "question_id": f"b7100000-0000-4000-8000-{question_index + 1:012d}",
            "question_type": "multiple_choice", "points_snapshot": 1,
            "global_question_number": question_index + 1, "page_number": 1,
            "region": {"x": 0.08, "y": 0.18 + question_index * 0.12, "width": 0.40, "height": 0.10},
            "options": options,
        })
    return V2PageProcessingContext.model_validate({
        "sheet_id": "b7000000-0000-4000-8000-000000000101", "page_id": "b7500000-0000-4000-8000-000000000001",
        "page_index": 1, "page_count": 1, "institution_id": "10000000-0000-4000-8000-000000000001",
        "exam_id": "b7000000-0000-4000-8000-000000000001", "layout_schema_version": 2,
        "orientation": orientation, "questions": questions,
    })


def v2_image(context, selected=(0,), weak=False):
    image = np.zeros((500, 500), dtype=np.uint8)
    for qi, question in enumerate(context.questions):
        for oi, option in enumerate(question.options):
            region = option.region
            left, top = round(region.x * 500), round(region.y * 500)
            right, bottom = round((region.x + region.width) * 500), round((region.y + region.height) * 500)
            if oi in selected if qi == 0 else False:
                cv2.rectangle(image, (left + 5, top + 5), (right - 5, bottom - 5), 255, -1)
            elif weak and qi == 0 and oi == 0:
                cv2.rectangle(image, (left + 10, top + 10), (left + 18, top + 18), 255, -1)
    return image


def test_v2_first_of_two_is_selected_and_no_answer_key_is_used():
    context = v2_context((2,))
    result = detect_v2_bubbles(v2_image(context, (0,)), context, Settings(service_token="local-omr-development-token"))[0]
    assert result.status == "selected"
    assert result.detected_option_id == str(context.questions[0].options[0].source_option_id)
    assert result.is_correct is None and result.score == 0


def test_v2_runtime_fill_ratio_02587_selects_first_option(monkeypatch):
    context = v2_context((2,))
    calls = []

    def calibrated_fill_score(_binary, _bounds):
        calls.append(True)
        return 0.2587 if len(calls) == 1 else 0.0

    monkeypatch.setattr(v2_detector, "_fill_score", calibrated_fill_score)
    result = detect_v2_bubbles(v2_image(context, ()), context, Settings(service_token="local-omr-development-token"))[0]
    first_option_id = str(context.questions[0].options[0].source_option_id)
    second_option_id = str(context.questions[0].options[1].source_option_id)
    assert result.fill_scores[first_option_id] == 0.2587
    assert result.fill_scores[second_option_id] == 0.0
    assert result.status == "selected"
    assert result.needs_manual_review is False
    assert result.detected_option_id == first_option_id


def test_v2_supports_four_options_and_variable_counts():
    context = v2_context((4, 2))
    result = detect_v2_bubbles(v2_image(context, (2,)), context, Settings(service_token="local-omr-development-token"))
    assert result[0].status == "selected"
    assert result[0].detected_option == "C"
    assert len(result[1].fill_scores) == 2


def test_v2_empty_double_mark_and_ambiguous_are_reviewable():
    context = v2_context((4,))
    settings = Settings(service_token="local-omr-development-token")
    empty = detect_v2_bubbles(v2_image(context, ()), context, settings)[0]
    assert empty.status == "blank"
    double = detect_v2_bubbles(v2_image(context, (0, 1)), context, settings)[0]
    assert double.status == "multiple_marks"
    ambiguous = detect_v2_bubbles(v2_image(context, (), weak=True), context, settings)[0]
    assert ambiguous.status == "needs_review"
    assert ambiguous.needs_manual_review is True


def test_v2_rejects_invalid_or_out_of_bounds_geometry():
    context = v2_context((2,))
    context.questions[0].options[0].region.x = 1.1
    try:
        detect_v2_bubbles(np.zeros((500, 500), dtype=np.uint8), context, Settings(service_token="local-omr-development-token"))
    except ValueError as exc:
        assert str(exc) == "v2_geometry_out_of_bounds"
    else:
        raise AssertionError("invalid v2 geometry was accepted")
