/// <reference types="vite/client" />

/**
 * Public frontend configuration. Only non-secret values may live here —
 * provider and payment credentials belong to the FastAPI backend.
 */
interface ImportMetaEnv {
  /** Public base URL of the FastAPI booking backend, e.g. http://localhost:8000 */
  readonly VITE_BOOKING_API_URL?: string;
  /**
   * "true" forces the local test checkout adapter even when a backend URL is
   * set. Test-only switch — it carries no credentials of any kind.
   */
  readonly VITE_BOOKING_TEST_CHECKOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
