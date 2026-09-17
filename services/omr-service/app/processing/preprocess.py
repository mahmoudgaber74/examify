from dataclasses import dataclass
import cv2
import numpy as np


MIN_PAGE_AREA_RATIO = 0.65
MAX_PAGE_EDGE_MARGIN_RATIO = 0.08
MIN_PAGE_ASPECT_RATIO = 0.55
MAX_PAGE_ASPECT_RATIO = 0.90


@dataclass
class PreparedPage:
    image: np.ndarray
    document_confidence: float
    warnings: list[str]
    mode: str


def _order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    total = points.sum(axis=1)
    diff = np.diff(points, axis=1)
    rect[0] = points[np.argmin(total)]
    rect[2] = points[np.argmax(total)]
    rect[1] = points[np.argmin(diff)]
    rect[3] = points[np.argmax(diff)]
    return rect


def _four_point_warp(image: np.ndarray, points: np.ndarray, width: int = 1260, height: int = 1782) -> np.ndarray:
    rect = _order_points(points.astype("float32"))
    destination = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_CUBIC)


def _is_plausible_page_quad(points: np.ndarray, contour_area: float, image_shape: tuple[int, ...]) -> bool:
    height, width = image_shape[:2]
    image_area = float(width * height)
    if len(points) != 4 or image_area <= 0 or contour_area / image_area < MIN_PAGE_AREA_RATIO:
        return False
    if not cv2.isContourConvex(points.reshape(-1, 1, 2).astype(np.float32)):
        return False
    x, y, box_width, box_height = cv2.boundingRect(points.astype(np.float32))
    if box_width <= 0 or box_height <= 0:
        return False
    if (x / width > MAX_PAGE_EDGE_MARGIN_RATIO or y / height > MAX_PAGE_EDGE_MARGIN_RATIO
            or (width - (x + box_width)) / width > MAX_PAGE_EDGE_MARGIN_RATIO
            or (height - (y + box_height)) / height > MAX_PAGE_EDGE_MARGIN_RATIO):
        return False
    aspect_ratio = box_width / box_height
    return MIN_PAGE_ASPECT_RATIO <= aspect_ratio <= MAX_PAGE_ASPECT_RATIO


def detect_document(image: np.ndarray) -> PreparedPage:
    if image is None or image.size == 0:
        raise ValueError("empty_image")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(denoised, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(image.shape[0] * image.shape[1])
    best = None
    best_area = 0.0
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.25 or area < best_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.03 * perimeter, True)
        if len(approx) == 4:
            candidate = approx.reshape(4, 2)
            if _is_plausible_page_quad(candidate, area, image.shape):
                best, best_area = candidate, area
    if best is not None:
        return PreparedPage(_four_point_warp(image, best), min(1.0, best_area / image_area), [], "perspective_warp")

    # A rasterized PDF often has no detectable outer contour. Normalize the page
    # while explicitly lowering confidence so review remains the safe outcome.
    h, w = image.shape[:2]
    resized = cv2.resize(image, (1260, 1782), interpolation=cv2.INTER_AREA)
    warning = "document_boundary_not_detected"
    return PreparedPage(resized, 0.45 if w and h else 0.0, [warning], "uncertain_fallback")


def normalize_for_omr(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.medianBlur(gray, 3)
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 9)
    return gray, adaptive
