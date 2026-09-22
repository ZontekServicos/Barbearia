/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base do backend. Ex.: http://localhost:3333 */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
