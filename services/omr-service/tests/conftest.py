import base64
import io
import json
import hashlib
import hmac
import time

import cv2
import numpy as np
import qrcode
from PIL import Image

from app.processing.bubble_detector import build_grid
from app.models import TemplateMetadata


def synthetic_sheet() -> bytes:
    template = TemplateMetadata(template_token="local-token", template_version=1, questions_count=6, choices_count=4, columns=1, answer_key={1: "A", 2: "A"})
    image = np.full((1782, 1260, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (12, 12), (1248, 1770), (0, 0, 0), 4)
    mark = 44
    for x, y in [(16, 16), (1200, 16), (16, 1722), (1200, 1722)]:
        cv2.rectangle(image, (x, y), (x + mark, y + mark), (0, 0, 0), -1)
    grid = build_grid(template)
    width, height = 1260, 1782
    for question in range(template.questions_count):
        x0 = grid.start_x + (question // grid.rows_per_column) * grid.column_step
        y = grid.start_y + (question % grid.rows_per_column) * grid.row_step
        for choice in range(template.choices_count):
            x = x0 + grid.question_label_width + choice * grid.choice_step + grid.choice_step / 2
            center = (int(x * width), int(y * height))
            radius = max(3, int(grid.choice_step * width * 0.32))
            cv2.circle(image, center, radius, (25, 25, 25), 2)
            if question == 0 and choice == 0:
                cv2.circle(image, center, max(2, radius - 3), (0, 0, 0), -1)
            if question == 1 and choice in (0, 1):
                cv2.circle(image, center, max(2, radius - 3), (0, 0, 0), -1)
            if question == 2 and choice == 2:
                cv2.circle(image, center, max(2, radius - 5), (80, 80, 80), -1)
    qr_image = qrcode.make(json.dumps({"v": 1, "t": "local-token"}, separators=(",", ":"))).convert("RGB")
    qr_array = cv2.cvtColor(np.array(qr_image.resize((180, 180))), cv2.COLOR_RGB2BGR)
    image[80:260, 1020:1200] = qr_array
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def image_payload(image: bytes, request_id: str = "synthetic-request-001") -> dict:
    return {
        "request_id": request_id,
        "content_base64": base64.b64encode(image).decode("ascii"),
        "content_mime": "image/png",
        "template": {
            "template_token": "local-token",
            "template_version": 1,
            "questions_count": 6,
            "choices_count": 4,
            "columns": 1,
            "answer_key": {"1": "A", "2": "A"},
        },
    }


def signed_headers(body: bytes, request_id: str) -> dict:
    timestamp = str(time.time())
    body_hash = hashlib.sha256(body).hexdigest()
    signature = hmac.new(b"local-omr-development-token", f"{timestamp}.{request_id}.{body_hash}".encode(), hashlib.sha256).hexdigest()
    return {
        "X-OMR-Request-Id": request_id,
        "X-OMR-Timestamp": timestamp,
        "X-OMR-Body-SHA256": body_hash,
        "X-OMR-Signature": signature,
    }
