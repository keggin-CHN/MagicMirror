import { useCallback, useEffect } from "react";
import { useXState } from "xsta";
import { Server, type Region, type TaskResult } from "../services/server";

const kSwapFaceRefs: {
  id: number;
  cancel?: VoidFunction;
} = {
  id: 1,
  cancel: undefined,
};

export function useSwapFace() {
  const [isSwapping, setIsSwapping] = useXState("isSwapping", false);
  const [output, setOutput] = useXState<string | null>("swapOutput", null);
  const [error, setError] = useXState<string | null>("swapError", null);
  const [videoProgress, setVideoProgress] = useXState("videoSwapProgress", 0);
  const [videoEtaSeconds, setVideoEtaSeconds] = useXState<number | null>(
    "videoSwapEtaSeconds",
    null
  );
  const runTask = useCallback(
    async (create: (taskId: string) => Promise<TaskResult>) => {
      await kSwapFaceRefs.cancel?.();
      setIsSwapping(true);
      setError(null);
      const taskId = (kSwapFaceRefs.id++).toString();
      kSwapFaceRefs.cancel = async () => {
        const success = await Server.cancelTask(taskId);
        if (success) {
          setIsSwapping(false);
        }
      };
      const { result, error } = await create(taskId);
      kSwapFaceRefs.cancel = undefined;
      const finalError = result ? null : error ?? "unknown";
      setError(finalError);
      setOutput(result);
      setIsSwapping(false);
      return result;
    },
    []
  );

  const swapFace = useCallback(
    async (inputImage: string, targetFace: string, regions?: Region[]) => {
      setVideoProgress(0);
      setVideoEtaSeconds(null);
      return runTask((taskId: string) =>
        Server.createTask({
          id: taskId,
          inputImage,
          targetFace,
          regions,
        })
      );
    },
    [runTask, setVideoEtaSeconds, setVideoProgress]
  );

  const swapVideo = useCallback(
    async (inputVideo: string, targetFace: string) => {
      await kSwapFaceRefs.cancel?.();

      setIsSwapping(true);
      setError(null);
      setVideoProgress(0);
      setVideoEtaSeconds(null);

      const taskId = (kSwapFaceRefs.id++).toString();
      let polling = true;

      const pollProgress = async () => {
        while (polling) {
          const state = await Server.getVideoTaskProgress(taskId);
          if (state.status === "running" || state.status === "success") {
            setVideoProgress(state.progress ?? 0);
            setVideoEtaSeconds(state.etaSeconds ?? null);
          } else if (state.status === "failed") {
            setVideoEtaSeconds(null);
          }
          if (!polling) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      };

      const pollPromise = pollProgress();

      kSwapFaceRefs.cancel = async () => {
        polling = false;
        const success = await Server.cancelTask(taskId);
        if (success) {
          setIsSwapping(false);
          setVideoEtaSeconds(null);
        }
      };

      const { result, error } = await Server.createVideoTask({
        id: taskId,
        inputVideo,
        targetFace,
      });

      polling = false;
      await pollPromise;

      kSwapFaceRefs.cancel = undefined;
      const finalError = result ? null : error ?? "unknown";
      setError(finalError);
      setOutput(result);
      if (result) {
        setVideoProgress(100);
        setVideoEtaSeconds(0);
      }
      setIsSwapping(false);
      return result;
    },
    [
      setError,
      setIsSwapping,
      setOutput,
      setVideoEtaSeconds,
      setVideoProgress,
    ]
  );

  useEffect(() => {
    return () => {
      kSwapFaceRefs.cancel?.();
    };
  }, []);

  return {
    isSwapping,
    output,
    error,
    videoProgress,
    videoEtaSeconds,
    swapFace,
    swapVideo,
    cancel: () => kSwapFaceRefs.cancel?.(),
  };
}
