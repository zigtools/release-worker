export interface Env {
  API_TOKEN: string;
  R2_PUBLIC_URL: string;
  ZIGTOOLS_BUILDS: R2Bucket;
  ZIGTOOLS_DB: D1Database;
  FORCE_MINISIGN?: string;
}
