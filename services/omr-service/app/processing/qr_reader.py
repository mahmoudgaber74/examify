import json
import uuid
import cv2
import numpy as np


def read_qr(image: np.ndarray) -> tuple[str | None, list[str]]:
    detector = cv2.QRCodeDetector()
    value, points, _ = detector.detectAndDecode(image)
    if not value:
        return None, ["qr_not_detected"]
    if value.startswith("v2:"):
        try:
            uuid.UUID(value[3:])
            return value, []
        except ValueError:
            return value, ["qr_payload_invalid"]
    try:
        payload = json.loads(value)
        token = payload.get("t")
        version = payload.get("v")
        if not isinstance(token, str) or not token or not isinstance(version, int):
            return value, ["qr_payload_invalid"]
        return value, []
    except (json.JSONDecodeError, TypeError):
        return value, ["qr_payload_invalid"]
