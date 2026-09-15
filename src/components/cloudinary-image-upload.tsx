import { useRef, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCloudinaryConfig } from "@/hooks/use-cloudinary-config";
import { useStaffSession } from "@/hooks/use-staff-session";
import {
  saveImageUploadToRtdb,
  uploadToCloudinary,
  type CloudinaryOverrides,
  type CloudinaryUploadContext,
} from "@/lib/cloudinary";

type Props = {
  value: string;
  onChange: (url: string) => void;
  context: CloudinaryUploadContext;
  label?: string;
  disabled?: boolean;
  accept?: string;
  showUrlField?: boolean;
  previewAspect?: "video" | "square";
  className?: string;
  /** Prefer these over subscribed settings (e.g. unsaved Settings draft). */
  overrides?: CloudinaryOverrides;
};

export function CloudinaryImageUpload({
  value,
  onChange,
  context,
  label = "Image",
  disabled = false,
  accept = "image/png,image/jpeg,image/webp,image/gif",
  showUrlField = true,
  previewAspect = "video",
  className,
  overrides: overridesProp,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { overrides: settingsOverrides } = useCloudinaryConfig();
  const { session } = useStaffSession();
  const [uploading, setUploading] = useState(false);

  const overrides: CloudinaryOverrides = {
    cloudName: overridesProp?.cloudName || settingsOverrides.cloudName,
    uploadPreset: overridesProp?.uploadPreset || settingsOverrides.uploadPreset,
  };

  async function handleFile(file: File | null | undefined) {
    if (!file || disabled) return;
    setUploading(true);
    try {
      const url = await uploadToCloudinary(file, overrides);
      onChange(url);
      void saveImageUploadToRtdb(url, {
        context,
        userId: session?.userId ?? session?.email ?? null,
      });
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const aspectClass = previewAspect === "square" ? "aspect-square max-w-[160px]" : "aspect-[16/7]";

  return (
    <div className={className ? `space-y-3 ${className}` : "space-y-3"}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label>{label}</Label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              {uploading ? "Uploading…" : "Upload image"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || uploading}
                aria-label="Clear image"
                onClick={() => onChange("")}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Uploads to Cloudinary (unsigned preset). Only the HTTPS URL is stored.
          </p>
        </div>
      </div>

      {showUrlField ? (
        <div className="space-y-1.5">
          <Label htmlFor={`cloudinary-url-${context}`} className="text-xs text-muted-foreground">
            Image URL
          </Label>
          <Input
            id={`cloudinary-url-${context}`}
            type="url"
            value={value}
            disabled={disabled || uploading}
            placeholder="https://res.cloudinary.com/…"
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : null}

      {value ? (
        <div className="overflow-hidden rounded-xl border bg-muted/30 p-2">
          <div className={`overflow-hidden rounded-lg ${aspectClass}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <p className="mt-2 truncate px-1 text-[10px] text-muted-foreground">{value}</p>
        </div>
      ) : (
        <div
          className={`flex items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground ${aspectClass}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <ImagePlus className="size-3.5" /> No image yet
          </span>
        </div>
      )}
    </div>
  );
}
