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
  phoneVerified: boolean
  createdAt: string
}

interface UserRecord {
  id: string
  fullName: string | null
  phone: string
  role: UserRole
  status: UserStatus
  phoneVerifiedAt: Date | null
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
    phoneVerified: user.phoneVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  }
}
