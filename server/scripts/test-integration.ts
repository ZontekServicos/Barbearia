import { spawnSync } from "node:child_process"
const value = process.env.TEST_DATABASE_URL
if (!value)
  throw new Error(
    "Defina TEST_DATABASE_URL para o PostgreSQL local descartável erickcorttes_test.",
  )
const url = new URL(value)
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/erickcorttes_test"
)
  throw new Error("Banco de teste recusado: use localhost/erickcorttes_test.")
process.env.DATABASE_URL = value
// Paths and args are passed directly, without shell interpolation.
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["node_modules/tsx/dist/cli.mjs", "--test", "src/config/password-migration.integration.test.ts"],
  [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "src/config/auth.integration.test.ts",
  ],
  [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "src/config/booking.integration.test.ts",
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
