"use client";

import { useState, useRef, useCallback, useId } from "react";
import {
  Upload,
  X,
  FileAudio,
  FileText,
  Film,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

export type FileCategory = "audio" | "pdf" | "video";

interface FileUploaderProps {
  /** Which file types to accept */
  accept: FileCategory | FileCategory[];
  /** Called with the public URL after successful upload */
  onUploadComplete: (url: string, metadata: UploadMetadata) => void;
  /** Called if upload fails */
  onUploadError?: (error: string) => void;
  /** Optional slug used in the R2 key */
  slug?: string;
  /** Label shown above the dropzone */
  label?: string;
  /** Help text shown below the dropzone */
  helpText?: string;
  /** Current value (existing URL) */
  value?: string;
  /** Allow clearing the current value */
  onClear?: () => void;
  /** Disable the uploader */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
}

export interface UploadMetadata {
  key: string;
  category: FileCategory;
  filename: string;
  size: number;
  mimeType: string;
}

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

const ACCEPT_MAP: Record<FileCategory, string[]> = {
  audio: [".mp3", ".m4a", ".aac", ".wav", ".ogg"],
  pdf: [".pdf"],
  video: [".mp4", ".mov", ".webm", ".avi", ".mkv"],
};

const MIME_MAP: Record<FileCategory, string[]> = {
  audio: [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/ogg",
  ],
  pdf: ["application/pdf"],
  video: [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-msvideo",
    "video/x-matroska",
  ],
};

const ICON_MAP: Record<FileCategory, typeof FileAudio> = {
  audio: FileAudio,
  pdf: FileText,
  video: Film,
};

const COLOR_MAP: Record<
  FileCategory,
  { bg: string; border: string; text: string; accent: string }
> = {
  audio: {
    bg: "bg-purple-50",
    border: "border-purple-300",
    text: "text-purple-700",
    accent: "text-purple-500",
  },
  pdf: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    text: "text-blue-700",
    accent: "text-blue-500",
  },
  video: {
    bg: "bg-orange-50",
    border: "border-orange-300",
    text: "text-orange-700",
    accent: "text-orange-500",
  },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getCategoryForFile(
  file: File,
  acceptedCategories: FileCategory[],
): FileCategory | null {
  for (const cat of acceptedCategories) {
    if (MIME_MAP[cat].includes(file.type)) return cat;
    // Fallback: check extension
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (ACCEPT_MAP[cat].includes(ext)) return cat;
  }
  return null;
}

export default function FileUploader({
  accept,
  onUploadComplete,
  onUploadError,
  slug = "untitled",
  label,
  helpText,
  value,
  onClear,
  disabled = false,
  className = "",
}: FileUploaderProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate a unique ID so the <label htmlFor> can target the hidden <input>
  const reactId = useId();
  const inputId = `file-upload-${reactId.replace(/:/g, "")}`;

  const categories = Array.isArray(accept) ? accept : [accept];
  const primaryCategory = categories[0];
  const colors = COLOR_MAP[primaryCategory];
  const PrimaryIcon = ICON_MAP[primaryCategory];

  const acceptString = categories.flatMap((c) => ACCEPT_MAP[c]).join(",");

  const handleFile = useCallback(
    async (file: File) => {
      const category = getCategoryForFile(file, categories);
      if (!category) {
        const allowedExts = categories.flatMap((c) => ACCEPT_MAP[c]).join(", ");
        const msg = `Unsupported file type. Allowed: ${allowedExts}`;
        setError(msg);
        setState("error");
        onUploadError?.(msg);
        return;
      }

      setFileName(file.name);
      setFileSize(file.size);
      setError(null);
      setState("uploading");
      setProgress(0);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("slug", slug);

        // Use XMLHttpRequest for progress tracking
        const result = await new Promise<{
          url: string;
          key: string;
          category: FileCategory;
          filename: string;
          size: number;
          mimeType: string;
        }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setProgress(pct);
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                if (data.error) {
                  reject(new Error(data.error));
                } else {
                  resolve(data);
                }
              } catch {
                reject(new Error("Invalid response from server"));
              }
            } else {
              try {
                const data = JSON.parse(xhr.responseText);
                reject(
                  new Error(data.error || `Upload failed (${xhr.status})`),
                );
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`));
              }
            }
          });

          xhr.addEventListener("error", () =>
            reject(new Error("Network error during upload")),
          );
          xhr.addEventListener("abort", () =>
            reject(new Error("Upload cancelled")),
          );

          xhr.open("POST", "/api/upload");
          xhr.send(formData);
        });

        setState("success");
        setProgress(100);
        onUploadComplete(result.url, {
          key: result.key,
          category: result.category,
          filename: result.filename,
          size: result.size,
          mimeType: result.mimeType,
        });

        // Reset to idle after a brief success display
        setTimeout(() => {
          setState("idle");
        }, 2000);
      } catch (err: any) {
        const msg = err.message || "Upload failed";
        setError(msg);
        setState("error");
        onUploadError?.(msg);
      }
    },
    [categories, slug, onUploadComplete, onUploadError],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setState("idle");

      if (disabled) return;

      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && state !== "uploading") {
        setState("dragging");
      }
    },
    [disabled, state],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (state === "dragging") {
        setState("idle");
      }
    },
    [state],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  // If there's an existing value, show it as a compact display
  if (value && state === "idle") {
    const displayName = fileName || value.split("/").pop() || "Uploaded file";
    return (
      <div className={`${className}`}>
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {label}
          </label>
        )}
        <div
          className={`flex items-center gap-3 p-3 rounded-lg border ${colors.bg} ${colors.border}`}
        >
          <PrimaryIcon className={`w-5 h-5 ${colors.accent} flex-shrink-0`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${colors.text} truncate`}>
              {displayName}
            </p>
            {fileSize > 0 && (
              <p className="text-xs text-gray-500">
                {formatFileSize(fileSize)}
              </p>
            )}
            <p className="text-xs text-gray-400 truncate">{value}</p>
          </div>
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFileName(null);
                setFileSize(0);
                onClear();
              }}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Use a native <label> to re-upload — always works, no JS click needed */}
        <label
          htmlFor={inputId}
          className="mt-2 inline-block text-xs text-gray-500 hover:text-gray-700 underline cursor-pointer"
        >
          Replace file
        </label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={acceptString}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}

      {/*
        The entire dropzone is a <label> pointing at the hidden file input.
        This means clicking anywhere on it natively opens the file dialog —
        no programmatic .click() needed, which is more reliable across environments.
      */}
      <label
        htmlFor={disabled || state === "uploading" ? undefined : inputId}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative block border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200
          ${disabled ? "opacity-50 cursor-not-allowed" : state === "uploading" ? "cursor-wait" : "cursor-pointer"}
          ${state === "dragging" ? `${colors.bg} ${colors.border} scale-[1.02]` : ""}
          ${state === "uploading" ? "border-gray-300 bg-gray-50" : ""}
          ${state === "success" ? "border-green-300 bg-green-50" : ""}
          ${state === "error" ? "border-red-300 bg-red-50" : ""}
          ${state === "idle" ? "border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50" : ""}
        `}
      >
        {/* Hidden file input — targeted by the label's htmlFor */}
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={acceptString}
          onChange={handleInputChange}
          className="sr-only"
          disabled={disabled}
          tabIndex={-1}
        />

        {/* Idle / Dragging */}
        {(state === "idle" || state === "dragging") && (
          <div className="space-y-2">
            <div
              className={`mx-auto w-12 h-12 rounded-full ${colors.bg} flex items-center justify-center`}
            >
              {categories.length > 1 ? (
                <Upload className={`w-6 h-6 ${colors.accent}`} />
              ) : (
                <PrimaryIcon className={`w-6 h-6 ${colors.accent}`} />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {state === "dragging" ? (
                  <span className={colors.text}>Drop file here</span>
                ) : (
                  <>
                    <span className={`${colors.text} font-semibold`}>
                      Click to upload
                    </span>{" "}
                    or drag and drop
                  </>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {categories.map((c) => ACCEPT_MAP[c].join(", ")).join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Uploading */}
        {state === "uploading" && (
          <div className="space-y-3">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto" />
            <div>
              <p className="text-sm font-medium text-gray-700">
                Uploading {fileName || "file"}...
              </p>
              <p className="text-xs text-gray-500">
                {formatFileSize(fileSize)}
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-blue-500 to-purple-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{progress}%</p>
          </div>
        )}

        {/* Success */}
        {state === "success" && (
          <div className="space-y-2">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
            <p className="text-sm font-medium text-green-700">
              Upload complete!
            </p>
            <p className="text-xs text-gray-500">{fileName}</p>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="space-y-2">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
            <p className="text-sm font-medium text-red-700">Upload failed</p>
            <p className="text-xs text-red-600">{error}</p>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setError(null);
                setState("idle");
              }}
              className="text-xs text-red-500 underline hover:text-red-700"
            >
              Try again
            </button>
          </div>
        )}
      </label>

      {helpText && state !== "error" && (
        <p className="text-xs text-gray-500 mt-2">{helpText}</p>
      )}
    </div>
  );
}
