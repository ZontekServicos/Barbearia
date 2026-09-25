export function isOverlapViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { code?: string; meta?: { constraint?: unknown }; message?: string }
  if (["23P01", "40P01", "P2034"].includes(candidate.code ?? "")) return true
  const wrapped = error as { meta?: { code?: string; driverAdapterError?: { cause?: unknown } }; cause?: unknown }
  if (["23P01", "40P01"].includes(wrapped.meta?.code ?? "")) return true
  if (wrapped.cause && wrapped.cause !== error && isOverlapViolation(wrapped.cause)) return true
  const constraint = candidate.meta?.constraint
  if (typeof constraint === "string" && constraint.includes("appointments_no_overlap")) return true
  return (
    typeof candidate.message === "string" &&
    (candidate.message.includes("appointments_no_overlap") ||
      candidate.message.includes("deadlock detected"))
  )
}
