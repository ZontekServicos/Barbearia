export const PASSWORD_MIN_LENGTH = 15
export const PASSWORD_MAX_LENGTH = 128
export const passwordLength = (value: string) => Array.from(value.normalize("NFKC")).length
export const passwordsMatch = (a: string, b: string) => a.normalize("NFKC") === b.normalize("NFKC")

/** Only in operator memory; the API receives it and never returns a password. */
export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}
