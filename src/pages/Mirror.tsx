import { useDragDrop } from "@/hooks/useDragDrop";
import { useSwapFace } from "@/hooks/useSwapFace";
import { type Region } from "@/services/server";
import { getFileExtension, isImageFile, isVideoFile } from "@/services/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
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

type ResizeHandle = "nw" | "ne" | "sw" | "se";

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

  const { isSwapping, swapFace, swapVideo, error: swapError } = useSwapFace();
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
    if (!input || input.type !== "image") {
      setInputSize(null);
      setRegions([]);
      setDraftRegion(null);
      setIsEditingRegions(false);
      setSelectedRegionIndex(null);
      selectingRef.current = false;
      startPointRef.current = null;
      resizeRef.current = null;
      inputPathRef.current = null;
      return;
    }
    if (inputPathRef.current !== input.path) {
      inputPathRef.current = input.path;
      setRegions([]);
      setDraftRegion(null);
      setIsEditingRegions(true);
      setSelectedRegionIndex(null);
      setInputSize(null);
      selectingRef.current = false;
      startPointRef.current = null;
      resizeRef.current = null;
      const img = new Image();
      img.onload = () => {
        setInputSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = convertFileSrc(input.path);
    }
  }, [kMirrorStates.input?.path, kMirrorStates.input?.type]);

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));

  const isImageInput = kMirrorStates.input?.type === "image";
  const canSelect =
    !kMirrorStates.isMe &&
    isImageInput &&
    isEditingRegions &&
    !isSwapping &&
    !!inputSize;
  const showSelection =
    isImageInput && isEditingRegions && !kMirrorStates.isMe && !!inputSize;
  const showToolbar = showSelection && !isSwapping;

  const toImageRegions = useCallback(() => {
    if (!previewRef.current || !inputSize) {
      return [];
    }
    const rect = previewRef.current.getBoundingClientRect();
    const scale = Math.max(
      rect.width / inputSize.width,
      rect.height / inputSize.height
    );
    const displayWidth = inputSize.width * scale;
    const displayHeight = inputSize.height * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;

    return regions
      .map((region: Region) => {
        const x = Math.round((region.x - offsetX) / scale);
        const y = Math.round((region.y - offsetY) / scale);
        const width = Math.round(region.width / scale);
        const height = Math.round(region.height / scale);
        const clampedX = clamp(x, 0, inputSize.width - 1);
        const clampedY = clamp(y, 0, inputSize.height - 1);
        const clampedWidth = clamp(width, 1, inputSize.width - clampedX);
        const clampedHeight = clamp(height, 1, inputSize.height - clampedY);
        return {
          x: clampedX,
          y: clampedY,
          width: clampedWidth,
          height: clampedHeight,
        };
      })
      .filter((region: Region) => region.width > 1 && region.height > 1);
  }, [regions, inputSize]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canSelect || !previewRef.current) {
        return;
      }
      const rect = previewRef.current.getBoundingClientRect();
      const startX = clamp(event.clientX - rect.left, 0, rect.width);
      const startY = clamp(event.clientY - rect.top, 0, rect.height);
      resizeRef.current = null;
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

  const finishSelection = useCallback(() => {
    if (resizeRef.current) {
      resizeRef.current = null;
      return;
    }
    if (!selectingRef.current) {
      return;
    }
    selectingRef.current = false;
    if (draftRegion && draftRegion.width > 4 && draftRegion.height > 4) {
      setRegions((prev: Region[]) => [...prev, draftRegion]);
      setSelectedRegionIndex(regions.length);
    }
    setDraftRegion(null);
    startPointRef.current = null;
  }, [draftRegion, regions.length]);

  const handleSelectRegion = useCallback(
    (index: number) => (event: PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      setSelectedRegionIndex(index);
    },
    []
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

  const handleStartSwap = useCallback(async () => {
    if (!kMirrorStates.me || !kMirrorStates.input || !isImageInput) {
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
    setNotice(null);
    kMirrorStates.result = undefined;
    rebuild.current();
    setIsEditingRegions(false);
    setSelectedRegionIndex(null);
    setDraftRegion(null);
    selectingRef.current = false;
    startPointRef.current = null;
    resizeRef.current = null;
    const result = await swapFace(
      kMirrorStates.input.path,
      kMirrorStates.me.path,
      imageRegions
    );
    setSuccess(result != null);
    if (result) {
      kMirrorStates.result = {
        src: convertFileSrc(result),
        path: result,
        type: "image",
      };
    } else {
      setIsEditingRegions(true);
    }
    rebuild.current();
  }, [isImageInput, regions, swapFace, t, toImageRegions]);

  const { ref } = useDragDrop(async (paths) => {
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
      const isVideoTask = kMirrorStates.input.type === "video";
      if (isVideoTask) {
        setIsEditingRegions(false);
        const result = await swapVideo(
          kMirrorStates.input.path,
          kMirrorStates.me.path
        );
        setSuccess(result != null);
        if (result) {
          kMirrorStates.result = {
            src: convertFileSrc(result),
            path: result,
            type: "video",
          };
          rebuild.current();
        }
      } else {
        setIsEditingRegions(true);
      }
    }
  });

  const isReady = kMirrorStates.me && kMirrorStates.input;
  const isVideoInput = kMirrorStates.input?.type === "video";
  const hasRegions = regions.length > 0;
  const selectionTips =
    isImageInput &&
      isReady &&
      !isSwapping &&
      !kMirrorStates.isMe &&
      isEditingRegions
      ? hasRegions
        ? t("Click Start to swap selected areas.")
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
    };
    return errorMap[error] || null;
  };

  const swapErrorMessage = getSwapErrorMessage(swapError);

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
    <div className="w-100vw h-100vh p-40px">
      <div ref={ref} data-tauri-drag-region className="relative w-full h-full">
        <div className="absolute top-[-40px] w-full flex-c-c c-white z-10">
          <p className="bg-black p-[4px_8px]">{tips}</p>
        </div>
        <div className="absolute top-50px right-50px z-10">
          <div className="relative dropdown">
            <img
              data-tauri-drag-region
              src={iconMenu}
              className="h-70px cursor-pointer pb-10px"
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
                <div onClick={() => open(t("aboutLink"))}>{t("About")}</div>
                <div onClick={() => exit(0)}>{t("Quit")}</div>
              </div>
            </div>
          </div>
        </div>
        <img
          data-tauri-drag-region
          src={kMirrorStates.isMe ? mirrorMe : mirrorInput}
          className="absolute w-full h-full object-cover z-3"
          style={{
            maskImage:
              "radial-gradient(circle, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 1) 40%)",
            WebkitMaskImage:
              "radial-gradient(circle, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 1) 40%)",
          }}
        />
        <div
          className="w-full h-full flex-c-c"
          style={{
            padding: kMirrorStates.isMe ? "120px" : "100px",
          }}
        >
          <div className="mirror-preview">
            <div
              ref={previewRef}
              className={`preview-container ${showSelection ? "selection-active" : ""}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishSelection}
              onPointerLeave={finishSelection}
            >
              {previewType === "video" ? (
                <video
                  data-tauri-drag-region
                  src={previewSrc}
                  className="rd-50% w-full h-full object-cover bg-black"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  data-tauri-drag-region
                  src={previewSrc}
                  className="rd-50% w-full h-full object-cover bg-black"
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
              {showToolbar && (
                <div
                  className="selection-toolbar"
                  onPointerDown={(
                    event: PointerEvent<HTMLDivElement>
                  ) => event.stopPropagation()}
                >
                  <div
                    className={`selection-btn ${regions.length ? "" : "disabled"}`}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
