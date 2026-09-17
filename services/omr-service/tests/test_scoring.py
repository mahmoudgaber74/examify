import pytest

from app.models import QuestionResult
from app.processing.scoring import summarize


def _question(status: str, needs_manual_review: bool = False) -> QuestionResult:
    return QuestionResult(
        question_number=1,
        detected_option="A" if status in {"correct", "incorrect", "selected"} else None,
        fill_scores={"A": 0.8},
        confidence=0.8,
        status=status,
        needs_manual_review=needs_manual_review,
    )


def test_v2_selected_status_does_not_force_review():
    _, needs_review, warnings = summarize([_question("selected")], 0.85, [], layout_schema_version=2)
    assert needs_review is False
    assert warnings == []


@pytest.mark.parametrize("status", ["blank", "multiple_marks", "low_confidence", "unreadable", "needs_review"])
def test_v2_non_selected_statuses_remain_reviewable(status):
    _, needs_review, _ = summarize([_question(status)], 0.85, [], layout_schema_version=2)
    assert needs_review is True


def test_v2_manual_review_flag_remains_fail_closed():
    _, needs_review, _ = summarize([_question("selected", needs_manual_review=True)], 0.85, [], layout_schema_version=2)
    assert needs_review is True


def test_legacy_success_and_review_status_rules_are_unchanged():
    _, needs_review, _ = summarize([_question("correct"), _question("incorrect")], 0.85, [])
    assert needs_review is False
    _, selected_needs_review, _ = summarize([_question("selected")], 0.85, [])
    assert selected_needs_review is True


def test_document_confidence_and_qr_warnings_remain_fail_closed():
    _, low_document_review, warnings = summarize([_question("selected")], 0.45, [], layout_schema_version=2)
    assert low_document_review is True
    assert "document_confidence_below_threshold" in warnings
    _, qr_review, _ = summarize([_question("selected")], 0.85, ["qr_not_detected"], layout_schema_version=2)
    assert qr_review is True
