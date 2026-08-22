/// <reference types="vite/client" />

/**
 * Public frontend configuration. Only non-secret values may live here —
 * provider and payment credentials belong to the FastAPI backend.
 */
interface ImportMetaEnv {
  /** Public base URL of the FastAPI booking backend, e.g. http://localhost:8000 */
  readonly VITE_BOOKING_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
