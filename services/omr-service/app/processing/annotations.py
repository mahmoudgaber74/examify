import base64
import cv2
import numpy as np
from ..models import QuestionResult


def annotate(image: np.ndarray, questions: list[QuestionResult]) -> str:
    output = image.copy()
    for question in questions:
        color = (0, 180, 0) if question.status in {"correct", "selected"} else (0, 0, 220) if question.status in {"multiple_marks", "incorrect"} else (0, 160, 220)
        for option_id, box in question.bounding_boxes.items():
            x1, y1, x2, y2 = box
            option_color = (0, 220, 0) if option_id == question.detected_option_id else color
            cv2.rectangle(output, (x1, y1), (x2, y2), option_color, 3 if option_id == question.detected_option_id else 2)
        if question.bounding_boxes:
            x, y = next(iter(question.bounding_boxes.values()))[:2]
            cv2.putText(output, f"{question.question_number}:{question.status}", (x, max(15, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
    ok, encoded = cv2.imencode(".jpg", output, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("annotation_encode_failed")
    return "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")
