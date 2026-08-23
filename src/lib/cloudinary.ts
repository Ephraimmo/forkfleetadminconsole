// Unsigned browser uploads to Cloudinary.
// Never put API Key / API Secret in VITE_* or the admin UI — they would ship to the browser.

import { isFirebaseAvailable, rtdbPush } from "@/lib/firebase";

export type CloudinaryUploadContext = "product" | "category" | "restaurant_cover" | "settings_logo";

export type CloudinaryOverrides = {
  cloudName?: string | null | undefined;
  uploadPreset?: string | null | undefined;
};

function trim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Resolve cloud name + unsigned preset (settings → env → ml_default). */
export function resolveCloudinaryOptions(overrides: CloudinaryOverrides = {}): {
  cloudName: string;
  uploadPreset: string;
} {
  const cloudName =
    trim(overrides.cloudName) || trim(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined);
  const uploadPreset =
    trim(overrides.uploadPreset) ||
    trim(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined) ||
    "ml_default";

  if (!cloudName) {
    throw new Error(
      "Cloudinary cloud name is missing. Set it under Settings → Media (Cloudinary), or set VITE_CLOUDINARY_CLOUD_NAME in .env for local development.",
    );
  }

  return { cloudName, uploadPreset };
}

/**
 * Upload an image via unsigned preset. Returns the HTTPS `secure_url` only.
 * Does not send API secret.
 */
export async function uploadToCloudinary(
  file: File,
  overrides: CloudinaryOverrides = {},
): Promise<string> {
  const { cloudName, uploadPreset } = resolveCloudinaryOptions(overrides);

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body,
  });

  const data = (await response.json().catch(() => null)) as {
    secure_url?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const message = data?.error?.message || `Cloudinary upload failed (${response.status})`;
    throw new Error(message);
  }

  const url = typeof data?.secure_url === "string" ? data.secure_url.trim() : "";
  if (!url) {
    throw new Error("Cloudinary response did not include a secure_url.");
  }

  return url;
}

/** Optional audit trail — metadata only, never the binary. Failures are non-fatal. */
export async function saveImageUploadToRtdb(
  url: string,
  meta: {
    context: CloudinaryUploadContext;
    userId?: string | null | undefined;
  },
): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    await rtdbPush("uploads/images", {
      url,
      createdAt: new Date().toISOString(),
      context: meta.context,
      userId: meta.userId ?? null,
    });
  } catch (err) {
    console.error("[cloudinary] failed to write upload audit", err);
  }
}
