import { createHash, randomBytes } from "node:crypto"
export const generatePublicToken = () => randomBytes(32).toString("base64url")
/** The database stores a digest, never the bearer credential. */
export const digestPublicToken = (token: string) => createHash("sha256").update(token).digest("hex")
