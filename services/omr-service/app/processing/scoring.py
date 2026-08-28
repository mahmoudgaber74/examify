from ..models import QuestionResult


def summarize(questions: list[QuestionResult], document_confidence: float, qr_warnings: list[str]) -> tuple[float, bool, list[str]]:
    warnings = list(qr_warnings)
    confidence = sum(q.confidence for q in questions) / len(questions) if questions else 0.0
    needs_review = document_confidence < 0.70 or bool(qr_warnings) or any(q.status not in {"correct", "incorrect"} for q in questions)
    if document_confidence < 0.70:
        warnings.append("document_confidence_below_threshold")
    return round(confidence, 4), needs_review, sorted(set(warnings))
