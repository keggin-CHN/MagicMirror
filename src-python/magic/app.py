import json

from async_tasks import AsyncTask
from bottle import Bottle, request, response

from .face import load_models, swap_face, swap_face_video

app = Bottle()

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
        task_id = request.json["id"]
        input_image = request.json["inputImage"]
        target_face = request.json["targetFace"]
        assert all([task_id, input_image, target_face])
        res, _ = AsyncTask.run(
            lambda: swap_face(input_image, target_face), task_id=task_id
        )
        return {"result": res}
    except BaseException:
        response.status = 400
        return {"error": "Something went wrong!"}


@app.route("/task/video", method=["POST", "OPTIONS"])
def create_video_task():
    # 处理 OPTIONS 预检请求
    if request.method == "OPTIONS":
        return {}
    
    try:
        task_id = request.json["id"]
        input_video = request.json["inputVideo"]
        target_face = request.json["targetFace"]
        
        print(f"[API] 收到视频换脸请求:")
        print(f"  - task_id: {task_id}")
        print(f"  - input_video: {input_video}")
        print(f"  - target_face: {target_face}")
        
        assert all([task_id, input_video, target_face]), "缺少必要参数"
        
        res, _ = AsyncTask.run(
            lambda: swap_face_video(input_video, target_face), task_id=task_id
        )
        
        if res:
            print(f"[API] 视频换脸任务完成: {res}")
            return {"result": res}
        else:
            print(f"[API] 视频换脸任务失败")
            response.status = 500
            return {"error": "视频换脸处理失败，请查看服务端日志"}
            
    except Exception as e:
        import traceback
        error_msg = f"视频换脸API错误: {str(e)}\n{traceback.format_exc()}"
        print(f"[ERROR] {error_msg}")
        response.status = 400
        return {"error": error_msg}


@app.delete("/task/<task_id>")
def cancel_task(task_id):
    AsyncTask.cancel(task_id)
    return {"success": True}
