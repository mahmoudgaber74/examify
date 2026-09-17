from ..models import QuestionResult


def summarize(
    questions: list[QuestionResult],
    document_confidence: float,
    qr_warnings: list[str],
    layout_schema_version: int = 1,
) -> tuple[float, bool, list[str]]:
    warnings = list(qr_warnings)
    confidence = sum(q.confidence for q in questions) / len(questions) if questions else 0.0
    if layout_schema_version >= 2:
        question_review_required = any(q.status != "selected" or q.needs_manual_review for q in questions)
    else:
        question_review_required = any(q.status not in {"correct", "incorrect"} for q in questions)
    needs_review = document_confidence < 0.70 or bool(qr_warnings) or question_review_required
    if document_confidence < 0.70:
        warnings.append("document_confidence_below_threshold")
    return round(confidence, 4), needs_review, sorted(set(warnings))
