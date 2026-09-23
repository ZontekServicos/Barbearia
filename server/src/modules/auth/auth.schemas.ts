import { z } from "zod"
import { isValidPhone, normalizePhone } from "../../utils/phone.js"
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password.service.js"

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

/**
 * Nome: espaços internos colapsados e bordas removidas, então "  João   Silva "
 * e "João Silva" viram o mesmo registro. Só espaços vira string vazia e é
 * recusado pelo tamanho mínimo.
 */
export const fullNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => value.length >= 2, "Informe seu nome completo.")
  .refine((value) => value.length <= 120, "Nome muito longo.")

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
