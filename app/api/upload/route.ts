import { NextRequest, NextResponse } from "next/server";
import { getD1Database, getDb, getR2Bucket } from "@/lib/db";
import { users } from "@/lib/schema";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

const MAX_AUDIO_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/ogg",
];

const ALLOWED_PDF_TYPES = ["application/pdf"];

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/x-matroska",
];

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

async function isAuthenticated(d1: D1Database) {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin-session");
  if (!session) return false;

  const db = getDb(d1);
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.value))
    .get();

  return !!user;
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getFileCategory(mimeType: string): "audio" | "pdf" | "video" | "image" | null {
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return "audio";
  if (ALLOWED_PDF_TYPES.includes(mimeType)) return "pdf";
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return "video";
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return "image";
  return null;
}

function getMaxSize(category: "audio" | "pdf" | "video" | "image"): number {
  switch (category) {
    case "audio":
      return MAX_AUDIO_SIZE;
    case "pdf":
      return MAX_PDF_SIZE;
    case "video":
      return MAX_VIDEO_SIZE;
    case "image":
      return MAX_IMAGE_SIZE;
  }
}

function getR2Folder(category: "audio" | "pdf" | "video" | "image"): string {
  switch (category) {
    case "audio":
      return "audio";
    case "pdf":
      return "pdfs";
    case "video":
      return "video";
    case "image":
      return "images";
  }
}

export async function POST(request: NextRequest) {
  try {
    const d1 = await getD1Database();
    if (!d1) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    if (!(await isAuthenticated(d1))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bucket = await getR2Bucket();
    if (!bucket) {
      return NextResponse.json(
        { error: "Storage bucket not configured" },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const slug = (formData.get("slug") as string) || "untitled";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const mimeType = file.type;
    const category = getFileCategory(mimeType);

    if (!category) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${mimeType}. Allowed: audio (mp3, m4a, wav, aac, ogg), PDF, video (mp4, mov, webm, avi, mkv), image (png, jpg, webp)`,
        },
        { status: 400 },
      );
    }

    const maxSize = getMaxSize(category);
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File too large. Maximum size for ${category}: ${maxMB}MB` },
        { status: 400 },
      );
    }

    // Build the R2 object key
    const timestamp = Date.now();
    const ext =
      file.name.split(".").pop() ||
      (category === "pdf" ? "pdf" : category === "video" ? "mp4" : "mp3");
    const sanitized = sanitizeFilename(slug);
    const folder = getR2Folder(category);
    const key = `${folder}/${sanitized}-${timestamp}.${ext}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await bucket.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        slug: slug,
      },
    });

    // Build a relative URL using the /api/media proxy route
    // Relative URLs automatically resolve to the correct host/protocol
    // in both local dev (http://localhost:8787) and production
    const publicUrl = `/api/media/${key}`;

    return NextResponse.json({
      success: true,
      url: publicUrl,
      key,
      category,
      filename: file.name,
      size: file.size,
      mimeType,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * DELETE endpoint to remove a file from R2
 */
export async function DELETE(request: NextRequest) {
  try {
    const d1 = await getD1Database();
    if (!d1) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    if (!(await isAuthenticated(d1))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bucket = await getR2Bucket();
    if (!bucket) {
      return NextResponse.json(
        { error: "Storage bucket not configured" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as { key?: string };
    const { key } = body;

    if (!key) {
      return NextResponse.json(
        { error: "No file key provided" },
        { status: 400 },
      );
    }

    // Prevent directory traversal
    if (key.includes("..") || key.startsWith("/")) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    await bucket.delete(key);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
