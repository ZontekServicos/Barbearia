import { z } from "zod"
import { isValidPhone, normalizePhone } from "../../utils/phone.js"

/** Telefone: valida e já entrega normalizado em E.164 para as camadas de baixo. */
export const phoneSchema = z
  .string()
  .trim()
  .min(8, "Informe um telefone válido.")
  .max(24, "Telefone muito longo.")
  .refine(
    isValidPhone,
    "Informe um celular válido com DDD, ex.: (71) 99999-9999.",
  )
  .transform(normalizePhone)

export const requestOtpSchema = z.strictObject({
  phone: phoneSchema,
})

export const verifyOtpSchema = z.strictObject({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código deve ter 6 dígitos."),
  /** Opcional: enviado no primeiro acesso para já nomear o cadastro. */
  fullName: z.string().trim().min(2).max(120).optional(),
})

export const refreshSchema = z.strictObject({}).default({})

export type RequestOtpInput = z.infer<typeof requestOtpSchema>
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>
