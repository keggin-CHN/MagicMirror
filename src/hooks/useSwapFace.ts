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
      return runTask((taskId: string) =>
        Server.createTask({
          id: taskId,
          inputImage,
          targetFace,
          regions,
        })
      );
    },
    [runTask]
  );

  const swapVideo = useCallback(
    async (inputVideo: string, targetFace: string) => {
      return runTask((taskId: string) =>
        Server.createVideoTask({
          id: taskId,
          inputVideo,
          targetFace,
        })
      );
    },
    [runTask]
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
    swapFace,
    swapVideo,
    cancel: () => kSwapFaceRefs.cancel?.(),
  };
}
