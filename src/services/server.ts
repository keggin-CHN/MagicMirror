import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { arch, type } from "@tauri-apps/plugin-os";
import { Child, Command } from "@tauri-apps/plugin-shell";
import { t } from "i18next";

export type ServerStatus = "idle" | "launching" | "running";

export interface Task {
  id: string;
  inputImage: string;
  targetFace: string;
}

export interface VideoTask {
  id: string;
  inputVideo: string;
  targetFace: string;
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
      const command = Command.create(`server-${type()}`);
      command.addListener("close", () => onStop?.());
      this._childProcess = await command.spawn();
      return true;
    } catch {
      return false;
    }
  }

  async kill(): Promise<boolean> {
    if (!this._childProcess) {
      return true;
    }
    try {
      await this._childProcess.kill();
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

  async createTask(task: Task): Promise<string | null> {
    try {
      const res = await fetch(`${this._baseURL}/task`, {
        method: "post",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(task),
      });
      const data = await res.json();
      return data.result || null;
    } catch {
      return null;
    }
  }

  async createVideoTask(task: VideoTask): Promise<string | null> {
    try {
      const res = await fetch(`${this._baseURL}/task/video`, {
        method: "post",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(task),
      });
      const data = await res.json();
      return data.result || null;
    } catch {
      return null;
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
