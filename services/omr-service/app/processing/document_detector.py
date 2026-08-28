import cv2
import numpy as np


def registration_mark_confidence(binary: np.ndarray) -> float:
    h, w = binary.shape[:2]
    size = max(8, int(min(h, w) * 0.035))
    samples = [binary[0:size, 0:size], binary[0:size, w-size:w], binary[h-size:h, 0:size], binary[h-size:h, w-size:w]]
    scores = [float((sample > 200).mean()) for sample in samples]
    return float(np.mean([min(1.0, score / 0.45) for score in scores]))
