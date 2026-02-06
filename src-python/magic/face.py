import os
import shutil
import subprocess
import threading
import traceback
from functools import lru_cache

import cv2
import numpy as np
from tinyface import TinyFace

_tf = TinyFace()
_tf_lock = threading.RLock()


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
    save_path = _get_output_file_path(input_path)
    output_img = _swap_face(input_path, face_path)
    return _write_image(save_path, output_img)


def swap_face_regions(input_path, face_path, regions):
    try:
        print(f"[DEBUG] swap_face_regions 被调用")
        print(f"[DEBUG] input_path: {input_path}")
        print(f"[DEBUG] face_path: {face_path}")
        print(f"[DEBUG] regions 类型: {type(regions)}, 值: {regions}")
        
        save_path = _get_output_file_path(input_path)
        input_img = _read_image(input_path)
        height, width = input_img.shape[:2]
        print(f"[DEBUG] 图片尺寸: {width}x{height}")
        
        normalized_regions = _normalize_regions(regions, width, height)
        print(f"[DEBUG] normalized_regions: {normalized_regions}")

        # 未选择/无有效选区：回退全图换脸
        if not normalized_regions:
            print("[WARN] 无有效选区，回退全图换脸！")
            output_img = _swap_face(input_path, face_path)
            return _write_image(save_path, output_img)

        destination_face = _get_one_face(face_path)
        if destination_face is None:
            raise RuntimeError("no-face-detected")

        output_img = input_img.copy()
        swapped_count = 0

        for x, y, w, h in normalized_regions:
            crop = input_img[y : y + h, x : x + w]
            with _tf_lock:
                reference_face = _tf.get_one_face(crop)
            if reference_face is None:
                continue

            with _tf_lock:
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
            raise RuntimeError("no-face-in-selected-regions")

        return _write_image(save_path, output_img)

    except Exception as e:
        _log_error("swap_face_regions", e)
        raise


def swap_face_video(input_path, face_path):
    try:
        print(f"[INFO] 开始视频换脸: input={input_path}, face={face_path}")

        # 检查输入文件是否存在
        if not os.path.exists(input_path):
            raise FileNotFoundError("file-not-found")
        if not os.path.exists(face_path):
            raise FileNotFoundError("file-not-found")

        save_path = _get_output_video_path(input_path)
        print(f"[INFO] 输出路径: {save_path}")

        output_path = _swap_face_video(input_path, face_path, save_path)

        if not output_path or not os.path.exists(output_path):
            raise RuntimeError("video-output-missing")

        # 尝试使用 ffmpeg 把原视频音频复用到输出（OpenCV 写入的视频默认没有音轨）
        try:
            _try_mux_audio(input_path, output_path)
        except Exception as e:
            print(f"[WARN] 音频复用失败，将返回无音轨视频: {str(e)}")

        print(f"[SUCCESS] 视频换脸成功: {output_path}")
        return output_path

    except Exception as e:
        _log_error("swap_face_video", e)
        raise


def _swap_face_video(input_path, face_path, save_path):
    cap = None
    writer = None

    try:
        print(f"[INFO] 打开视频文件: {input_path}")
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise RuntimeError("video-open-failed")

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

        first_frame = None
        if width <= 0 or height <= 0:
            print("[WARN] 无法获取视频尺寸，尝试读取第一帧")
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("video-open-failed")
            first_frame = frame
            height, width = frame.shape[:2]
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            print(f"[INFO] 从第一帧获取尺寸: {width}x{height}")

        # 创建视频写入器
        print(f"[INFO] 创建输出视频: {save_path}")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(save_path, fourcc, fps, (width, height))
        if not writer.isOpened():
            raise RuntimeError("video-write-failed")

        # 提取目标人脸
        print(f"[INFO] 提取目标人脸: {face_path}")
        destination_face = _get_one_face(face_path)
        if destination_face is None:
            raise RuntimeError("no-face-detected")
        print("[SUCCESS] 成功提取目标人脸")

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
                print(
                    f"[PROGRESS] 处理进度: {frame_count}/{total_frames} ({progress:.1f}%)"
                )

            try:
                with _tf_lock:
                    reference_face = _tf.get_one_face(frame)
                if reference_face is None:
                    writer.write(frame)
                    failed_count += 1
                    continue

                with _tf_lock:
                    output_frame = _tf.swap_face(
                        vision_frame=frame,
                        reference_face=reference_face,
                        destination_face=destination_face,
                    )

                out = output_frame if output_frame is not None else frame

                # 防御：确保写入帧尺寸/通道匹配（部分模型/输入可能导致尺寸变化）
                if out is None:
                    out = frame
                if len(out.shape) == 2:
                    out = cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)
                elif out.shape[2] == 4:
                    out = cv2.cvtColor(out, cv2.COLOR_BGRA2BGR)
                if out.shape[1] != width or out.shape[0] != height:
                    out = cv2.resize(out, (width, height), interpolation=cv2.INTER_LINEAR)
                if out.dtype != np.uint8:
                    out = cv2.normalize(out, None, 0, 255, cv2.NORM_MINMAX).astype(
                        np.uint8
                    )

                writer.write(out)
                processed_count += 1

            except Exception as e:
                print(f"[WARN] 第{frame_count}帧处理失败: {str(e)}")
                writer.write(frame)
                failed_count += 1

        print("[INFO] 视频处理完成:")
        print(f"  - 总帧数: {frame_count}")
        print(f"  - 成功换脸: {processed_count}")
        print(f"  - 跳过/失败: {failed_count}")

        return save_path

    except Exception as e:
        _log_error("_swap_face_video", e)
        raise

    finally:
        if cap is not None:
            cap.release()
            print("[INFO] 释放视频读取器")
        if writer is not None:
            writer.release()
            print("[INFO] 释放视频写入器")


@lru_cache(maxsize=12)
def _swap_face(input_path, face_path):
    vision = _read_image(input_path)
    reference_face = _get_one_face(input_path)
    destination_face = _get_one_face(face_path)
    if reference_face is None or destination_face is None:
        raise RuntimeError("no-face-detected")
    with _tf_lock:
        out = _tf.swap_face(
            vision_frame=vision,
            reference_face=reference_face,
            destination_face=destination_face,
        )
    if out is None:
        raise RuntimeError("swap-failed")
    return out


@lru_cache(maxsize=12)
def _get_one_face(face_path: str):
    face_img = _read_image(face_path)
    with _tf_lock:
        return _tf.get_one_face(face_img)


@lru_cache(maxsize=12)
def _read_image(img_path: str):
    data = np.fromfile(img_path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError("image-decode-failed")

    # 兼容 16-bit PNG/TIFF 等：统一转换成 uint8
    if img.dtype != np.uint8:
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    # PNG 可能带 Alpha 或灰度通道，TinyFace 通常期望 BGR 3 通道
    if len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def _write_image(img_path: str, img):
    if img is None:
        raise RuntimeError("swap-failed")

    suffix = (os.path.splitext(img_path)[-1] or ".png").lower()

    def _try_write(path: str, ext: str) -> bool:
        ok, buf = cv2.imencode(ext, img)
        if not ok or buf is None:
            return False
        buf.tofile(path)
        return True

    # 先按原扩展名写，失败则回退 PNG（避免 WebP/TIFF 等编码支持不完整导致无输出文件）
    if _try_write(img_path, suffix):
        return img_path

    fallback_path = os.path.splitext(img_path)[0] + ".png"
    if _try_write(fallback_path, ".png"):
        return fallback_path

    raise RuntimeError("output-write-failed")


def _normalize_regions(regions, width, height):
    normalized = []
    print(f"[DEBUG] _normalize_regions: regions={regions}, 图片尺寸={width}x{height}")
    if not regions:
        print("[DEBUG] regions 为空或 None")
        return normalized
    for i, region in enumerate(regions):
        print(f"[DEBUG] 处理 region[{i}]: type={type(region)}, value={region}")
        if not isinstance(region, dict):
            print(f"[DEBUG] region[{i}] 不是 dict，跳过")
            continue
        try:
            x = int(region.get("x", 0))
            y = int(region.get("y", 0))
            w = int(region.get("width", 0))
            h = int(region.get("height", 0))
            print(f"[DEBUG] region[{i}] 解析: x={x}, y={y}, w={w}, h={h}")
        except (TypeError, ValueError) as e:
            print(f"[DEBUG] region[{i}] 解析失败: {e}")
            continue
        if w <= 0 or h <= 0:
            print(f"[DEBUG] region[{i}] w 或 h <= 0，跳过")
            continue
        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(1, min(w, width - x))
        h = max(1, min(h, height - y))
        print(f"[DEBUG] region[{i}] 规范化后: x={x}, y={y}, w={w}, h={h}")
        normalized.append((x, y, w, h))
    print(f"[DEBUG] 最终 normalized: {normalized}")
    return normalized


def _get_output_file_path(file_name):
    base_name, ext = os.path.splitext(file_name)
    return base_name + "_output" + ext


def _get_output_video_path(file_name):
    base_name, _ = os.path.splitext(file_name)
    return base_name + "_output.mp4"


def _try_mux_audio(input_video_path: str, output_video_path: str):
    """如果系统中存在 ffmpeg，尝试把原视频音频复用到输出视频中（失败则忽略）。"""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return

    tmp_path = os.path.splitext(output_video_path)[0] + "_mux_tmp.mp4"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        output_video_path,
        "-i",
        input_video_path,
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        tmp_path,
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-500:]}")

    os.replace(tmp_path, output_video_path)


def _get_model_path(file_name: str):
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), os.pardir, "models", file_name)
    )
