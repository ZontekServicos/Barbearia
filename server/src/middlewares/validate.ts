import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodType } from 'zod'
import { AppError, ErrorCodes } from '../utils/errors.js'
import { formatZodIssues } from './error-handler.js'
import { ZodError } from 'zod'

interface ValidationSchemas {
  body?: ZodType
  params?: ZodType
  query?: ZodType
}

/**
 * Valida body/params/query com Zod e substitui o valor original pelo dado
 * já tipado. Isso também fecha a porta para mass assignment: o que não está
 * no schema simplesmente não chega ao controller.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body)
      if (schemas.params) {
        Object.assign(req.params, schemas.params.parse(req.params))
      }
      if (schemas.query) {
        // Em Express 5 req.query é getter-only; guardamos o resultado à parte.
        req.validatedQuery = schemas.query.parse(req.query)
      }
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          AppError.badRequest(ErrorCodes.VALIDATION_ERROR, 'Dados inválidos.', formatZodIssues(error)),
        )
        return
      }
      next(error)
    }
  }
}
