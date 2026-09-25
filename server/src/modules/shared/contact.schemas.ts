import { z } from "zod"
import { isValidPhone, normalizePhone } from "../../utils/phone.js"

/**
 * Validações de contato compartilhadas entre autenticação e agendamento.
 *
 * Vivem fora de `auth.schemas` de propósito: lá ficavam no mesmo módulo que
 * importa a política de senha, que importa o logger, que valida o ambiente.
 * Quem só precisa validar um telefone — como a solicitação pública de
 * agendamento — passava a exigir configuração completa de ambiente só para
 * carregar. Aqui não há dependência além do utilitário de telefone.
 */

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
