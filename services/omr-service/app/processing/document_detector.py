import cv2
import numpy as np


A4_PORTRAIT_ASPECT = 210.0 / 297.0
MAX_FULL_FRAME_ASPECT_ERROR = 0.025
MIN_REGISTRATION_MARK_SCORE = 0.72
MAX_REGISTRATION_MARK_SIZE_VARIATION = 0.20
MIN_TRUSTED_FULL_FRAME_CONFIDENCE = 0.70

# The v2 PDF generator draws 6 mm square marks at 7 mm from each A4 edge.
_V2_MARK_CENTERS = (
    (10.0 / 210.0, 10.0 / 297.0),
    (200.0 / 210.0, 10.0 / 297.0),
    (10.0 / 210.0, 287.0 / 297.0),
    (200.0 / 210.0, 287.0 / 297.0),
)
_V2_MARK_WIDTH = 6.0 / 210.0
_V2_MARK_HEIGHT = 6.0 / 297.0


def _registration_mark_score(binary: np.ndarray, center_x: float, center_y: float) -> tuple[float, float, float] | None:
    height, width = binary.shape[:2]
    expected_width = max(4.0, _V2_MARK_WIDTH * width)
    expected_height = max(4.0, _V2_MARK_HEIGHT * height)
    search_half_width = expected_width * 1.15
    search_half_height = expected_height * 1.15
    expected_x = center_x * width
    expected_y = center_y * height
    left = max(0, int(round(expected_x - search_half_width)))
    right = min(width, int(round(expected_x + search_half_width)))
    top = max(0, int(round(expected_y - search_half_height)))
    bottom = min(height, int(round(expected_y + search_half_height)))
    if right <= left or bottom <= top:
        return None

    roi = binary[top:bottom, left:right]
    contours, _ = cv2.findContours(roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best: tuple[float, float, float] | None = None
    for contour in contours:
        area = float(cv2.contourArea(contour))
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if box_width <= 0 or box_height <= 0:
            continue
        width_ratio = box_width / expected_width
        height_ratio = box_height / expected_height
        if not (0.60 <= width_ratio <= 1.45 and 0.60 <= height_ratio <= 1.45):
            continue
        aspect = box_width / box_height
        if not 0.75 <= aspect <= 1.33:
            continue
        extent = area / float(box_width * box_height)
        if extent < 0.65:
            continue
        candidate_x = left + x + box_width / 2.0
        candidate_y = top + y + box_height / 2.0
        normalized_distance = float(np.hypot(
            (candidate_x - expected_x) / expected_width,
            (candidate_y - expected_y) / expected_height,
        ))
        if normalized_distance > 0.55:
            continue
        location_score = max(0.0, 1.0 - normalized_distance / 0.55)
        size_score = min(width_ratio, 1.0 / width_ratio, height_ratio, 1.0 / height_ratio)
        shape_score = min(aspect, 1.0 / aspect)
        score = 0.35 * location_score + 0.25 * size_score + 0.20 * shape_score + 0.20 * min(1.0, extent)
        candidate = (float(score), float(box_width), float(box_height))
        if best is None or candidate[0] > best[0]:
            best = candidate
    return best


def trusted_v2_full_frame_confidence(
    binary: np.ndarray,
    source_shape: tuple[int, ...],
    orientation: str,
) -> float | None:
    """Return confidence only when a fallback raster matches the generated v2 page frame."""
    if binary is None or binary.size == 0 or len(source_shape) < 2 or orientation != "portrait":
        return None
    source_height, source_width = source_shape[:2]
    if source_width <= 0 or source_height <= 0 or source_width >= source_height:
        return None
    source_aspect = source_width / source_height
    relative_aspect_error = abs(source_aspect - A4_PORTRAIT_ASPECT) / A4_PORTRAIT_ASPECT
    if relative_aspect_error > MAX_FULL_FRAME_ASPECT_ERROR:
        return None

    marks = [_registration_mark_score(binary, x, y) for x, y in _V2_MARK_CENTERS]
    if any(mark is None or mark[0] < MIN_REGISTRATION_MARK_SCORE for mark in marks):
        return None
    accepted_marks = [mark for mark in marks if mark is not None]
    widths = np.asarray([mark[1] for mark in accepted_marks], dtype=np.float64)
    heights = np.asarray([mark[2] for mark in accepted_marks], dtype=np.float64)
    if (float(np.std(widths) / np.mean(widths)) > MAX_REGISTRATION_MARK_SIZE_VARIATION
            or float(np.std(heights) / np.mean(heights)) > MAX_REGISTRATION_MARK_SIZE_VARIATION):
        return None

    aspect_score = max(0.0, 1.0 - relative_aspect_error / MAX_FULL_FRAME_ASPECT_ERROR)
    mark_scores = [mark[0] for mark in accepted_marks]
    confidence = 0.25 * aspect_score + 0.50 * float(np.mean(mark_scores)) + 0.25 * min(mark_scores)
    confidence = min(0.95, max(0.0, confidence))
    return round(confidence, 4) if confidence >= MIN_TRUSTED_FULL_FRAME_CONFIDENCE else None


def registration_mark_confidence(binary: np.ndarray) -> float:
    h, w = binary.shape[:2]
    size = max(8, int(min(h, w) * 0.035))
    samples = [binary[0:size, 0:size], binary[0:size, w-size:w], binary[h-size:h, 0:size], binary[h-size:h, w-size:w]]
    scores = [float((sample > 200).mean()) for sample in samples]
    return float(np.mean([min(1.0, score / 0.45) for score in scores]))
