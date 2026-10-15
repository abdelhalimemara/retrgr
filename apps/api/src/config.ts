const env = process.env

export const config = {
  port: Number(env.PORT ?? 8080),
  isProduction: env.NODE_ENV === 'production',
  // On Cloud Run, DB_HOST is the Cloud SQL unix socket dir: /cloudsql/PROJECT:me-central2:INSTANCE
  db: {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME ?? 'retrgtr',
    user: env.DB_USER ?? 'retrgtr',
    password: env.DB_PASSWORD ?? '',
  },
  // Dashboard origin(s) allowed to call admin endpoints.
  adminOrigins: (env.ADMIN_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  // Comma-separated allowlist of dashboard users. Empty = any authenticated Firebase user.
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  firebaseProjectId: env.FIREBASE_PROJECT_ID,
  // Local development only; refused in production.
  authDevBypass: env.AUTH_DEV_BYPASS === 'true' && env.NODE_ENV !== 'production',
  defaultCountry: (env.DEFAULT_COUNTRY ?? 'SA') as 'SA',
  // Shared secret the sGTM Retrgtr Client sends; lets the API trust the client IP it forwards.
  sgtmSecret: env.SGTM_SHARED_SECRET ?? '',
  // BigQuery event store. Unset = events are not streamed (local dev).
  bigquery: {
    projectId: env.BQ_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT,
    dataset: env.BQ_DATASET ?? '',
  },
}
