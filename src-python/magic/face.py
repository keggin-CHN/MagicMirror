import os
from functools import lru_cache

import cv2
import numpy as np
from tinyface import TinyFace

_tf = TinyFace()


def load_models():
    try:
        _tf.config.face_detector_model = _get_model_path("scrfd_2.5g.onnx")
        _tf.config.face_embedder_model = _get_model_path("arcface_w600k_r50.onnx")
        _tf.config.face_swapper_model = _get_model_path("inswapper_128_fp16.onnx")
        _tf.config.face_enhancer_model = _get_model_path("gfpgan_1.4.onnx")
        _tf.prepare()
        return True
    except BaseException as _:
        return False


@lru_cache(maxsize=12)
def swap_face(input_path, face_path):
    try:
        save_path = _get_output_file_path(input_path)
        output_img = _swap_face(input_path, face_path)
        _write_image(save_path, output_img)
        return save_path
    except BaseException as _:
        return None


def swap_face_video(input_path, face_path):
    try:
        save_path = _get_output_video_path(input_path)
        output_path = _swap_face_video(input_path, face_path, save_path)
        return output_path
    except BaseException as _:
        return None


def _swap_face_video(input_path, face_path, save_path):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return None

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 25.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    if width <= 0 or height <= 0:
        ok, frame = cap.read()
        if not ok:
            cap.release()
            return None
        height, width = frame.shape[:2]
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(save_path, fourcc, fps, (width, height))
    if not writer.isOpened():
        cap.release()
        return None

    destination_face = _get_one_face(face_path)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if destination_face is None:
            writer.write(frame)
            continue
        try:
            reference_face = _tf.get_one_face(frame)
            if reference_face is None:
                writer.write(frame)
                continue
            output_frame = _tf.swap_face(
                vision_frame=frame,
                reference_face=reference_face,
                destination_face=destination_face,
            )
            writer.write(output_frame if output_frame is not None else frame)
        except BaseException:
            writer.write(frame)

    cap.release()
    writer.release()
    return save_path


@lru_cache(maxsize=12)
def _swap_face(input_path, face_path):
    return _tf.swap_face(
        vision_frame=_read_image(input_path),
        reference_face=_get_one_face(input_path),
        destination_face=_get_one_face(face_path),
    )


@lru_cache(maxsize=12)
def _get_one_face(face_path: str):
    face_img = _read_image(face_path)
    return _tf.get_one_face(face_img)


@lru_cache(maxsize=12)
def _read_image(img_path: str):
    return cv2.imdecode(np.fromfile(img_path, dtype=np.uint8), -1)


def _write_image(img_path: str, img):
    suffix = os.path.splitext(img_path)[-1]
    cv2.imencode(suffix, img)[1].tofile(img_path)


def _get_output_file_path(file_name):
    base_name, ext = os.path.splitext(file_name)
    return base_name + "_output" + ext


def _get_output_video_path(file_name):
    base_name, _ = os.path.splitext(file_name)
    return base_name + "_output.mp4"


def _get_model_path(file_name: str):
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), os.pardir, "models", file_name)
    )
