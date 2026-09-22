import { useCloudinaryConfig } from "@/hooks/use-cloudinary-config";

/**
 * Composes a restaurant's own Cloudinary account (if it has one) ahead of the
 * platform-wide default, without duplicating resolveCloudinaryOptions()'s own
 * env/"ml_default" fallback — that still runs inside uploadToCloudinary().
 */
export function useRestaurantCloudinaryConfig(
  restaurant?: {
    cloudinaryCloudName?: string | null;
    cloudinaryUploadPreset?: string | null;
  } | null,
) {
  const platform = useCloudinaryConfig();
  const ownCloudName = (restaurant?.cloudinaryCloudName ?? "").trim();
  const ownUploadPreset = (restaurant?.cloudinaryUploadPreset ?? "").trim();

  return {
    loading: platform.loading,
    usingOwnAccount: Boolean(ownCloudName),
    overrides: {
      cloudName: ownCloudName || platform.overrides.cloudName,
      uploadPreset: ownUploadPreset || platform.overrides.uploadPreset,
    },
  };
}
