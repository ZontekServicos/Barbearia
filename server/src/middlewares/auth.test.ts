import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import type { NextFunction, Request, Response } from 'express'
import { AppError, ErrorCodes } from '../utils/errors.js'

// O módulo de auth carrega config/env, que exige ambiente válido.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_com_mais_de_32_caracteres!!'
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_com_mais_de_32_caracteres!'
process.env.NODE_ENV = 'test'

type Guard = (req: Request, res: Response, next: NextFunction) => void

let requireRole: (...roles: Array<'CUSTOMER' | 'ADMIN'>) => Guard
let requireActiveAccount: Guard

before(async () => {
  const mod = await import('./auth.js')
  requireRole = mod.requireRole as typeof requireRole
  requireActiveAccount = mod.requireActiveAccount as Guard
})

function fakeRequest(user?: Partial<NonNullable<Request['user']>>): Request {
  return {
    user: user
      ? {
          id: user.id ?? 'user-1',
          role: user.role ?? 'CUSTOMER',
          status: user.status ?? 'ACTIVE',
          phone: user.phone ?? '+5571999991111',
          fullName: user.fullName ?? 'Cliente Teste',
        }
      : undefined,
  } as Request
}

/** Captura o que o middleware passou para next(). */
function runGuard(guard: Guard, req: Request): AppError | undefined {
  let captured: unknown
  guard(req, {} as Response, ((error?: unknown) => {
    captured = error
  }) as NextFunction)
  return captured as AppError | undefined
}

describe('requireRole', () => {
  it('deixa passar quando o papel confere', () => {
    const erro = runGuard(requireRole('ADMIN'), fakeRequest({ role: 'ADMIN' }))
    assert.equal(erro, undefined)
  })

  it('bloqueia CUSTOMER tentando acessar endpoint de ADMIN', () => {
    const erro = runGuard(requireRole('ADMIN'), fakeRequest({ role: 'CUSTOMER' }))
    assert.ok(erro instanceof AppError)
    assert.equal(erro.statusCode, 403)
    assert.equal(erro.code, ErrorCodes.FORBIDDEN)
  })

  it('exige autenticação quando não há usuário na requisição', () => {
    const erro = runGuard(requireRole('ADMIN'), fakeRequest())
    assert.ok(erro instanceof AppError)
    assert.equal(erro.statusCode, 401)
  })

  it('aceita qualquer um dos papéis informados', () => {
    const guard = requireRole('CUSTOMER', 'ADMIN')
    assert.equal(runGuard(guard, fakeRequest({ role: 'CUSTOMER' })), undefined)
    assert.equal(runGuard(guard, fakeRequest({ role: 'ADMIN' })), undefined)
  })
})

describe('requireActiveAccount', () => {
  it('deixa passar usuário ACTIVE', () => {
    assert.equal(runGuard(requireActiveAccount, fakeRequest({ status: 'ACTIVE' })), undefined)
  })

  it('barra usuário PENDING com código próprio', () => {
    const erro = runGuard(requireActiveAccount, fakeRequest({ status: 'PENDING' }))
    assert.ok(erro instanceof AppError)
    assert.equal(erro.statusCode, 403)
    assert.equal(erro.code, ErrorCodes.ACCOUNT_PENDING)
  })

  it('barra usuário BLOCKED com código próprio', () => {
    const erro = runGuard(requireActiveAccount, fakeRequest({ status: 'BLOCKED' }))
    assert.ok(erro instanceof AppError)
    assert.equal(erro.code, ErrorCodes.ACCOUNT_BLOCKED)
  })

  it('exige autenticação quando não há usuário', () => {
    const erro = runGuard(requireActiveAccount, fakeRequest())
    assert.ok(erro instanceof AppError)
    assert.equal(erro.statusCode, 401)
  })
})
