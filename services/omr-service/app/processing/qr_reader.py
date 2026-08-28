import json
import cv2
import numpy as np


def read_qr(image: np.ndarray) -> tuple[str | None, list[str]]:
    detector = cv2.QRCodeDetector()
    value, points, _ = detector.detectAndDecode(image)
    if not value:
        return None, ["qr_not_detected"]
    try:
        payload = json.loads(value)
        token = payload.get("t")
        version = payload.get("v")
        if not isinstance(token, str) or not token or not isinstance(version, int):
            return value, ["qr_payload_invalid"]
        return value, []
    except (json.JSONDecodeError, TypeError):
        return value, ["qr_payload_invalid"]
