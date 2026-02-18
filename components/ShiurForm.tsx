"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import BulkLinkImporter from "./BulkLinkImporter";
import FileUploader from "./FileUploader";

interface Shiur {
  id?: string;
  guid?: string;
  slug?: string | null;
  title?: string;
  description?: string | null;
  blurb?: string | null;
  audioUrl?: string;
  sourceDoc?: string | null;
  sourcesJson?: string | null;
  pubDate?: string;
  duration?: string | null;
  link?: string | null;
  thumbnail?: string | null;
  platformLinks?: {
    youtube?: string | null;
    youtubeMusic?: string | null;
    spotify?: string | null;
    apple?: string | null;
    amazon?: string | null;
    pocket?: string | null;
    twentyFourSix?: string | null;
    castbox?: string | null;
  } | null;
}

interface ShiurFormProps {
  shiur?: Shiur | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ShiurForm({
  shiur,
  onSuccess,
  onCancel,
}: ShiurFormProps) {
  const [formData, setFormData] = useState({
    guid: shiur?.guid || "",
    slug:
      shiur?.slug ||
      (shiur?.id &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        shiur.id,
      )
        ? shiur.id
        : "") ||
      "",
    title: shiur?.title || "",
    description: shiur?.description || "",
    blurb: shiur?.blurb || "",
    audioUrl: shiur?.audioUrl || "",
    sourceDoc: shiur?.sourceDoc || "",
    sourcesJson: (shiur as any)?.sourcesJson || "",
    pubDate: shiur?.pubDate
      ? new Date(shiur.pubDate).toISOString().split("T")[0]
      : "",
    duration: shiur?.duration || "",
    link: shiur?.link || "",
    thumbnail: (shiur as any)?.thumbnail || "",
    status: (shiur as any)?.status || "published",
    videoUrl: "", // Temporary video URL for YouTube upload (not persisted)
    videoKey: "", // R2 key for uploaded video (not persisted)
    youtube: shiur?.platformLinks?.youtube || "",
    youtubeMusic: shiur?.platformLinks?.youtubeMusic || "",
    spotify: shiur?.platformLinks?.spotify || "",
    apple: shiur?.platformLinks?.apple || "",
    amazon: shiur?.platformLinks?.amazon || "",
    pocket: shiur?.platformLinks?.pocket || "",
    twentyFourSix: shiur?.platformLinks?.twentyFourSix || "",
    castbox: shiur?.platformLinks?.castbox || "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBulkImporter, setShowBulkImporter] = useState(false);

  const handleBulkImport = (links: Record<string, string>) => {
    setFormData((prev) => ({
      ...prev,
      youtube: links.youtube || prev.youtube,
      youtubeMusic: links.youtubeMusic || prev.youtubeMusic,
      spotify: links.spotify || prev.spotify,
      apple: links.apple || prev.apple,
      amazon: links.amazon || prev.amazon,
      pocket: links.pocket || prev.pocket,
      twentyFourSix: links.twentyFourSix || prev.twentyFourSix,
      castbox: links.castbox || prev.castbox,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!formData.audioUrl) {
      setError("Audio is required. Upload an audio file or enter an audio URL.");
      setLoading(false);
      return;
    }

    try {
      const payload = {
        guid: formData.guid || undefined,
        slug: formData.slug || undefined,
        title: formData.title,
        description: formData.description || undefined,
        blurb: formData.blurb || undefined,
        audioUrl: formData.audioUrl,
        sourceDoc: formData.sourceDoc || null,
        sourcesJson: formData.sourcesJson || null,
        pubDate: formData.pubDate || new Date().toISOString(),
        duration: formData.duration || undefined,
        link: formData.link || undefined,
        thumbnail: formData.thumbnail || undefined,
        status: formData.status,
        platformLinks: {
          youtube: formData.youtube || undefined,
          youtubeMusic: formData.youtubeMusic || undefined,
          spotify: formData.spotify || undefined,
          apple: formData.apple || undefined,
          amazon: formData.amazon || undefined,
          pocket: formData.pocket || undefined,
          twentyFourSix: formData.twentyFourSix || undefined,
          castbox: formData.castbox || undefined,
        },
      };

      const url = shiur?.id ? `/api/shiurim/${shiur.id}` : "/api/shiurim";
      const method = shiur?.id ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        error?: string;
        newId?: string;
        slug?: string;
      };

      if (!response.ok) {
        setError(data.error || "Error saving shiur");
        return;
      }

      // If the ID was changed to a slug, redirect to the new URL
      const finalId = data.newId || shiur?.id;
      const finalSlug = data.slug || formData.slug;

      if (finalId) {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            finalId,
          );
        let redirectPath = "";

        if (finalSlug && !isUuid) {
          // If there's a slug and the ID isn't a UUID (meaning ID is the slug)
          redirectPath = `/${finalSlug}`;
        } else if (finalSlug) {
          // If there's a slug and the ID is a UUID
          redirectPath = `/${finalSlug}`; // Assuming slug takes precedence for display URL
        } else {
          // No slug, use the ID
          redirectPath = `/shiur/${finalId}`;
        }
        window.location.href = `/admin?edit=${finalId}`; // Keep admin edit view for now
        // window.location.href = redirectPath; // This would redirect to the public view
        return;
      }

      onSuccess();
    } catch (error) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-6 text-primary">
        {shiur ? "Edit Shiur" : "Add New Shiur"}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Status Toggle */}
        <div className="flex items-center gap-4 pb-4 border-b">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-300">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, status: "draft" })}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                formData.status === "draft"
                  ? "bg-yellow-500 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              📝 Draft
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, status: "published" })}
              className={`px-4 py-2 text-sm font-medium border-x border-gray-300 transition-colors ${
                formData.status === "published"
                  ? "bg-green-500 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              ✅ Published
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, status: "scheduled" })}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                formData.status === "scheduled"
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              🕐 Scheduled
            </button>
          </div>
          {formData.status === "draft" && (
            <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
              Won't show on public site
            </span>
          )}
        </div>

        {/* Video Upload Status Banner */}
        {formData.videoUrl && (
          <div className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <span className="text-2xl">🎬</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-orange-800">
                Video uploaded and ready
              </p>
              <p className="text-xs text-orange-600">
                This video can be published to YouTube. Upload an audio file
                separately or enter an audio URL below.
              </p>
            </div>
            {!formData.audioUrl && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-medium">
                ⚠️ Audio file still needed
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  videoUrl: "",
                  videoKey: "",
                }))
              }
              className="text-xs text-orange-500 hover:text-red-600 underline"
            >
              Remove video
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              GUID *
            </label>
            <input
              type="text"
              value={formData.guid}
              onChange={(e) =>
                setFormData({ ...formData, guid: e.target.value })
              }
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom URL Slug
            </label>
            <div className="flex items-center">
              <span className="text-gray-500 text-sm mr-2">/</span>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    slug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-"),
                  })
                }
                placeholder="e.g., dreams"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Optional. Creates a short memorable URL like /dreams
            </p>
          </div>

          <div className="md:col-span-2">
            <FileUploader
              accept={["audio", "video"]}
              label="🎵 Upload Audio or Video File"
              helpText="Upload an audio file (.mp3, .m4a) or video file (.mp4, .mov). Video files will also be available for YouTube upload."
              slug={formData.slug || formData.title || "untitled"}
              value={formData.audioUrl}
              onUploadComplete={(url, metadata) => {
                if (metadata.category === "video") {
                  // Video uploaded — store the video URL separately for YouTube,
                  // but don't set audioUrl yet (will be extracted later)
                  setFormData((prev) => ({
                    ...prev,
                    videoUrl: url,
                    videoKey: metadata.key,
                  }));
                } else {
                  // Audio uploaded — set audioUrl directly
                  setFormData((prev) => ({ ...prev, audioUrl: url }));
                }
              }}
              onClear={() =>
                setFormData((prev) => ({
                  ...prev,
                  audioUrl: "",
                  videoUrl: "",
                  videoKey: "",
                }))
              }
            />
            {/* Fallback: manual Audio URL input */}
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                Or enter audio URL manually
              </summary>
              <input
                type="text"
                value={formData.audioUrl}
                onChange={(e) =>
                  setFormData({ ...formData, audioUrl: e.target.value })
                }
                placeholder="https://... or /api/media/..."
                className="mt-2 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
              />
            </details>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Publication Date *
            </label>
            <input
              type="date"
              value={formData.pubDate}
              onChange={(e) =>
                setFormData({ ...formData, pubDate: e.target.value })
              }
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Duration
            </label>
            <input
              type="text"
              value={formData.duration}
              onChange={(e) =>
                setFormData({ ...formData, duration: e.target.value })
              }
              placeholder="01:23:45"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Link
            </label>
            <input
              type="url"
              value={formData.link}
              onChange={(e) =>
                setFormData({ ...formData, link: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        {/* SOURCE DOCUMENTS SECTION */}
        <div className="border-t pt-6 mt-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            📄 Source Documents
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* PDF Source — Upload or URL */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <FileUploader
                accept="pdf"
                label="📎 Upload PDF Source Sheet"
                helpText="Upload a PDF source sheet, or enter a URL below."
                slug={formData.slug || formData.title || "untitled"}
                value={formData.sourceDoc}
                onUploadComplete={(url) => {
                  setFormData((prev) => ({ ...prev, sourceDoc: url }));
                }}
                onClear={() =>
                  setFormData((prev) => ({ ...prev, sourceDoc: "" }))
                }
              />
              {/* Fallback: manual PDF URL input */}
              <details className="mt-2">
                <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                  Or enter PDF URL manually
                </summary>
                <input
                  type="text"
                  value={formData.sourceDoc}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (
                      val.startsWith("sources:") ||
                      val.trim().startsWith("[")
                    ) {
                      alert(
                        "⚠️ It looks like you pasted Clipped Sources data here.\n\nPlease stick this in the 'Clipped Sources' section instead!",
                      );
                      return;
                    }
                    setFormData({ ...formData, sourceDoc: val });
                  }}
                  placeholder="https://drive.google.com/..."
                  className="mt-2 w-full px-4 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                />
              </details>
            </div>

            {/* Clipped Sources */}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <label className="block text-sm font-medium text-green-800 mb-2">
                ✂️ Clipped Sources
              </label>
              <div className="flex items-center gap-2">
                {formData.sourcesJson ? (
                  <>
                    <span className="flex-1 px-4 py-2 bg-green-100 border border-green-300 rounded-lg text-green-700 font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                      Contains Clipped Sources
                    </span>
                    <Link
                      href={`/admin/sources?shiurId=${shiur?.id || formData.slug}`}
                      className="px-3 py-2 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 text-sm font-medium transition-colors"
                      target="_blank"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            "Are you sure you want to delete the clipped source data?",
                          )
                        ) {
                          setFormData({ ...formData, sourcesJson: "" });
                        }
                      }}
                      className="px-3 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <span className="flex-1 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-400 italic">
                    No clipped sources data
                  </span>
                )}
              </div>
              <p className="text-xs text-green-600 mt-2">
                Use the "Source Clipper" tool to generate and attach sources
                here.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description (HTML)
          </label>
          <textarea
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Blurb (Plain Text)
          </label>
          <textarea
            value={formData.blurb}
            onChange={(e) =>
              setFormData({ ...formData, blurb: e.target.value })
            }
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        <div className="border-t pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Platform Links</h3>
            <button
              type="button"
              onClick={() => setShowBulkImporter(true)}
              className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors font-medium"
            >
              📋 Bulk Import
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                YouTube
              </label>
              <input
                type="url"
                value={formData.youtube}
                onChange={(e) =>
                  setFormData({ ...formData, youtube: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                YouTube Music
              </label>
              <input
                type="url"
                value={formData.youtubeMusic}
                onChange={(e) =>
                  setFormData({ ...formData, youtubeMusic: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Spotify
              </label>
              <input
                type="url"
                value={formData.spotify}
                onChange={(e) =>
                  setFormData({ ...formData, spotify: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Apple Podcasts
              </label>
              <input
                type="url"
                value={formData.apple}
                onChange={(e) =>
                  setFormData({ ...formData, apple: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amazon Music
              </label>
              <input
                type="url"
                value={formData.amazon}
                onChange={(e) =>
                  setFormData({ ...formData, amazon: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Pocket Casts
              </label>
              <input
                type="url"
                value={formData.pocket}
                onChange={(e) =>
                  setFormData({ ...formData, pocket: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                24Six
              </label>
              <input
                type="url"
                value={formData.twentyFourSix}
                onChange={(e) =>
                  setFormData({ ...formData, twentyFourSix: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Castbox
              </label>
              <input
                type="url"
                value={formData.castbox}
                onChange={(e) =>
                  setFormData({ ...formData, castbox: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4 pt-4 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Saving..." : shiur ? "Update" : "Create"}
          </button>
        </div>
      </form>

      {/* Bulk Link Importer Modal */}
      <BulkLinkImporter
        isOpen={showBulkImporter}
        onClose={() => setShowBulkImporter(false)}
        onApply={handleBulkImport}
      />
    </div>
  );
}
