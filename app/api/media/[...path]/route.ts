import { NextRequest, NextResponse } from "next/server";
import { getR2Bucket } from "@/lib/db";

/**
 * Serve files from R2 bucket via a proxy route.
 * Handles paths like /api/media/audio/my-file.mp3 or /api/media/pdfs/source.pdf
 *
 * Uses R2's native range support to avoid reading entire files into memory,
 * which is critical for large video files (up to 2GB).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const key = path.join("/");

    if (!key) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    // Prevent directory traversal
    if (key.includes("..") || key.startsWith("/")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const bucket = await getR2Bucket();
    if (!bucket) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 500 },
      );
    }

    const headers = new Headers();

    // Allow CORS for media playback from other origins
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Range");
    headers.set("Accept-Ranges", "bytes");
    // Cache for 1 year (files are immutable due to timestamp in key)
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    // Support range requests for audio/video streaming using R2's native range support
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (matches) {
        // First do a HEAD to get the total size
        const headObject = await bucket.head(key);
        if (!headObject) {
          return NextResponse.json(
            { error: "File not found" },
            { status: 404 },
          );
        }

        const totalSize = headObject.size;
        const start = parseInt(matches[1], 10);
        const end = matches[2]
          ? parseInt(matches[2], 10)
          : totalSize - 1;

        if (start >= totalSize) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${totalSize}`,
            },
          });
        }

        const clampedEnd = Math.min(end, totalSize - 1);
        const contentLength = clampedEnd - start + 1;

        // Use R2's native range option — only fetches the requested bytes
        const rangeObject = await bucket.get(key, {
          range: { offset: start, length: contentLength },
        });

        if (!rangeObject) {
          return NextResponse.json(
            { error: "File not found" },
            { status: 404 },
          );
        }

        const contentType =
          rangeObject.httpMetadata?.contentType || inferContentType(key);
        headers.set("Content-Type", contentType);
        headers.set(
          "Content-Range",
          `bytes ${start}-${clampedEnd}/${totalSize}`,
        );
        headers.set("Content-Length", String(contentLength));

        return new NextResponse(rangeObject.body as ReadableStream, {
          status: 206,
          headers,
        });
      }
    }

    // Full response — stream directly from R2
    const object = await bucket.get(key);

    if (!object) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const contentType =
      object.httpMetadata?.contentType || inferContentType(key);
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(object.size));

    return new NextResponse(object.body as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Media serve error:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 },
    );
  }
}

/**
 * Handle HEAD requests for content info without downloading
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const key = path.join("/");

    if (!key || key.includes("..") || key.startsWith("/")) {
      return new NextResponse(null, { status: 400 });
    }

    const bucket = await getR2Bucket();
    if (!bucket) {
      return new NextResponse(null, { status: 500 });
    }

    const object = await bucket.head(key);

    if (!object) {
      return new NextResponse(null, { status: 404 });
    }

    const headers = new Headers();
    const contentType =
      object.httpMetadata?.contentType || inferContentType(key);
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(object.size));
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(null, { status: 200, headers });
  } catch (error) {
    console.error("Media HEAD error:", error);
    return new NextResponse(null, { status: 500 });
  }
}

/**
 * Handle CORS preflight for media requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function inferContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    pdf: "application/pdf",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return types[ext || ""] || "application/octet-stream";
}
