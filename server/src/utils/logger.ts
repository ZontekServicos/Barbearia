import { isProduction } from "../config/env.js"

type LogLevel = "debug" | "info" | "warn" | "error"

/** Chaves que nunca podem aparecer em log, mesmo se alguém passar o objeto inteiro. */
const REDACTED_KEYS = new Set([
  "password",
  "currentpassword",
  "confirmpassword",
  "newpassword",
  "temporarypassword",
  "passwordhash",
  "password_hash",
  "token",
  "accesstoken",
  "refreshtoken",
  "tokenhash",
  "authorization",
  "cookie",
  "jwt_access_secret",
  "database_url",
  "bootstrap_admin_password",
])

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]"
  if (value === null || typeof value !== "object") return value

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? "[redacted]"
      : redact(entry, depth + 1)
  }
  return output
}

function write(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
) {
  if (level === "debug" && isProduction) return

  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  }

  const line = JSON.stringify(payload)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    write("error", message, context),
}
