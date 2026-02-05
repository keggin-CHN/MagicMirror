import os
import traceback
from functools import lru_cache

import cv2
import numpy as np
from tinyface import TinyFace

_tf = TinyFace()


def _log_error(context: str, error: Exception):
    """记录详细的错误信息"""
    error_msg = f"[ERROR] {context}\n"
    error_msg += f"错误类型: {type(error).__name__}\n"
    error_msg += f"错误信息: {str(error)}\n"
    error_msg += f"堆栈跟踪:\n{traceback.format_exc()}"
    print(error_msg)
    return error_msg


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


def swap_face_regions(input_path, face_path, regions):
    try:
        save_path = _get_output_file_path(input_path)
        input_img = _read_image(input_path)
        height, width = input_img.shape[:2]
        normalized_regions = _normalize_regions(regions, width, height)
        if not normalized_regions:
            output_img = _swap_face(input_path, face_path)
            if output_img is None:
                return None
            _write_image(save_path, output_img)
            return save_path

        destination_face = _get_one_face(face_path)
        if destination_face is None:
            raise RuntimeError(f"无法从图片中检测到人脸: {face_path}")

        output_img = input_img.copy()
        swapped_count = 0
        for x, y, w, h in normalized_regions:
            crop = input_img[y : y + h, x : x + w]
            reference_face = _tf.get_one_face(crop)
            if reference_face is None:
                continue
            output_crop = _tf.swap_face(
                vision_frame=crop,
                reference_face=reference_face,
                destination_face=destination_face,
            )
            if output_crop is None:
                continue
            output_img[y : y + h, x : x + w] = output_crop
            swapped_count += 1

        if swapped_count == 0:
            return None

        _write_image(save_path, output_img)
        return save_path
    except Exception as e:
        _log_error("swap_face_regions", e)
        return None


def swap_face_video(input_path, face_path):
    try:
        print(f"[INFO] 开始视频换脸: input={input_path}, face={face_path}")
        
        # 检查输入文件是否存在
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"输入视频文件不存在: {input_path}")
        if not os.path.exists(face_path):
            raise FileNotFoundError(f"人脸图片文件不存在: {face_path}")
        
        save_path = _get_output_video_path(input_path)
        print(f"[INFO] 输出路径: {save_path}")
        
        output_path = _swap_face_video(input_path, face_path, save_path)
        
        if output_path and os.path.exists(output_path):
            print(f"[SUCCESS] 视频换脸成功: {output_path}")
            return output_path
        else:
            print(f"[ERROR] 视频换脸失败: 输出文件不存在")
            return None
            
    except Exception as e:
        _log_error("swap_face_video", e)
        return None


def _swap_face_video(input_path, face_path, save_path):
    cap = None
    writer = None
    
    try:
        print(f"[INFO] 打开视频文件: {input_path}")
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise RuntimeError(f"无法打开视频文件: {input_path}")

        # 获取视频属性
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            fps = 25.0
            print(f"[WARN] 无法获取视频FPS，使用默认值: {fps}")
        else:
            print(f"[INFO] 视频FPS: {fps}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        
        print(f"[INFO] 视频尺寸: {width}x{height}, 总帧数: {total_frames}")

        if width <= 0 or height <= 0:
            print(f"[WARN] 无法获取视频尺寸，尝试读取第一帧")
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("无法读取视频第一帧")
            height, width = frame.shape[:2]
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            print(f"[INFO] 从第一帧获取尺寸: {width}x{height}")

        # 创建视频写入器
        print(f"[INFO] 创建输出视频: {save_path}")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(save_path, fourcc, fps, (width, height))
        if not writer.isOpened():
            raise RuntimeError(f"无法创建输出视频文件: {save_path}")

        # 提取目标人脸
        print(f"[INFO] 提取目标人脸: {face_path}")
        destination_face = _get_one_face(face_path)
        if destination_face is None:
            raise RuntimeError(f"无法从图片中检测到人脸: {face_path}")
        print(f"[SUCCESS] 成功提取目标人脸")

        # 逐帧处理
        frame_count = 0
        processed_count = 0
        failed_count = 0
        
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            
            frame_count += 1
            if frame_count % 30 == 0:  # 每30帧打印一次进度
                progress = (frame_count / total_frames * 100) if total_frames > 0 else 0
                print(f"[PROGRESS] 处理进度: {frame_count}/{total_frames} ({progress:.1f}%)")
            
            try:
                reference_face = _tf.get_one_face(frame)
                if reference_face is None:
                    writer.write(frame)
                    failed_count += 1
                    continue
                    
                output_frame = _tf.swap_face(
                    vision_frame=frame,
                    reference_face=reference_face,
                    destination_face=destination_face,
                )
                writer.write(output_frame if output_frame is not None else frame)
                processed_count += 1
                
            except Exception as e:
                print(f"[WARN] 第{frame_count}帧处理失败: {str(e)}")
                writer.write(frame)
                failed_count += 1

        print(f"[INFO] 视频处理完成:")
        print(f"  - 总帧数: {frame_count}")
        print(f"  - 成功换脸: {processed_count}")
        print(f"  - 跳过/失败: {failed_count}")
        
        return save_path
        
    except Exception as e:
        _log_error("_swap_face_video", e)
        return None
        
    finally:
        if cap is not None:
            cap.release()
            print(f"[INFO] 释放视频读取器")
        if writer is not None:
            writer.release()
            print(f"[INFO] 释放视频写入器")


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
    data = np.fromfile(img_path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError(f"无法读取图片文件: {img_path}")
    # PNG 可能带 Alpha 或灰度通道，TinyFace 通常期望 BGR 3 通道
    if len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def _write_image(img_path: str, img):
    suffix = os.path.splitext(img_path)[-1]
    cv2.imencode(suffix, img)[1].tofile(img_path)


def _normalize_regions(regions, width, height):
    normalized = []
    if not regions:
        return normalized
    for region in regions:
        if not isinstance(region, dict):
            continue
        try:
            x = int(region.get("x", 0))
            y = int(region.get("y", 0))
            w = int(region.get("width", 0))
            h = int(region.get("height", 0))
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))
        normalized.append((x, y, w, h))
    return normalized


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
