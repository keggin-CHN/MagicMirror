import os
import sys
import time
import traceback


def _boot_log_path() -> str:
    """
    Release 包默认禁用控制台（Nuitka --windows-console-mode=disable），
    导致启动阶段异常会“无输出秒退”。这里把启动日志写到 exe 同目录，便于定位问题。
    """
    if getattr(sys, "frozen", False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(__file__)
    return os.path.join(base_dir or os.getcwd(), "server_boot.log")


def _append_boot_log(text: str) -> None:
    try:
        path = _boot_log_path()
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)
            if not text.endswith("\n"):
                f.write("\n")
    except Exception:
        # 启动日志不应影响主流程
        pass


if __name__ == "__main__":
    _append_boot_log("=== boot ===")
    _append_boot_log(f"exe={sys.executable}")
    _append_boot_log(f"cwd={os.getcwd()}")
    _append_boot_log(f"argv={sys.argv!r}")

    try:
        from magic.app import app

        _append_boot_log("import magic.app: OK")
        _append_boot_log("starting bottle server on 0.0.0.0:8023")
        app.run(host="0.0.0.0", port=8023)
    except Exception as e:
        _append_boot_log("boot failed:")
        _append_boot_log(
            "".join(traceback.format_exception(type(e), e, e.__traceback__))
        )
        _append_boot_log("exit=1")
        # 双击启动时，留一点时间让文件落盘
        time.sleep(0.2)
        sys.exit(1)
