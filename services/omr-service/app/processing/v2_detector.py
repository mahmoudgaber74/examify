from math import isfinite

import cv2
import numpy as np

from ..config import Settings
from ..models import QuestionResult, V2PageProcessingContext, V2PageProcessingQuestion


V2_MIN_FILL_SCORE = 0.22
V2_WEAK_FILL_SCORE = 0.20
V2_MIN_CONFIDENCE_GAP = 0.08
V2_MIN_ROI_PIXELS = 6
SUPPORTED_ORIENTATIONS = {"portrait"}


def _box(region: object, width: int, height: int) -> tuple[int, int, int, int]:
    values = (region.x, region.y, region.width, region.height)  # type: ignore[attr-defined]
    if not all(isfinite(float(value)) for value in values):
        raise ValueError("v2_geometry_invalid")
    x, y, box_width, box_height = (float(value) for value in values)
    if x < 0 or y < 0 or box_width <= 0 or box_height <= 0 or x + box_width > 1 or y + box_height > 1:
        raise ValueError("v2_geometry_out_of_bounds")
    left, top = round(x * width), round(y * height)
    right, bottom = round((x + box_width) * width), round((y + box_height) * height)
    if right - left < V2_MIN_ROI_PIXELS or bottom - top < V2_MIN_ROI_PIXELS:
        raise ValueError("v2_geometry_roi_too_small")
    return left, top, right, bottom


def _fill_score(binary: np.ndarray, bounds: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = bounds
    crop = binary[top:bottom, left:right]
    if crop.size == 0:
        raise ValueError("v2_geometry_crop_empty")
    margin_x = max(1, crop.shape[1] // 6)
    margin_y = max(1, crop.shape[0] // 6)
    core = crop[margin_y:-margin_y or None, margin_x:-margin_x or None]
    if core.size == 0:
        core = crop
    gray = cv2.GaussianBlur(core, (3, 3), 0)
    return float((gray > 127).mean())


def _validate_question(question: V2PageProcessingQuestion, width: int, height: int) -> None:
    _box(question.region, width, height)
    if not question.options:
        raise ValueError("v2_question_options_missing")
    seen: set[tuple[float, float, float, float]] = set()
    for option in question.options:
        key = (option.region.x, option.region.y, option.region.width, option.region.height)
        if key in seen:
            raise ValueError("v2_option_geometry_duplicate")
        seen.add(key)
        _box(option.region, width, height)


def detect_v2_bubbles(binary: np.ndarray, context: V2PageProcessingContext, settings: Settings) -> list[QuestionResult]:
    if context.layout_schema_version != 2:
        raise ValueError("v2_layout_schema_unsupported")
    if context.orientation not in SUPPORTED_ORIENTATIONS:
        raise ValueError("v2_page_orientation_unsupported")
    if context.page_index < 1 or context.page_index > context.page_count:
        raise ValueError("v2_page_context_invalid")
    if not context.questions:
        raise ValueError("v2_question_geometry_missing")
    height, width = binary.shape[:2]
    if width < V2_MIN_ROI_PIXELS or height < V2_MIN_ROI_PIXELS:
        raise ValueError("v2_page_image_invalid")

    results: list[QuestionResult] = []
    seen_questions: set[str] = set()
    for question in sorted(context.questions, key=lambda item: item.global_question_number):
        question_key = str(question.snapshot_question_id)
        if question_key in seen_questions:
            raise ValueError("v2_question_geometry_duplicate")
        seen_questions.add(question_key)
        _validate_question(question, width, height)
        scores: dict[str, float] = {}
        boxes: dict[str, list[int]] = {}
        options_by_id = {}
        for option in question.options:
            option_id = str(option.source_option_id)
            if option_id in options_by_id:
                raise ValueError("v2_option_identity_duplicate")
            options_by_id[option_id] = option
            bounds = _box(option.region, width, height)
            scores[option_id] = round(_fill_score(binary, bounds), 4)
            boxes[option_id] = list(bounds)

        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best_id, best_score = ordered[0]
        second_score = ordered[1][1] if len(ordered) > 1 else 0.0
        marked = [option_id for option_id, score in ordered if score >= V2_MIN_FILL_SCORE]
        if len(marked) > 1:
            status = "multiple_marks"
            detected_id = None
            confidence = max(0.0, min(1.0, best_score - second_score))
            warnings = ["v2_multiple_marks"]
        elif best_score < V2_WEAK_FILL_SCORE:
            status = "blank"
            detected_id = None
            confidence = max(0.0, min(1.0, 1 - best_score / V2_WEAK_FILL_SCORE))
            warnings = ["v2_no_mark_detected"]
        elif best_score < V2_MIN_FILL_SCORE or best_score - second_score < V2_MIN_CONFIDENCE_GAP:
            status = "needs_review"
            detected_id = None
            confidence = max(0.0, min(1.0, best_score - second_score))
            warnings = ["v2_ambiguous_mark"]
        else:
            status = "selected"
            detected_id = best_id
            confidence = max(0.0, min(1.0, 0.5 * best_score + 0.5 * (best_score - second_score) / max(best_score, 0.01)))
            warnings = []
        selected_label = options_by_id[detected_id].label if detected_id else None
        results.append(QuestionResult(
            question_number=question.global_question_number,
            detected_option=selected_label,
            detected_option_id=detected_id,
            fill_scores=scores,
            confidence=round(confidence, 4),
            status=status,
            needs_manual_review=status != "selected",
            is_correct=None,
            score=0.0,
            bounding_boxes=boxes,
            warnings=warnings,
        ))
    return results
