import type { UserRole, UserStatus } from '../../generated/prisma/enums.js'
import { formatPhoneForDisplay } from '../../utils/phone.js'

/** Formato público do usuário — o único que sai da API. */
export interface PublicUser {
  id: string
  fullName: string | null
  phone: string
  phoneFormatted: string
  role: UserRole
  status: UserStatus
  /** Conta herdada do fluxo OTP ainda sem credencial fica `false`. */
  hasPassword: boolean
  createdAt: string
}

interface UserRecord {
  id: string
  fullName: string | null
  phone: string
  role: UserRole
  status: UserStatus
  passwordHash?: string | null
  createdAt: Date
}

/**
 * Allow-list explícita: campos novos no banco não vazam para a API por acidente.
 */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    phoneFormatted: formatPhoneForDisplay(user.phone),
    role: user.role,
    status: user.status,
    // Booleano, nunca o hash: o hash não sai da camada de dados.
    hasPassword: Boolean(user.passwordHash),
    createdAt: user.createdAt.toISOString(),
  }
}
