import { useEffect, useMemo, useState } from "react";
import {
  fetchSettingsOnce,
  subscribeSettings,
  type MediaSettings,
} from "@/lib/settings.firebase";

/** Live Cloudinary config from platform settings (with env fallback at upload time). */
export function useCloudinaryConfig() {
  const [media, setMedia] = useState<MediaSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void fetchSettingsOnce().then((settings) => {
      if (!alive) return;
      setMedia(settings.media);
      setLoading(false);
    });
    const unsub = subscribeSettings((settings) => {
      if (!alive) return;
      setMedia(settings.media);
      setLoading(false);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return useMemo(
    () => ({
      loading,
      cloudName: media?.cloudinary_cloud_name ?? "",
      uploadPreset: media?.cloudinary_upload_preset ?? "",
      overrides: {
        cloudName: media?.cloudinary_cloud_name || undefined,
        uploadPreset: media?.cloudinary_upload_preset || undefined,
      },
    }),
    [loading, media],
  );
}
