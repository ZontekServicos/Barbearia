import { AppError, ErrorCodes } from "./errors.js"

const BRAZIL_COUNTRY_CODE = "55"

/**
 * Normaliza um telefone brasileiro para E.164 (+5571999999999).
 *
 * Aceita as formas que o frontend e o usuário produzem na prática:
 *   "(71) 99999-1111", "71999991111", "5571999991111", "+55 71 99999-1111"
 *
 * Só aceitamos celular (9 dígitos após o DDD, iniciando em 9): o número é o
 * identificador de login e o WhatsApp de contato da barbearia, então um fixo
 * não serve para nenhum dos dois papéis.
 */
export function normalizePhone(rawInput: string): string {
  if (typeof rawInput !== "string") {
    throw AppError.badRequest(ErrorCodes.INVALID_PHONE, "Telefone inválido.")
  }

  if (rawInput.length > 24 || !/^\+?[\d\s().-]+$/.test(rawInput.trim())) {
    throw AppError.badRequest(ErrorCodes.INVALID_PHONE, "Telefone inválido.")
  }
  let digits = rawInput.replace(/\D/g, "")

  if (digits.length === 0) {
    throw AppError.badRequest(ErrorCodes.INVALID_PHONE, "Informe um telefone.")
  }

  // Remove o zero de operadora/tronco usado em ligações nacionais (ex.: 0 71 ...).
  if (digits.length > 11 && digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "")
  }

  // Com código do país: 55 + DDD(2) + número(9).
  if (digits.length === 13 && digits.startsWith(BRAZIL_COUNTRY_CODE)) {
    digits = digits.slice(BRAZIL_COUNTRY_CODE.length)
  }

  if (digits.length !== 11) {
    throw AppError.badRequest(
      ErrorCodes.INVALID_PHONE,
      "Informe um celular com DDD, no formato (71) 99999-9999.",
    )
  }

  const areaCode = digits.slice(0, 2)
  const subscriber = digits.slice(2)

  // Códigos nacionais atribuídos pela Anatel; não basta ter dois dígitos.
  const validAreas = new Set(
    "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(
      " ",
    ),
  )
  if (!validAreas.has(areaCode)) {
    throw AppError.badRequest(ErrorCodes.INVALID_PHONE, "DDD inválido.")
  }

  if (!subscriber.startsWith("9")) {
    throw AppError.badRequest(
      ErrorCodes.INVALID_PHONE,
      "Informe um número de celular (o nono dígito deve ser 9).",
    )
  }

  return `+${BRAZIL_COUNTRY_CODE}${areaCode}${subscriber}`
}

/** `true` quando o valor pode ser normalizado — útil em validações Zod. */
export function isValidPhone(rawInput: string): boolean {
  try {
    normalizePhone(rawInput)
    return true
  } catch {
    return false
  }
}

/** Formata um E.164 brasileiro para exibição: +5571999991111 -> (71) 99999-1111 */
export function formatPhoneForDisplay(e164: string): string {
  const match = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(e164)
  if (!match) return e164
  return `(${match[1]}) ${match[2]}-${match[3]}`
}

/**
 * Máscara para logs: +5571999991111 -> +5571****1111.
 * Telefone é dado pessoal; nunca registramos o número inteiro.
 */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return "***"
  return `${e164.slice(0, 5)}****${e164.slice(-4)}`
}
