import { randomInt } from "node:crypto"

/**
 * Referência curta do agendamento: "EC-7F3K2Q".
 *
 * Serve para a pessoa dizer em voz alta no balcão e para aparecer na mensagem
 * do WhatsApp. Não é credencial: não abre consulta, não substitui o
 * publicToken, e saber uma não dá acesso a nada — é por isso que ela pode
 * circular por WhatsApp e extrato de pagamento, e o token não.
 *
 * Alfabeto sem 0, O, 1, I e S: a referência é ditada por telefone, e confundir
 * caractere no balcão é o defeito que se paga caro. O 5 fica porque, sem o S,
 * ele deixa de ser ambíguo.
 *
 * 6 caracteres sobre 31 símbolos ≈ 887 milhões de combinações. Como não é
 * credencial, o que importa é não colidir — e a unicidade no banco é quem
 * garante isso de verdade (ver `generateUniquePublicReference`).
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRTUVWXYZ"
const LENGTH = 6

export function generatePublicReference(): string {
  let body = ""
  for (let index = 0; index < LENGTH; index++) {
    body += ALPHABET[randomInt(ALPHABET.length)]
  }
  return `EC-${body}`
}

/**
 * Referência ainda livre no banco.
 *
 * Colisão é raríssima, mas "raríssima" não é "impossível" e a coluna é única:
 * sem esta checagem, uma colisão viraria erro na aprovação de um agendamento
 * legítimo. Poucas tentativas bastam; se todas colidirem, é sinal de algo
 * muito errado e o erro deve subir.
 */
export async function generateUniquePublicReference(
  exists: (reference: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reference = generatePublicReference()
    if (!(await exists(reference))) return reference
  }
  throw new Error("Não foi possível gerar uma referência pública única.")
}
