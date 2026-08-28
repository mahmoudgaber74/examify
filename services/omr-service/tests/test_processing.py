from app.config import Settings
from app.models import TemplateMetadata
from app.processing.bubble_detector import detect_bubbles
from app.processing.preprocess import detect_document, normalize_for_omr

from .conftest import synthetic_sheet
import cv2
import numpy as np


def test_document_and_bubble_pipeline_has_reviewable_states():
    image = cv2.imdecode(np.frombuffer(synthetic_sheet(), dtype=np.uint8), cv2.IMREAD_COLOR)
    prepared = detect_document(image)
    _, binary = normalize_for_omr(prepared.image)
    template = TemplateMetadata(template_token="local-token", template_version=1, questions_count=6, choices_count=4, columns=1, answer_key={1: "A", 2: "A"})
    questions = detect_bubbles(binary, template, Settings())
    assert len(questions) == 6
    assert questions[0].detected_option == "A"
    assert questions[1].status == "multiple_marks"
    assert questions[3].status == "blank"
    assert all(question.bounding_boxes for question in questions)
