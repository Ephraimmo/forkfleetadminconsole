/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_PROJECT_ID?: string;
  /** Optional Cloudinary cloud name fallback (local/dev). Never put API Key/Secret here. */
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
  /** Optional unsigned upload preset fallback (local/dev). Never put API Key/Secret here. */
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
