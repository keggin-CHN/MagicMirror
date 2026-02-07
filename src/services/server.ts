import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { arch, type } from "@tauri-apps/plugin-os";
import { Child, Command } from "@tauri-apps/plugin-shell";
import { t } from "i18next";

export type ServerStatus = "idle" | "launching" | "running";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Task {
  id: string;
  inputImage: string;
  targetFace: string;
  regions?: Region[];
}

export interface VideoTask {
  id: string;
  inputVideo: string;
  targetFace: string;
}

export interface TaskResult {
  result: string | null;
  error?: string;
}

export interface VideoTaskProgress {
  status: "idle" | "running" | "success" | "failed" | "cancelled";
  progress: number;
  etaSeconds?: number | null;
  error?: string | null;
}

class _Server {
  _childProcess?: Child;
  _baseURL = "http://localhost:8023";

  async rootDir() {
    return join(await homeDir(), "MagicMirror");
  }

  async isDownloaded() {
    try {
      const binaryPath = await join(
        await this.rootDir(),
        type() === "windows" ? "server.exe" : "server.bin"
      );
      const exists = await invoke<boolean>("file_exists", {
        path: binaryPath,
      });
      if (exists && type() === "macos") {
        const output = await Command.create("chmod", [
          "755",
          binaryPath,
        ]).execute();
        return output.code === 0;
      }
      return exists;
    } catch (error) {
      return false;
    }
  }

  async download() {
    if (await this.isDownloaded()) {
      return true;
    }
    await invoke("download_and_unzip", {
      url: t("downloadURL", { type: type(), arch: arch() }),
      targetDir: await this.rootDir(),
    });
    if (!(await this.isDownloaded())) {
      throw Error("Unknown error");
    }
    return true;
  }

  async launch(onStop?: VoidFunction): Promise<boolean> {
    if (this._childProcess) {
      return true;
    }
    try {
      if (type() === "windows") {
        try {
          await invoke<string[]>("repair_server_runtime", {
            targetDir: await this.rootDir(),
          });
        } catch (error) {
          console.warn("[Server] Windows runtime 修复失败，继续尝试启动:", error);
        }
      }

      const command = Command.create(`server-${type()}`);
      command.addListener("close", () => {
        this._childProcess = undefined;
        onStop?.();
      });
      this._childProcess = await command.spawn();
      return true;
    } catch {
      this._childProcess = undefined;
      return false;
    }
  }

  async kill(): Promise<boolean> {
    if (!this._childProcess) {
      return true;
    }
    const childProcess = this._childProcess;
    this._childProcess = undefined;
    try {
      await childProcess.kill();
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<ServerStatus> {
    try {
      const res = await fetch(`${this._baseURL}/status`, {
        method: "get",
      });
      const data = await res.json();
      return data.status || "idle";
    } catch {
      return "idle";
    }
  }

  async prepare(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseURL}/prepare`, {
        method: "post",
      });
      const data = await res.json();
      return data.success || false;
    } catch {
      return false;
    }
  }

  async createTask(task: Task): Promise<TaskResult> {
    try {
      const res = await fetch(`${this._baseURL}/task`, {
        method: "post",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(task),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[Server] 图片换脸请求失败 (${res.status}):`, errorText);
        try {
          const data = JSON.parse(errorText);
          if (data?.error) {
            return { result: null, error: data.error };
          }
        } catch {
          // ignore
        }
        return { result: null, error: `http-${res.status}` };
      }

      let data: any;
      try {
        data = await res.json();
      } catch (error) {
        console.error("[Server] 图片换脸响应解析失败:", error);
        return { result: null, error: "invalid-json" };
      }

      if (data.error) {
        console.error("[Server] 服务端返回错误:", data.error);
        return { result: null, error: data.error };
      }

      return { result: data.result || null };
    } catch (error) {
      console.error("[Server] 图片换脸请求异常:", error);
      return { result: null, error: "network" };
    }
  }

  async createVideoTask(task: VideoTask): Promise<TaskResult> {
    try {
      console.log("[Server] 发送视频换脸请求:", task);
      const res = await fetch(`${this._baseURL}/task/video`, {
        method: "post",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(task),
      });

      if (res.status === 405) {
        const errorText = await res.text();
        console.error(`[Server] 视频换脸接口不支持 (${res.status}):`, errorText);
        return { result: null, error: "video-not-supported" };
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[Server] 视频换脸请求失败 (${res.status}):`, errorText);
        try {
          const data = JSON.parse(errorText);
          if (data?.error) {
            return { result: null, error: data.error };
          }
        } catch {
          // ignore
        }
        return { result: null, error: `http-${res.status}` };
      }

      let data: any;
      try {
        data = await res.json();
      } catch (error) {
        console.error("[Server] 视频换脸响应解析失败:", error);
        return { result: null, error: "invalid-json" };
      }

      console.log("[Server] 视频换脸响应:", data);

      if (data.error) {
        console.error("[Server] 服务端返回错误:", data.error);
        return { result: null, error: data.error };
      }

      return { result: data.result || null };
    } catch (error) {
      console.error("[Server] 视频换脸请求异常:", error);
      return { result: null, error: "network" };
    }
  }

  async getVideoTaskProgress(taskId: string): Promise<VideoTaskProgress> {
    try {
      const res = await fetch(
        `${this._baseURL}/task/video/progress/${encodeURIComponent(taskId)}`,
        {
          method: "get",
        }
      );
      if (!res.ok) {
        return { status: "idle", progress: 0, etaSeconds: null };
      }
      const data = await res.json();
      return {
        status: data.status ?? "idle",
        progress: Number.isFinite(data.progress) ? Number(data.progress) : 0,
        etaSeconds:
          data.etaSeconds === null || data.etaSeconds === undefined
            ? null
            : Number(data.etaSeconds),
        error: data.error ?? null,
      };
    } catch {
      return { status: "idle", progress: 0, etaSeconds: null };
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseURL}/task/${taskId}`, {
        method: "delete",
      });
      const data = await res.json();
      return data.success || false;
    } catch {
      return false;
    }
  }
}

export const Server = new _Server();
