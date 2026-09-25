/**
 * Máscara brasileira de celular para exibição enquanto o usuário digita.
 *
 * O backend é a fonte de verdade: ele normaliza para E.164 e valida DDD e
 * nono dígito. Aqui só formatamos o que está sendo digitado — nada do que
 * esta função aceita substitui a validação do servidor.
 */
export function maskPhone(input: string): string {
  // Defensivo: um valor ausente vindo do perfil não pode derrubar a tela.
  const raw = input ?? ""
  let digits = raw.replace(/\D/g, "")
  if (digits.length > 11 && digits.startsWith("0")) digits = digits.replace(/^0+/, "")
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2)
  // An invalid paste must not silently turn into somebody else's valid number.
  if (digits.length > 11) return raw.slice(0, 24)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/** Dígitos suficientes para um celular com DDD. Só habilita o botão. */
export function looksLikeCompletePhone(raw: string): boolean {
  return (raw ?? "").replace(/\D/g, "").length === 11
}
