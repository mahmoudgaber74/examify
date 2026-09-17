import cv2
import numpy as np

from app.processing import preprocess
from app.processing.document_detector import trusted_v2_full_frame_confidence


def _image():
    return np.full((1000, 700, 3), 255, dtype=np.uint8)


def _contour(points):
    return np.asarray(points, dtype=np.int32).reshape(-1, 1, 2)


def _with_contour(monkeypatch, points):
    contour = _contour(points) if points else None
    monkeypatch.setattr(preprocess.cv2, "findContours", lambda *_args: ([contour] if contour is not None else [], None))
    monkeypatch.setattr(preprocess.cv2, "approxPolyDP", lambda candidate, *_args: candidate)


def test_full_page_a4_like_contour_is_accepted(monkeypatch):
    _with_contour(monkeypatch, [(10, 10), (690, 20), (680, 980), (20, 990)])
    result = preprocess.detect_document(_image())
    assert result.image.shape[:2] == (1782, 1260)
    assert result.warnings == []
    assert result.document_confidence > 0.65
    assert result.mode == "perspective_warp"


def test_large_internal_rectangle_uses_fallback(monkeypatch):
    _with_contour(monkeypatch, [(100, 100), (600, 100), (600, 800), (100, 800)])
    result = preprocess.detect_document(_image())
    assert result.image.shape[:2] == (1782, 1260)
    assert result.warnings == ["document_boundary_not_detected"]
    assert result.document_confidence == 0.45
    assert result.mode == "uncertain_fallback"


def test_no_contour_uses_fallback(monkeypatch):
    _with_contour(monkeypatch, [])
    result = preprocess.detect_document(_image())
    assert result.warnings == ["document_boundary_not_detected"]


def test_non_page_quad_uses_fallback(monkeypatch):
    _with_contour(monkeypatch, [(10, 10), (690, 10), (100, 900), (600, 900)])
    result = preprocess.detect_document(_image())
    assert result.warnings == ["document_boundary_not_detected"]


def _v2_full_frame(mark_indexes=(0, 1, 2, 3), shape=(1782, 1260)):
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
    return image


def _trusted_confidence(image, orientation="portrait"):
    resized = cv2.resize(image, (1260, 1782), interpolation=cv2.INTER_AREA)
    _, binary = preprocess.normalize_for_omr(resized)
    return trusted_v2_full_frame_confidence(binary, image.shape, orientation)


def test_v2_generated_full_frame_registration_is_trusted():
    image = _v2_full_frame()
    prepared = preprocess.detect_document(image)
    assert prepared.mode == "uncertain_fallback"
    confidence = _trusted_confidence(image)
    assert confidence is not None
    assert confidence >= 0.70


def test_v2_cropped_or_wrong_aspect_frame_is_not_trusted():
    cropped = _v2_full_frame(shape=(1500, 1260))
    assert _trusted_confidence(cropped) is None
    assert _trusted_confidence(_v2_full_frame(), orientation="landscape") is None


def test_v2_missing_registration_mark_is_not_trusted():
    assert _trusted_confidence(_v2_full_frame(mark_indexes=(0, 1, 2))) is None


def test_v2_arbitrary_full_frame_without_registration_marks_is_not_trusted():
    arbitrary = np.full((1782, 1260, 3), 255, dtype=np.uint8)
    assert _trusted_confidence(arbitrary) is None
