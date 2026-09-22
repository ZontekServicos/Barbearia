import type { UserRole, UserStatus } from '../generated/prisma/enums.js'

declare global {
  namespace Express {
    interface Request {
      /** Preenchido por requireAuth — a fonte de verdade vem do banco, nunca do cliente. */
      user?: {
        id: string
        role: UserRole
        status: UserStatus
        phone: string
        fullName: string | null
      }
      /** Query já validada (req.query é somente leitura no Express 5). */
      validatedQuery?: unknown
    }
  }
}

export {}
