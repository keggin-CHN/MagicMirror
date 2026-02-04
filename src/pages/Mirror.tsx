import { useDragDrop } from "@/hooks/useDragDrop";
import { useSwapFace } from "@/hooks/useSwapFace";
import { isImageFile, isVideoFile } from "@/services/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";
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

  const { isSwapping, swapFace, swapVideo } = useSwapFace();
  const [success, setSuccess] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

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

  const { ref } = useDragDrop(async (paths) => {
    const path = paths[0];
    const src = convertFileSrc(path);
    const isVideo = isVideoFile(path);
    const isImage = isImageFile(path);

    if (kMirrorStates.isMe) {
      if (!isImage) {
        setNotice(t("Please use an image for your face photo."));
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
        setNotice(t("Unsupported file type."));
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
      const result = isVideoTask
        ? await swapVideo(kMirrorStates.input.path, kMirrorStates.me.path)
        : await swapFace(kMirrorStates.input.path, kMirrorStates.me.path);
      setSuccess(result != null);
      if (result) {
        kMirrorStates.result = {
          src: convertFileSrc(result),
          path: result,
          type: isVideoTask ? "video" : "image",
        };
        rebuild.current();
      }
    }
  });

  const isReady = kMirrorStates.me && kMirrorStates.input;
  const isVideoInput = kMirrorStates.input?.type === "video";
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
          : success
            ? isVideoInput
              ? t("Face swap successful! Video saved locally.")
              : t("Face swap successful! Image saved locally.")
            : isVideoInput
              ? t("Video face swap failed. Try a different video.")
              : t("Face swap failed. Try a different image.");

  const previewSrc = kMirrorStates.isMe
    ? kMirrorStates.me?.src || background
    : kMirrorStates.result?.src || kMirrorStates.input?.src || background;

  const previewType = kMirrorStates.isMe
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
            <div className="preview-container">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
