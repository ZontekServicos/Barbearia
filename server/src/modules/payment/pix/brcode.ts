/**
 * BR Code: o payload Pix que vai dentro do QR Code.
 *
 * É o formato EMV®QRCPS do Banco Central — uma cadeia de campos
 * `ID + tamanho(2) + valor`, terminada por um CRC16. Um QR que contenha só a
 * chave Pix em texto cru NÃO é um pagamento: o aplicativo do banco não
 * reconhece, e o cliente vê "QR inválido". Por isso o payload é montado aqui,
 * campo a campo, em vez de concatenado na tela.
 *
 * Referência: Manual de Padrões para Iniciação do Pix (BCB), seção do QR Code
 * estático. Os identificadores usados:
 *
 *   00  Payload Format Indicator          sempre "01"
 *   01  Point of Initiation Method        "11" estático reutilizável, "12" uso único
 *   26  Merchant Account Information      GUI br.gov.bcb.pix + chave
 *   52  Merchant Category Code            "0000" (não classificado)
 *   53  Transaction Currency              "986" (BRL, ISO 4217)
 *   54  Transaction Amount                "40.00" — ponto decimal, sem separador de milhar
 *   58  Country Code                      "BR"
 *   59  Merchant Name
 *   60  Merchant City
 *   62  Additional Data Field             05 = referência da transação (txid)
 *   63  CRC16                             calculado sobre tudo que vem antes
 */

/** `ID + tamanho em 2 dígitos + valor`. Tamanho é de CARACTERES, não de bytes. */
function field(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value
}

/**
 * CRC16/CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem reflexão e
 * sem XOR final. É a variante que o BR Code exige — trocar por outra faz o
 * aplicativo do banco recusar o QR sem explicar por quê.
 *
 * Calculado sobre a cadeia já com "6304" no fim, e o resultado substitui o
 * lugar do valor.
 */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let index = 0; index < payload.length; index++) {
    crc ^= payload.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

/**
 * Normaliza texto para os campos do BR Code.
 *
 * Acento e cedilha fora: o padrão trabalha com o conjunto latino básico e
 * alguns aplicativos truncam ou corrompem o resto. "ErickCorttes Barbearia"
 * passa intacto; "São Paulo" vira "Sao Paulo".
 */
function asciiUpper(value: string, maxLength: number): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .toUpperCase()
    .slice(0, maxLength)
}

/**
 * Referência da transação (txid).
 *
 * Só letras e números, até 25 caracteres — o padrão não aceita mais que isso.
 * `EC-7F3K2Q` vira `EC7F3K2Q`. Ausente, usamos `***`, que é o valor previsto
 * para "sem identificador".
 */
function transactionId(reference: string | undefined): string {
  if (!reference) return "***"
  const clean = reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 25)
  return clean.length > 0 ? clean : "***"
}

/** Valor em centavos para o formato do padrão: "4000" → "40.00". */
function amount(amountCents: number): string {
  return (amountCents / 100).toFixed(2)
}

export interface BrCodeInput {
  /** Chave Pix da barbearia, como configurada. */
  pixKey: string
  receiverName: string
  receiverCity: string
  /** Em centavos, sempre calculado no servidor. */
  amountCents: number
  /** Referência pública do agendamento, para conciliar no extrato. */
  reference?: string
  /**
   * `true` para QR de uso único (cobrança dinâmica), `false` para o estático
   * reutilizável da barbearia.
   */
  singleUse?: boolean
}

/**
 * Monta o payload completo, com CRC.
 *
 * O valor entra no QR, então o aplicativo já abre com a quantia certa e o
 * cliente não digita — e não erra. O valor vem de `amountCents`, calculado a
 * partir do preço congelado no agendamento; não existe caminho por onde o
 * navegador informe quanto cobrar.
 */
export function buildBrCode(input: BrCodeInput): string {
  const key = input.pixKey.trim()
  if (key.length === 0 || key.length > 77) {
    throw new Error("Chave Pix inválida para o BR Code.")
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Valor inválido para o BR Code.")
  }

  const merchantAccount =
    field("00", "br.gov.bcb.pix") + field("01", key)

  const payload =
    field("00", "01") +
    field("01", input.singleUse ? "12" : "11") +
    field("26", merchantAccount) +
    field("52", "0000") +
    field("53", "986") +
    field("54", amount(input.amountCents)) +
    field("58", "BR") +
    field("59", asciiUpper(input.receiverName, 25)) +
    field("60", asciiUpper(input.receiverCity, 15)) +
    field("62", field("05", transactionId(input.reference)))

  // O CRC cobre a cadeia inteira INCLUINDO "6304"; só depois o valor entra.
  const withCrcPlaceholder = payload + "6304"
  return withCrcPlaceholder + crc16(withCrcPlaceholder)
}

/**
 * Confere um payload recebido: tamanho, terminador e CRC.
 *
 * Usado pelos testes e pela conferência de payload vindo de provedor — um
 * "Copia e Cola" com CRC errado falha no aplicativo do cliente, e é melhor
 * descobrir aqui.
 */
export function isValidBrCode(payload: string): boolean {
  if (payload.length < 10) return false
  const marker = payload.lastIndexOf("6304")
  if (marker === -1 || marker + 8 !== payload.length) return false
  const body = payload.slice(0, marker + 4)
  return crc16(body) === payload.slice(marker + 4).toUpperCase()
}

/**
 * Mascara a chave para exibição: `5f79…8c21`.
 *
 * A chave é pública por natureza — quem paga precisa vê-la —, mas a tela mostra
 * a forma curta por padrão para não estampar telefone, CPF ou e-mail inteiro
 * numa captura de tela. O valor completo continua disponível no botão de copiar.
 */
export function maskPixKey(key: string): string {
  const clean = key.trim()
  if (clean.length <= 10) return clean
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`
}
