import json
import os
import threading
import traceback

from async_tasks import AsyncTask
from bottle import Bottle, request, response

from .face import load_models, swap_face, swap_face_regions, swap_face_video

app = Bottle()

ALLOWED_IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}

ALLOWED_VIDEO_EXTS = {
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".m4v",
}


VIDEO_TASK_PROGRESS = {}
VIDEO_TASK_PROGRESS_LOCK = threading.RLock()


def _set_video_task_progress(task_id: str, **updates):
    with VIDEO_TASK_PROGRESS_LOCK:
        state = VIDEO_TASK_PROGRESS.get(task_id, {})
        state.update(updates)
        VIDEO_TASK_PROGRESS[task_id] = state


def _get_video_task_progress(task_id: str):
    with VIDEO_TASK_PROGRESS_LOCK:
        state = VIDEO_TASK_PROGRESS.get(task_id)
        if not state:
            return {"status": "idle", "progress": 0, "etaSeconds": None}
        return state.copy()


def _ext(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def _simplify_task_error(err: object) -> str:
    """把内部异常/堆栈信息收敛成前端可用的错误码，避免泄漏本地路径等细节。"""
    msg = (str(err) if err is not None else "").lower()
    codes = [
        "missing-params",
        "file-not-found",
        "unsupported-image-format",
        "unsupported-video-format",
        "image-decode-failed",
        "no-face-detected",
        "no-face-in-selected-regions",
        "swap-failed",
        "video-open-failed",
        "video-write-failed",
        "video-output-missing",
        "output-write-failed",
    ]
    for code in codes:
        if code in msg:
            return code
    return "internal"


def _validate_file(path: str, allowed_exts: set[str], *, missing_code: str):
    if not path:
        raise RuntimeError("missing-params")
    if not os.path.exists(path):
        raise FileNotFoundError("file-not-found")
    if _ext(path) not in allowed_exts:
        raise RuntimeError(missing_code)

# https://github.com/bottlepy/bottle/issues/881#issuecomment-244024649
app.plugins[0].json_dumps = lambda *args, **kwargs: json.dumps(
    *args, ensure_ascii=False, **kwargs
).encode("utf8")


# Enable CORS
@app.hook("after_request")
def enable_cors():
    response.set_header("Access-Control-Allow-Origin", "*")
    response.set_header("Access-Control-Allow-Methods", "*")
    response.set_header("Access-Control-Allow-Headers", "*")


@app.route("<path:path>", method=["GET", "OPTIONS"])
def handle_options(path):
    response.status = 200
    return "MagicMirror ✨"


@app.get("/status")
def status():
    return {"status": "running"}


@app.route("/prepare", method=["POST", "OPTIONS"])
def prepare():
    # 处理 OPTIONS 预检请求
    if request.method == "OPTIONS":
        return {}
    
    return {"success": load_models()}


@app.route("/task", method=["POST", "OPTIONS"])
def create_task():
    # 处理 OPTIONS 预检请求
    if request.method == "OPTIONS":
        return {}

    try:
        body = request.json or {}
        task_id = body.get("id")
        input_image = body.get("inputImage")
        target_face = body.get("targetFace")
        regions = body.get("regions")

        if not all([task_id, input_image, target_face]):
            response.status = 400
            return {"error": "missing-params"}

        try:
            _validate_file(
                input_image,
                ALLOWED_IMAGE_EXTS,
                missing_code="unsupported-image-format",
            )
            _validate_file(
                target_face,
                ALLOWED_IMAGE_EXTS,
                missing_code="unsupported-image-format",
            )
        except (RuntimeError, FileNotFoundError) as e:
            response.status = 400
            return {"error": _simplify_task_error(e)}

        if regions:
            res, err = AsyncTask.run(
                lambda: swap_face_regions(input_image, target_face, regions),
                task_id=task_id,
            )
        else:
            res, err = AsyncTask.run(
                lambda: swap_face(input_image, target_face),
                task_id=task_id,
            )

        if res:
            return {"result": res}

        response.status = 500
        return {"error": _simplify_task_error(err)}

    except Exception as e:
        print("[ERROR] create_task failed:", str(e), "\n", traceback.format_exc())
        response.status = 500
        return {"error": _simplify_task_error(e)}


@app.route("/task/video", method=["POST", "OPTIONS"])
def create_video_task():
    # 处理 OPTIONS 预检请求
    if request.method == "OPTIONS":
        return {}

    task_id = None
    try:
        body = request.json or {}
        task_id = body.get("id")
        input_video = body.get("inputVideo")
        target_face = body.get("targetFace")

        print("[API] 收到视频换脸请求:")
        print(f"  - task_id: {task_id}")
        print(f"  - input_video: {input_video}")
        print(f"  - target_face: {target_face}")

        if not all([task_id, input_video, target_face]):
            response.status = 400
            return {"error": "missing-params"}

        try:
            _validate_file(
                input_video,
                ALLOWED_VIDEO_EXTS,
                missing_code="unsupported-video-format",
            )
            _validate_file(
                target_face,
                ALLOWED_IMAGE_EXTS,
                missing_code="unsupported-image-format",
            )
        except (RuntimeError, FileNotFoundError) as e:
            response.status = 400
            return {"error": _simplify_task_error(e)}

        _set_video_task_progress(
            task_id,
            status="running",
            progress=0,
            etaSeconds=None,
            error=None,
            result=None,
        )

        def _on_progress(frame_count: int, total_frames: int, elapsed_seconds: float):
            progress = 0.0
            eta_seconds = None
            if total_frames and total_frames > 0:
                progress = max(0.0, min(100.0, frame_count / total_frames * 100.0))
                if frame_count > 0:
                    eta_seconds = max(
                        0, int((elapsed_seconds / frame_count) * (total_frames - frame_count))
                    )
            _set_video_task_progress(
                task_id,
                status="running",
                progress=round(progress, 2),
                etaSeconds=eta_seconds,
                error=None,
            )

        res, err = AsyncTask.run(
            lambda: swap_face_video(
                input_video, target_face, progress_callback=_on_progress
            ),
            task_id=task_id,
        )

        if res:
            print(f"[API] 视频换脸任务完成: {res}")
            _set_video_task_progress(
                task_id,
                status="success",
                progress=100,
                etaSeconds=0,
                error=None,
                result=res,
            )
            return {"result": res}

        final_error = _simplify_task_error(err)
        _set_video_task_progress(
            task_id,
            status="failed",
            error=final_error,
            etaSeconds=None,
        )
        response.status = 500
        return {"error": final_error}

    except Exception as e:
        print("[ERROR] create_video_task failed:", str(e), "\n", traceback.format_exc())
        if task_id:
            _set_video_task_progress(
                task_id,
                status="failed",
                error=_simplify_task_error(e),
                etaSeconds=None,
            )
        response.status = 500
        return {"error": _simplify_task_error(e)}


@app.get("/task/video/progress/<task_id>")
def get_video_task_progress(task_id):
    return _get_video_task_progress(task_id)


@app.delete("/task/<task_id>")
def cancel_task(task_id):
    AsyncTask.cancel(task_id)
    _set_video_task_progress(
        task_id,
        status="cancelled",
        etaSeconds=None,
        error="cancelled",
    )
    return {"success": True}
