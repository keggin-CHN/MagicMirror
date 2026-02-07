import { ProgressBar } from "@/components/ProgressBar";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useSwapFace } from "@/hooks/useSwapFace";
import { Server, type FaceSource, type Region } from "@/services/server";
import { getFileExtension, isImageFile, isVideoFile } from "@/services/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";

import "@/styles/mirror.css";

import iconMenu from "@/assets/images/menu.webp";
import background from "@/assets/images/mirror-bg.svg";
import mirrorInput from "@/assets/images/mirror-input.webp";
import mirrorMe from "@/assets/images/mirror-me.webp";
interface Asset {
  path: string;
  src: string;
  type?: "image" | "video";
}

interface FaceAsset extends FaceSource {
  src: string;
  locked?: boolean;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";

const kDefaultFaceSourceId = "default-me";
const kMinSelectionZoom = 0.5;
const kMaxSelectionZoom = 4;

const kMirrorStates: {
  isMe: boolean;
  me?: Asset;
  input?: Asset;
  result?: Asset;
} = { isMe: true };

export function MirrorPage() {
  const [flag, setFlag] = useState(false);
  const rebuild = useRef<any>();
  rebuild.current = () => setFlag(!flag);

  const { i18n, t } = useTranslation();

  const {
    isSwapping,
    swapFace,
    swapVideo,
    error: swapError,
    videoProgress,
    videoEtaSeconds,
  } = useSwapFace();
  const [success, setSuccess] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [draftRegion, setDraftRegion] = useState<Region | null>(null);
  const [inputSize, setInputSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isEditingRegions, setIsEditingRegions] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const selectingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const inputPathRef = useRef<string | null>(null);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState<number | null>(
    null
  );
  const resizeRef = useRef<{
    index: number;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    origin: Region;
  } | null>(null);
  const moveRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    origin: Region;
  } | null>(null);
  const [isMultiFaceMode, setIsMultiFaceMode] = useState(false);
  const [faceSources, setFaceSources] = useState<FaceAsset[]>([]);
  const faceSourceInputRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const autoDetectedImagePathRef = useRef<string | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [videoKeyFrameMs, setVideoKeyFrameMs] = useState(0);
  const [isDetectingFaces, setIsDetectingFaces] = useState(false);
  const [selectionZoom, setSelectionZoom] = useState(1);

  useEffect(() => {
    setTimeout(() => {
      if (kMirrorStates.me && !kMirrorStates.input) {
        kMirrorStates.isMe = false;
        rebuild.current();
      }
      if (kMirrorStates.me && isSwapping) {
        kMirrorStates.isMe = false;
        rebuild.current();
      }
    });
  }, [kMirrorStates.me, kMirrorStates.input, isSwapping]);

  useEffect(() => {
    const input = kMirrorStates.input;
    if (!input) {
      setInputSize(null);
      setRegions([]);
      setDraftRegion(null);
      setIsEditingRegions(false);
      setSelectedRegionIndex(null);
      setVideoDurationMs(0);
      setVideoKeyFrameMs(0);
      selectingRef.current = false;
      startPointRef.current = null;
      resizeRef.current = null;
      moveRef.current = null;
      setSelectionZoom(1);
      inputPathRef.current = null;
      autoDetectedImagePathRef.current = null;
      return;
    }

    const inputIdentity = `${input.type || "image"}:${input.path}`;
    if (inputPathRef.current === inputIdentity) {
      return;
    }

    inputPathRef.current = inputIdentity;
    autoDetectedImagePathRef.current = null;
    setRegions([]);
    setDraftRegion(null);
    setIsEditingRegions(true);
    setSelectedRegionIndex(null);
    setInputSize(null);
    setVideoDurationMs(0);
    setVideoKeyFrameMs(0);
    selectingRef.current = false;
    startPointRef.current = null;
    resizeRef.current = null;
    moveRef.current = null;
    setSelectionZoom(1);

    if (input.type === "image") {
      const img = new Image();
      img.onload = () => {
        setInputSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = convertFileSrc(input.path);
    }
  }, [kMirrorStates.input?.path, kMirrorStates.input?.type]);

  useEffect(() => {
    const me = kMirrorStates.me;
    if (!isMultiFaceMode || !me) {
      return;
    }
    setFaceSources((prev: FaceAsset[]) => {
      const others = prev.filter((item) => item.id !== kDefaultFaceSourceId);
      return [
        {
          id: kDefaultFaceSourceId,
          path: me.path,
          src: me.src,
          locked: true,
        },
        ...others,
      ];
    });
  }, [isMultiFaceMode, flag]);

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));

  const isImageInput = kMirrorStates.input?.type === "image";
  const isVideoInput = kMirrorStates.input?.type === "video";
  const canSelect =
    !kMirrorStates.isMe &&
    (isImageInput || isVideoInput) &&
    isEditingRegions &&
    !isSwapping &&
    !!inputSize;
  const showSelection =
    (isImageInput || isVideoInput) &&
    isEditingRegions &&
    !kMirrorStates.isMe &&
    !!inputSize;
  const showToolbar = showSelection && !isSwapping;
  const canStartSwap =
    isVideoInput && !isMultiFaceMode ? true : regions.length > 0;
  const selectionObjectFit: "contain" | "cover" = showSelection
    ? "contain"
    : "cover";
  const selectionPadding = isMultiFaceMode
    ? isVideoInput
      ? "56px 56px 300px"
      : "56px 56px 240px"
    : isVideoInput
      ? "56px 56px 180px"
      : "56px 56px 120px";

  const mapMediaRegionsToScreen = useCallback(
    (mediaRegions: Region[], mediaWidth: number, mediaHeight: number): Region[] => {
      if (!previewRef.current || mediaWidth <= 0 || mediaHeight <= 0) {
        return [];
      }

      const rect = previewRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return [];
      }

      const scale = Math.min(rect.width / mediaWidth, rect.height / mediaHeight);
      const displayWidth = mediaWidth * scale;
      const displayHeight = mediaHeight * scale;
      const offsetX = (rect.width - displayWidth) / 2;
      const offsetY = (rect.height - displayHeight) / 2;

      return mediaRegions
        .map((region: Region) => {
          const x = clamp(region.x * scale + offsetX, 0, rect.width - 1);
          const y = clamp(region.y * scale + offsetY, 0, rect.height - 1);
          const width = clamp(region.width * scale, 1, rect.width - x);
          const height = clamp(region.height * scale, 1, rect.height - y);
          return {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
          };
        })
        .filter((region: Region) => region.width > 1 && region.height > 1);
    },
    [clamp]
  );

  const toImageRegions = useCallback((): Region[] => {
    if (!previewRef.current || !inputSize) {
      console.log("[DEBUG] toImageRegions: previewRef 或 inputSize 为空", { previewRef: previewRef.current, inputSize });
      return [];
    }
    const rect = previewRef.current.getBoundingClientRect();

    // object-fit 的缩放计算（选区编辑态使用 contain，保证整图可见）
    const baseScale =
      selectionObjectFit === "cover"
        ? Math.max(rect.width / inputSize.width, rect.height / inputSize.height)
        : Math.min(rect.width / inputSize.width, rect.height / inputSize.height);

    const scale = baseScale * (showSelection ? selectionZoom : 1);

    const displayWidth = inputSize.width * scale;
    const displayHeight = inputSize.height * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;

    console.log("[DEBUG] toImageRegions 转换参数:", {
      containerRect: { width: rect.width, height: rect.height },
      inputSize,
      scale,
      baseScale,
      selectionZoom,
      displaySize: { width: displayWidth, height: displayHeight },
      offset: { x: offsetX, y: offsetY },
      screenRegions: regions,
    });

    const imageRegions = regions
      .map((region: Region, idx: number) => {
        const x = Math.round((region.x - offsetX) / scale);
        const y = Math.round((region.y - offsetY) / scale);
        const width = Math.round(region.width / scale);
        const height = Math.round(region.height / scale);
        const clampedX = clamp(x, 0, inputSize.width - 1);
        const clampedY = clamp(y, 0, inputSize.height - 1);
        const clampedWidth = clamp(width, 1, inputSize.width - clampedX);
        const clampedHeight = clamp(height, 1, inputSize.height - clampedY);

        console.log(`[DEBUG] region[${idx}] 转换:`, {
          screen: region,
          raw: { x, y, width, height },
          clamped: { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight },
        });

        return {
          x: clampedX,
          y: clampedY,
          width: clampedWidth,
          height: clampedHeight,
          faceSourceId: region.faceSourceId,
        };
      })
      .filter((region: Region) => region.width > 1 && region.height > 1);

    console.log("[DEBUG] toImageRegions 最终结果:", imageRegions);
    return imageRegions;
  }, [regions, inputSize, selectionObjectFit, showSelection, selectionZoom]);

  useEffect(() => {
    if (!showSelection || !isImageInput || !inputSize) {
      return;
    }
    const input = kMirrorStates.input;
    if (!input || input.type !== "image") {
      return;
    }
    if (autoDetectedImagePathRef.current === input.path) {
      return;
    }

    autoDetectedImagePathRef.current = input.path;
    let cancelled = false;

    (async () => {
      setIsDetectingFaces(true);
      const detected = await Server.detectImageFaces(input.path);
      if (cancelled) {
        return;
      }
      setIsDetectingFaces(false);

      if (detected.error) {
        return;
      }

      const screenRegions = mapMediaRegionsToScreen(
        detected.regions || [],
        inputSize.width,
        inputSize.height
      ).map((region: Region) => ({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      }));

      setRegions(screenRegions);
      setSelectedRegionIndex(screenRegions.length > 0 ? 0 : null);
      if (!screenRegions.length) {
        setNotice(t("No face detected in selected areas."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showSelection, isImageInput, inputSize, mapMediaRegionsToScreen, t]);

  useEffect(() => {
    if (!isVideoInput || !showSelection) {
      return;
    }
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }
    const targetTime = Math.max(0, videoKeyFrameMs / 1000);
    if (Math.abs(video.currentTime - targetTime) > 0.05) {
      try {
        video.currentTime = targetTime;
      } catch {
        // ignore
      }
    }
    video.pause();
  }, [isVideoInput, showSelection, videoKeyFrameMs, kMirrorStates.input?.path]);

  const remapRegionsForZoom = useCallback(
    (currentRegions: Region[], oldZoom: number, newZoom: number) => {
      if (!previewRef.current) return currentRegions;
      const rect = previewRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const factor = newZoom / oldZoom;

      return currentRegions.map((r) => {
        const x = cx + (r.x - cx) * factor;
        const y = cy + (r.y - cy) * factor;
        const width = r.width * factor;
        const height = r.height * factor;
        return {
          ...r,
          x,
          y,
          width,
          height,
        };
      });
    },
    []
  );

  const handleWheelZoom = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!showSelection) return;
      event.stopPropagation();

      const delta = -event.deltaY;
      const step = 0.1;
      const nextZoom = clamp(
        selectionZoom + (delta > 0 ? step : -step),
        kMinSelectionZoom,
        kMaxSelectionZoom
      );

      if (nextZoom !== selectionZoom) {
        const nextRegions = remapRegionsForZoom(regions, selectionZoom, nextZoom);
        setRegions(nextRegions);
        setSelectionZoom(nextZoom);
      }
    },
    [showSelection, selectionZoom, regions, remapRegionsForZoom, clamp]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSelect || !previewRef.current) {
        return;
      }
      const rect = previewRef.current.getBoundingClientRect();
      const startX = clamp(event.clientX - rect.left, 0, rect.width);
      const startY = clamp(event.clientY - rect.top, 0, rect.height);
      previewRef.current.setPointerCapture(event.pointerId);
      resizeRef.current = null;
      moveRef.current = null;
      setSelectedRegionIndex(null);
      selectingRef.current = true;
      startPointRef.current = { x: startX, y: startY };
      setDraftRegion({ x: startX, y: startY, width: 0, height: 0 });
    },
    [canSelect, clamp]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!previewRef.current) {
        return;
      }
      const rect = previewRef.current.getBoundingClientRect();
      const currentX = clamp(event.clientX - rect.left, 0, rect.width);
      const currentY = clamp(event.clientY - rect.top, 0, rect.height);

      if (resizeRef.current) {
        const { index, handle, startX, startY, origin } = resizeRef.current;
        const dx = currentX - startX;
        const dy = currentY - startY;
        const minSize = 8;
        let { x, y, width, height } = origin;
        let newX = x;
        let newY = y;
        let newW = width;
        let newH = height;

        switch (handle) {
          case "nw":
            newX = clamp(x + dx, 0, x + width - minSize);
            newY = clamp(y + dy, 0, y + height - minSize);
            newW = width - (newX - x);
            newH = height - (newY - y);
            break;
          case "ne":
            newY = clamp(y + dy, 0, y + height - minSize);
            newW = clamp(width + dx, minSize, rect.width - x);
            newH = height - (newY - y);
            break;
          case "sw":
            newX = clamp(x + dx, 0, x + width - minSize);
            newW = width - (newX - x);
            newH = clamp(height + dy, minSize, rect.height - y);
            break;
          case "se":
          default:
            newW = clamp(width + dx, minSize, rect.width - x);
            newH = clamp(height + dy, minSize, rect.height - y);
            break;
        }

        setRegions((prev: Region[]) =>
          prev.map((region, idx) =>
            idx === index
              ? {
                ...region,
                x: newX,
                y: newY,
                width: newW,
                height: newH,
              }
              : region
          )
        );
        return;
      }

      if (moveRef.current) {
        const { index, startX, startY, origin } = moveRef.current;
        const dx = currentX - startX;
        const dy = currentY - startY;
        const newX = clamp(origin.x + dx, 0, rect.width - origin.width);
        const newY = clamp(origin.y + dy, 0, rect.height - origin.height);

        setRegions((prev: Region[]) =>
          prev.map((region, idx) =>
            idx === index
              ? {
                ...region,
                x: newX,
                y: newY,
              }
              : region
          )
        );
        return;
      }

      if (!selectingRef.current || !startPointRef.current) {
        return;
      }
      const start = startPointRef.current;
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);
      setDraftRegion({ x, y, width, height });
    },
    [clamp]
  );

  const finishSelection = useCallback(
    (event?: PointerEvent<HTMLDivElement>) => {
      if (event && previewRef.current) {
        try {
          previewRef.current.releasePointerCapture(event.pointerId);
        } catch {
          // ignore: might not have pointer capture
        }
      }
      if (resizeRef.current) {
        resizeRef.current = null;
        return;
      }
      if (moveRef.current) {
        moveRef.current = null;
        return;
      }
      if (!selectingRef.current) {
        return;
      }
      selectingRef.current = false;
      if (draftRegion && draftRegion.width > 4 && draftRegion.height > 4) {
        setRegions((prev: Region[]) => [...prev, { ...draftRegion }]);
        setSelectedRegionIndex(regions.length);
      }
      setDraftRegion(null);
      startPointRef.current = null;
      moveRef.current = null;
    },
    [draftRegion, regions.length, isMultiFaceMode, faceSources]
  );

  const handleSelectRegion = useCallback(
    (index: number) => (event: PointerEvent<HTMLDivElement>) => {
      if (!canSelect || !previewRef.current) {
        return;
      }
      event.stopPropagation();
      const rect = previewRef.current.getBoundingClientRect();
      const startX = clamp(event.clientX - rect.left, 0, rect.width);
      const startY = clamp(event.clientY - rect.top, 0, rect.height);
      previewRef.current.setPointerCapture(event.pointerId);
      selectingRef.current = false;
      startPointRef.current = null;
      setDraftRegion(null);
      resizeRef.current = null;
      moveRef.current = {
        index,
        startX,
        startY,
        origin: regions[index],
      };
      setSelectedRegionIndex(index);
    },
    [canSelect, clamp, regions]
  );

  const handleResizePointerDown = useCallback(
    (index: number, handle: ResizeHandle) =>
      (event: PointerEvent<HTMLDivElement>) => {
        if (!canSelect || !previewRef.current) {
          return;
        }
        event.stopPropagation();
        const rect = previewRef.current.getBoundingClientRect();
        const startX = clamp(event.clientX - rect.left, 0, rect.width);
        const startY = clamp(event.clientY - rect.top, 0, rect.height);
        previewRef.current.setPointerCapture(event.pointerId);
        moveRef.current = null;
        resizeRef.current = {
          index,
          handle,
          startX,
          startY,
          origin: regions[index],
        };
        setSelectedRegionIndex(index);
      },
    [canSelect, clamp, regions]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedRegionIndex === null) {
      return;
    }
    setRegions((prev: Region[]) =>
      prev.filter((_, index) => index !== selectedRegionIndex)
    );
    setSelectedRegionIndex(null);
  }, [selectedRegionIndex]);

  const handleClearRegions = useCallback(() => {
    setRegions([]);
    setDraftRegion(null);
    setNotice(null);
    setSelectedRegionIndex(null);
    selectingRef.current = false;
    startPointRef.current = null;
    resizeRef.current = null;
    moveRef.current = null;
  }, []);

  const handleEditRegions = useCallback(() => {
    if (!kMirrorStates.input || kMirrorStates.input.type !== "image") {
      return;
    }
    kMirrorStates.result = undefined;
    rebuild.current();
    setSelectedRegionIndex(null);
    setIsEditingRegions(true);
  }, []);

  const handleToggleMultiFaceMode = useCallback(() => {
    setIsMultiFaceMode((prev: boolean) => {
      const next = !prev;
      if (!next) {
        setFaceSources([]);
        setRegions((prevRegions: Region[]) =>
          prevRegions.map((region: Region) => ({
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          }))
        );
      } else {
        const me = kMirrorStates.me;
        if (!me) {
          return next;
        }
        setFaceSources((prevSources: FaceAsset[]) => {
          const others = prevSources.filter(
            (item) => item.id !== kDefaultFaceSourceId
          );
          return [
            {
              id: kDefaultFaceSourceId,
              path: me.path,
              src: me.src,
              locked: true,
            },
            ...others,
          ];
        });
      }
      return next;
    });
    setNotice(null);
  }, []);

  const addFaceSourcesFromPaths = useCallback((paths: string[]) => {
    if (!paths.length) {
      return;
    }
    const additions = paths
      .filter((path: string) => {
        const ext = getFileExtension(path);
        return isImageFile(path) && ext !== ".heic" && ext !== ".heif";
      })
      .map((path: string, idx: number) => ({
        id: `face-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        path,
        src: convertFileSrc(path),
      }));

    if (!additions.length) {
      return;
    }

    setFaceSources((prev: FaceAsset[]) => {
      const existed = new Set(prev.map((item) => item.path));
      const deduped = additions.filter((item) => !existed.has(item.path));
      if (!deduped.length) {
        return prev;
      }
      return [...prev, ...deduped];
    });
    setNotice(null);
  }, []);

  const handleOpenFaceSourcePicker = useCallback(() => {
    faceSourceInputRef.current?.click();
  }, []);

  const handleFaceSourceInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      const paths = files
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => !!path);

      addFaceSourcesFromPaths(paths);
      event.currentTarget.value = "";
    },
    [addFaceSourcesFromPaths]
  );

  const handleAssignSelectedRegionFaceSource = useCallback(
    (faceSourceId: string) => {
      if (selectedRegionIndex === null) {
        return;
      }
      setRegions((prev: Region[]) =>
        prev.map((region: Region, idx: number) =>
          idx === selectedRegionIndex ? { ...region, faceSourceId } : region
        )
      );
    },
    [selectedRegionIndex]
  );

  const handleRemoveFaceSource = useCallback(
    (faceSourceId: string) => {
      if (faceSourceId === kDefaultFaceSourceId) {
        return;
      }
      setFaceSources((prev: FaceAsset[]) =>
        prev.filter((source) => source.id !== faceSourceId || source.locked)
      );
      setRegions((prev: Region[]) =>
        prev.map((region: Region) =>
          region.faceSourceId === faceSourceId
            ? { ...region, faceSourceId: undefined }
            : region
        )
      );
    },
    [faceSources]
  );

  const handleVideoTimelineChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      setVideoKeyFrameMs(
        Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0
      );
    },
    []
  );

  const handleDetectVideoFacesAtKeyFrame = useCallback(async () => {
    const input = kMirrorStates.input;
    if (!input || input.type !== "video" || !inputSize) {
      return;
    }

    setNotice(null);
    setSelectionZoom(1);
    setIsDetectingFaces(true);
    const detected = await Server.detectVideoFaces(
      input.path,
      Math.max(0, Math.round(videoKeyFrameMs))
    );
    setIsDetectingFaces(false);

    if (detected.error) {
      setNotice(t("Failed to detect faces at key frame."));
      return;
    }

    const frameWidth = detected.frameWidth || inputSize.width;
    const frameHeight = detected.frameHeight || inputSize.height;
    const screenRegions = mapMediaRegionsToScreen(
      detected.regions || [],
      frameWidth,
      frameHeight
    ).map((region: Region) => ({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    }));

    setRegions(screenRegions);
    setSelectedRegionIndex(screenRegions.length ? 0 : null);
    if (!screenRegions.length) {
      setNotice(t("No face detected in selected areas."));
    }
  }, [inputSize, mapMediaRegionsToScreen, t, videoKeyFrameMs]);

  const handleStartSwap = useCallback(async () => {
    const me = kMirrorStates.me;
    const input = kMirrorStates.input;
    if (!me || !input) {
      return;
    }

    const beginSwap = () => {
      setNotice(null);
      kMirrorStates.result = undefined;
      rebuild.current();
      setIsEditingRegions(false);
      setSelectedRegionIndex(null);
      setDraftRegion(null);
      selectingRef.current = false;
      startPointRef.current = null;
      resizeRef.current = null;
      moveRef.current = null;
    };

    if (input.type === "video") {
      if (isMultiFaceMode) {
        if (!regions.length) {
          setNotice(t("Please select at least one area."));
          return;
        }

        const videoRegions = toImageRegions();
        if (!videoRegions.length) {
          setNotice(t("Please select at least one area."));
          return;
        }

        if (!faceSources.length) {
          setNotice(t("Please add at least one face source."));
          return;
        }

        if (videoRegions.some((region: Region) => !region.faceSourceId)) {
          setNotice(t("Please assign a face source to each selected area."));
          return;
        }

        beginSwap();

        const result = await swapVideo({
          inputVideo: input.path,
          regions: videoRegions,
          faceSources: faceSources.map((item: FaceAsset) => ({
            id: item.id,
            path: item.path,
          })),
          keyFrameMs: Math.max(0, Math.round(videoKeyFrameMs)),
        });

        setSuccess(result != null);
        if (result) {
          kMirrorStates.result = {
            src: `${convertFileSrc(result)}?t=${Date.now()}`,
            path: result,
            type: "video",
          };
        } else {
          setIsEditingRegions(true);
        }
        rebuild.current();
        return;
      }

      beginSwap();

      const result = await swapVideo({
        inputVideo: input.path,
        targetFace: me.path,
      });

      setSuccess(result != null);
      if (result) {
        kMirrorStates.result = {
          src: `${convertFileSrc(result)}?t=${Date.now()}`,
          path: result,
          type: "video",
        };
      } else {
        setIsEditingRegions(true);
      }
      rebuild.current();
      return;
    }

    if (input.type !== "image") {
      return;
    }

    if (!regions.length) {
      setNotice(t("Please select at least one area."));
      return;
    }

    const imageRegions = toImageRegions();
    if (!imageRegions.length) {
      setNotice(t("Please select at least one area."));
      return;
    }

    if (isMultiFaceMode && !faceSources.length) {
      setNotice(t("Please add at least one face source."));
      return;
    }

    if (
      isMultiFaceMode &&
      imageRegions.some((region: Region) => !region.faceSourceId)
    ) {
      setNotice(t("Please assign a face source to each selected area."));
      return;
    }

    beginSwap();

    const result = await swapFace(
      isMultiFaceMode
        ? {
          inputImage: input.path,
          regions: imageRegions,
          faceSources: faceSources.map((item: FaceAsset) => ({
            id: item.id,
            path: item.path,
          })),
        }
        : {
          inputImage: input.path,
          targetFace: me.path,
          regions: imageRegions,
        }
    );

    setSuccess(result != null);
    if (result) {
      kMirrorStates.result = {
        src: `${convertFileSrc(result)}?t=${Date.now()}`,
        path: result,
        type: "image",
      };
    } else {
      setIsEditingRegions(true);
    }
    rebuild.current();
  }, [
    faceSources,
    isMultiFaceMode,
    regions,
    swapFace,
    swapVideo,
    t,
    toImageRegions,
    videoKeyFrameMs,
  ]);

  const { ref, isOverTarget } = useDragDrop(async (paths: string[]) => {
    if (!paths.length) {
      return;
    }

    const shouldAddFaceSources =
      !kMirrorStates.isMe &&
      isEditingRegions &&
      isMultiFaceMode &&
      !!kMirrorStates.input &&
      (kMirrorStates.input.type === "image" ||
        kMirrorStates.input.type === "video");

    if (shouldAddFaceSources) {
      addFaceSourcesFromPaths(paths);
      return;
    }

    const path = paths[0];
    const src = convertFileSrc(path);
    const isVideo = isVideoFile(path);
    const isImage = isImageFile(path);
    const ext = getFileExtension(path);
    const isHeic = ext === ".heic" || ext === ".heif";

    if (kMirrorStates.isMe) {
      if (!isImage) {
        setNotice(
          isHeic
            ? t("HEIC/HEIF is not supported. Please convert to JPG/PNG.")
            : t("Please use an image for your face photo.")
        );
        return;
      }
      kMirrorStates.me = {
        src,
        path,
        type: "image",
      };
      setNotice(null);
      rebuild.current();
    } else {
      if (!isImage && !isVideo) {
        setNotice(
          isHeic
            ? t("HEIC/HEIF is not supported. Please convert to JPG/PNG.")
            : t("Unsupported file type.")
        );
        return;
      }
      kMirrorStates.input = {
        src,
        path,
        type: isVideo ? "video" : "image",
      };
      setNotice(null);
      rebuild.current();
    }

    if (kMirrorStates.me && kMirrorStates.input) {
      kMirrorStates.result = undefined;
      rebuild.current();
      setIsEditingRegions(true);
    }
  });

  const isReady = kMirrorStates.me && kMirrorStates.input;
  const hasRegions = regions.length > 0;
  const selectionTips =
    isReady && !isSwapping && !kMirrorStates.isMe && isEditingRegions
      ? hasRegions
        ? t("Click Start to swap selected areas.")
        : isVideoInput
          ? t("Pick a key frame, then detect faces or draw boxes.")
          : t("Draw boxes to select areas.")
      : null;

  // Map error codes to user-friendly messages
  const getSwapErrorMessage = (error: string | null): string | null => {
    if (!error) return null;
    const errorMap: Record<string, string> = {
      "video-not-supported": t("Video face swap not supported. Please update server."),
      "unsupported-image-format": t("Unsupported image format. Please use JPG/PNG/WebP/BMP/TIFF."),
      "unsupported-video-format": t("Unsupported video format. Please use MP4/MOV/AVI/MKV/WEBM/M4V."),
      "image-decode-failed": t("Failed to read image file. Please try converting to JPG/PNG."),
      "file-not-found": t("File not found. Please reselect the file."),
      "no-face-detected": t("No face detected in the photo."),
      "no-face-in-selected-regions": t("No face detected in selected areas."),
      "output-write-failed": t("Failed to save output file."),
      "video-open-failed": t("Failed to open video file."),
      "video-write-failed": t("Failed to write output video file."),
      "video-output-missing": t("Video swap failed. Output file missing."),
      "missing-face-sources": t("Please add at least one face source."),
      "invalid-face-source-binding": t(
        "Please assign a face source to each selected area."
      ),
      "face-source-not-found": t(
        "Please assign a face source to each selected area."
      ),
    };
    return errorMap[error] || null;
  };

  const swapErrorMessage = getSwapErrorMessage(swapError);

  const formatEta = useCallback((seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
      return "--:--";
    }
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(safeSeconds / 60)
      .toString()
      .padStart(2, "0");
    const ss = (safeSeconds % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }, []);

  const tips = notice
    ? notice
    : kMirrorStates.isMe
      ? t("First, drag your front-facing photo into the mirror.")
      : !isReady
        ? t("Then, drag the photo you want to swap faces with into the mirror.")
        : isSwapping
          ? isVideoInput
            ? t("Video swapping... This may take a while, please wait.")
            : t("Face swapping... This may take a few seconds, please wait.")
          : isDetectingFaces
            ? t("Detecting faces...")
            : selectionTips
              ? selectionTips
              : swapErrorMessage
                ? swapErrorMessage
                : success
                  ? isVideoInput
                    ? t("Face swap successful! Video saved locally.")
                    : t("Face swap successful! Image saved locally.")
                  : isVideoInput
                    ? t("Video face swap failed. Try a different video.")
                    : t("Face swap failed. Try a different image.");

  const previewSrc = kMirrorStates.isMe
    ? kMirrorStates.me?.src || background
    : isImageInput && isEditingRegions
      ? kMirrorStates.input?.src || background
      : kMirrorStates.result?.src || kMirrorStates.input?.src || background;

  const previewType = kMirrorStates.isMe
    ? "image"
    : isImageInput
      ? "image"
      : kMirrorStates.result?.type || kMirrorStates.input?.type || "image";

  return (
    <div data-tauri-drag-region className="w-100vw h-100vh p-40px">
      <input
        ref={faceSourceInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFaceSourceInputChange}
      />
      <div ref={ref} className="relative w-full h-full">
        <div className="absolute top-[-40px] w-full flex-c-c c-white z-10">
          <p className="bg-black p-[4px_8px]">{tips}</p>
        </div>
        <div className="absolute top-50px right-50px z-10">
          <div className="relative dropdown">
            <img
              src={iconMenu}
              className="h-70px cursor-pointer pb-10px"
              draggable={false}
            />
            <div>
              <div className="dropdown-menu flex-col-c-c bg-black color-white">
                <div
                  onClick={() => {
                    i18n.changeLanguage(i18n.language === "en" ? "zh" : "en");
                  }}
                >
                  {t("Language")}
                </div>
                {kMirrorStates.me && (
                  <div
                    onClick={() => {
                      kMirrorStates.isMe = !kMirrorStates.isMe;
                      rebuild.current();
                    }}
                  >
                    {t("Switch")}
                  </div>
                )}
                {!kMirrorStates.isMe && (isImageInput || isVideoInput) && (
                  <div onClick={handleToggleMultiFaceMode}>
                    {isMultiFaceMode ? t("Single-Face Mode") : t("Multi-Face Swap")}
                  </div>
                )}
                <div onClick={() => open(t("aboutLink"))}>{t("About")}</div>
                <div onClick={() => exit(0)}>{t("Quit")}</div>
              </div>
            </div>
          </div>
        </div>
        {!showSelection && (
          <img
            src={kMirrorStates.isMe ? mirrorMe : mirrorInput}
            className="mirror-frame absolute w-full h-full object-cover z-3"
            draggable={false}
            style={{
              maskImage:
                "radial-gradient(circle, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 1) 40%)",
              WebkitMaskImage:
                "radial-gradient(circle, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 1) 40%)",
            }}
          />
        )}
        <div
          className="w-full h-full flex-c-c"
          style={{
            padding: showSelection
              ? selectionPadding
              : kMirrorStates.isMe
                ? "120px"
                : "100px",
          }}
        >
          <div className={`mirror-preview ${isOverTarget ? "drop-over" : ""}`}>
            <div className={`mirror-clip ${showSelection ? "rect-edit-mode" : ""}`}>
              <div
                ref={previewRef}
                className={`preview-container ${showSelection ? "selection-active" : ""}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishSelection}
                onPointerCancel={finishSelection}
                onWheel={handleWheelZoom}
              >
                {previewType === "video" ? (
                  <video
                    ref={previewVideoRef}
                    src={previewSrc}
                    className={`preview-media ${showSelection ? "rect-edit-mode zoomable" : ""}`}
                    style={{
                      objectFit: selectionObjectFit,
                      transform: showSelection ? `scale(${selectionZoom})` : undefined,
                    }}
                    autoPlay={!showSelection}
                    loop={!showSelection}
                    muted
                    playsInline
                    onLoadedMetadata={(event) => {
                      const media = event.currentTarget;
                      if (media.videoWidth > 0 && media.videoHeight > 0) {
                        setInputSize({
                          width: media.videoWidth,
                          height: media.videoHeight,
                        });
                      }
                      const durationSeconds = Number.isFinite(media.duration)
                        ? Math.max(0, media.duration)
                        : 0;
                      const durationMs = Math.round(durationSeconds * 1000);
                      setVideoDurationMs(durationMs);
                      setVideoKeyFrameMs((prev: number) =>
                        Math.min(prev, durationMs)
                      );
                      if (showSelection) {
                        media.pause();
                      }
                    }}
                  />
                ) : (
                  <img
                    src={previewSrc}
                    className={`preview-media ${showSelection ? "rect-edit-mode zoomable" : ""}`}
                    style={{
                      objectFit: selectionObjectFit,
                      transform: showSelection ? `scale(${selectionZoom})` : undefined,
                    }}
                    draggable={false}
                  />
                )}
                {showSelection && (
                  <div className="selection-layer">
                    {regions.map((region: Region, index: number) => (
                      <div
                        key={`region-${index}`}
                        className={`selection-rect ${selectedRegionIndex === index ? "selected" : ""}`}
                        style={{
                          left: region.x,
                          top: region.y,
                          width: region.width,
                          height: region.height,
                        }}
                        onPointerDown={handleSelectRegion(index)}
                      >
                        <span className="selection-index">{index + 1}</span>
                        {selectedRegionIndex === index && (
                          <>
                            <div
                              className="selection-handle nw"
                              onPointerDown={handleResizePointerDown(index, "nw")}
                            />
                            <div
                              className="selection-handle ne"
                              onPointerDown={handleResizePointerDown(index, "ne")}
                            />
                            <div
                              className="selection-handle sw"
                              onPointerDown={handleResizePointerDown(index, "sw")}
                            />
                            <div
                              className="selection-handle se"
                              onPointerDown={handleResizePointerDown(index, "se")}
                            />
                          </>
                        )}
                      </div>
                    ))}
                    {draftRegion && (
                      <div
                        className="selection-rect draft"
                        style={{
                          left: draftRegion.x,
                          top: draftRegion.y,
                          width: draftRegion.width,
                          height: draftRegion.height,
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
            {showSelection && isVideoInput && (
              <div
                className="video-timeline-panel"
                onPointerDown={(
                  event: PointerEvent<HTMLDivElement>
                ) => event.stopPropagation()}
              >
                <div className="video-timeline-row">
                  <span className="video-timeline-label">{t("Key Frame")}</span>
                  <input
                    className="video-timeline-slider"
                    type="range"
                    min={0}
                    max={Math.max(videoDurationMs, 0)}
                    step={40}
                    value={Math.min(videoKeyFrameMs, Math.max(videoDurationMs, 0))}
                    onChange={handleVideoTimelineChange}
                  />
                  <span className="video-timeline-value">
                    {(Math.max(videoKeyFrameMs, 0) / 1000).toFixed(2)}s
                  </span>
                  <div
                    className={`selection-btn ${isDetectingFaces || !inputSize ? "disabled" : ""}`}
                    onClick={handleDetectVideoFacesAtKeyFrame}
                  >
                    {isDetectingFaces
                      ? t("Detecting faces...")
                      : t("Detect Faces")}
                  </div>
                </div>
              </div>
            )}
            {showToolbar && (
              <div
                className="selection-toolbar"
                onPointerDown={(
                  event: PointerEvent<HTMLDivElement>
                ) => event.stopPropagation()}
              >
                <div
                  className={`selection-btn ${canStartSwap ? "" : "disabled"}`}
                  onClick={handleStartSwap}
                >
                  {t("Start Swap")}
                </div>
                <div
                  className={`selection-btn ${selectedRegionIndex === null ? "disabled" : ""}`}
                  onClick={handleDeleteSelected}
                >
                  {t("Delete Selected")}
                </div>
                <div
                  className={`selection-btn ${regions.length ? "" : "disabled"}`}
                  onClick={handleClearRegions}
                >
                  {t("Clear Selection")}
                </div>
              </div>
            )}
            {!showSelection && isImageInput && kMirrorStates.result && (
              <div
                className="selection-toolbar"
                onPointerDown={(
                  event: PointerEvent<HTMLDivElement>
                ) => event.stopPropagation()}
              >
                <div className="selection-btn" onClick={handleEditRegions}>
                  {t("Edit Selection")}
                </div>
              </div>
            )}
            {showSelection && isMultiFaceMode && (
              <div
                className={`face-source-panel ${isVideoInput ? "video-mode" : ""}`}
                onPointerDown={(
                  event: PointerEvent<HTMLDivElement>
                ) => event.stopPropagation()}
              >
                <div className="face-source-header">
                  <span>{t("Face Source Pool")}</span>
                  <div className="selection-btn" onClick={handleOpenFaceSourcePicker}>
                    {t("Add Face Sources")}
                  </div>
                </div>
                {selectedRegionIndex !== null && (
                  <div className="face-source-bind-row">
                    <span>
                      {t("Selected area")} #{selectedRegionIndex + 1}
                    </span>
                    <select
                      className="face-source-select"
                      value={regions[selectedRegionIndex]?.faceSourceId || ""}
                      onChange={(event) =>
                        handleAssignSelectedRegionFaceSource(event.target.value)
                      }
                    >
                      <option value="">{t("Select a face source")}</option>
                      {faceSources.map((source, index) => (
                        <option key={source.id} value={source.id}>
                          {source.locked
                            ? t("Default Face")
                            : `${t("Face Source")} ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="face-source-list">
                  {faceSources.map((source, index) => {
                    const selectedFaceSourceId =
                      selectedRegionIndex === null
                        ? ""
                        : regions[selectedRegionIndex]?.faceSourceId || "";
                    const isSelected = selectedFaceSourceId === source.id;
                    return (
                      <div
                        key={source.id}
                        className={`face-source-card ${isSelected ? "selected" : ""}`}
                        onClick={() => handleAssignSelectedRegionFaceSource(source.id)}
                      >
                        <img
                          src={source.src}
                          className="face-source-thumb"
                          draggable={false}
                        />
                        <div className="face-source-meta">
                          <span className="face-source-title">
                            {source.locked
                              ? t("Default Face")
                              : `${t("Face Source")} ${index + 1}`}
                          </span>
                          {!source.locked && (
                            <button
                              type="button"
                              className="face-source-remove"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveFaceSource(source.id);
                              }}
                            >
                              {t("Remove")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!faceSources.length && (
                  <div className="face-source-empty">
                    {t("No face sources yet. Add images to begin.")}
                  </div>
                )}
              </div>
            )}
            {isVideoInput && isSwapping && (
              <div className="video-progress-panel">
                <ProgressBar progress={videoProgress} width="360px" height="6px" />
                <div className="video-progress-meta">
                  <span>
                    {t("Video processing progress", {
                      progress: videoProgress.toFixed(1),
                    })}
                  </span>
                  <span>
                    {videoEtaSeconds !== null
                      ? t("Estimated remaining time", {
                        eta: formatEta(videoEtaSeconds),
                      })
                      : t("Estimating remaining time...")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
