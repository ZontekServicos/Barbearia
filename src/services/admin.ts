import { apiRequest } from './api'
import type { AuthUser, UserRole, UserStatus } from './auth'

export interface ListUsersParams {
  status?: UserStatus
  role?: UserRole
  search?: string
  page?: number
  perPage?: number
}

export interface ListUsersResult {
  users: AuthUser[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

export async function listUsers(params: ListUsersParams = {}): Promise<ListUsersResult> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.role) query.set('role', params.role)
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.perPage) query.set('perPage', String(params.perPage))

  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiRequest<ListUsersResult>(`/admin/users${suffix}`)
}

export async function updateUserStatus(userId: string, status: UserStatus): Promise<AuthUser> {
  const data = await apiRequest<{ user: AuthUser }>(`/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: { status },
  })
  return data.user
}

export async function countPendingUsers(): Promise<number> {
  const data = await apiRequest<{ pending: number }>('/admin/users/pending-count')
  return data.pending
}
