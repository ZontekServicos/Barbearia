import { z } from "zod"
import { fullNameSchema, phoneSchema } from "../shared/contact.schemas.js"

export { fullNameSchema, phoneSchema }
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password.service.js"

/**
 * Senha nova. Sem `trim`: espaço no começo ou no fim é parte da senha e
 * removê-lo silenciosamente quebraria o login depois. Sem exigência de
 * maiúscula/símbolo/dígito — regras arbitrárias produzem senhas piores.
 */
export const newPasswordSchema = z.string().max(512)
  .transform((value) => value.normalize("NFKC"))
  .refine((value) => Array.from(value).length >= PASSWORD_MIN_LENGTH,
    { message: `A senha precisa de pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  .refine((value) => Array.from(value).length <= PASSWORD_MAX_LENGTH,
    { message: "Senha muito longa." })

export const confirmationSchema = z.string().max(512)
  .transform((value) => value.normalize("NFKC"))

export const registerSchema = z
  .strictObject({
    fullName: fullNameSchema,
    phone: phoneSchema,
    password: newPasswordSchema,
    confirmPassword: confirmationSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
  })

/**
 * Login não repete as regras de força: dizer "mínimo 8" para quem está
 * entrando só informaria o atacante. O teto existe para limitar o trabalho
 * de hashing por requisição.
 */
export const loginSchema = z.strictObject({
  phone: phoneSchema,
  password: z.string().min(1, "Informe sua senha.").max(512),
})

export const refreshSchema = z.strictObject({}).default({})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
