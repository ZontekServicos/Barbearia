import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildBrCode, crc16, isValidBrCode, maskPixKey } from "./brcode.js"

/**
 * Decodifica os campos `ID + tamanho + valor` de um payload BR Code.
 *
 * Os testes decodificam em vez de comparar a cadeia inteira: asserção sobre
 * string completa quebra a cada ajuste de nome ou cidade sem apontar o que
 * mudou, e não prova que os tamanhos declarados batem com o conteúdo.
 */
function decode(payload: string): Map<string, string> {
  const fields = new Map<string, string>()
  let index = 0
  while (index < payload.length) {
    const id = payload.slice(index, index + 2)
    const length = Number(payload.slice(index + 2, index + 4))
    assert.ok(Number.isInteger(length) && length > 0, `tamanho inválido no campo ${id}`)
    const value = payload.slice(index + 4, index + 4 + length)
    assert.equal(value.length, length, `campo ${id} declara ${length} e entrega ${value.length}`)
    fields.set(id, value)
    index += 4 + length
  }
  return fields
}

const base = {
  pixKey: "5f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21",
  receiverName: "ErickCorttes Barbearia",
  receiverCity: "Salvador",
  amountCents: 4000,
  reference: "EC-7F3K2Q",
}

describe("CRC16 do BR Code", () => {
  it("bate com o valor de verificação canônico do CRC-16/CCITT-FALSE", () => {
    // "123456789" => 0x29B1 é o check value publicado do algoritmo. É a prova
    // de que a variante é a certa: polinômio 0x1021, início 0xFFFF, sem
    // reflexão e sem XOR final. Outra variante recusa o QR no app do banco.
    assert.equal(crc16("123456789"), "29B1")
  })

  it("sempre devolve quatro dígitos hexadecimais maiúsculos", () => {
    for (const input of ["", "a", "00020101", "x".repeat(500)]) {
      assert.match(crc16(input), /^[0-9A-F]{4}$/, JSON.stringify(input.slice(0, 8)))
    }
  })

  it("muda com qualquer alteração de um byte", () => {
    const one = crc16("00020101021126")
    const other = crc16("00020101021127")
    assert.notEqual(one, other)
  })
})

describe("montagem do BR Code", () => {
  it("produz payload com CRC válido e campos obrigatórios", () => {
    const payload = buildBrCode(base)
    assert.ok(isValidBrCode(payload))

    const fields = decode(payload)
    assert.equal(fields.get("00"), "01", "Payload Format Indicator")
    assert.equal(fields.get("01"), "11", "estático reutilizável")
    assert.equal(fields.get("52"), "0000", "Merchant Category Code")
    assert.equal(fields.get("53"), "986", "moeda BRL")
    assert.equal(fields.get("54"), "40.00", "valor com ponto decimal")
    assert.equal(fields.get("58"), "BR")
    assert.equal(fields.get("59"), "ERICKCORTTES BARBEARIA")
    assert.equal(fields.get("60"), "SALVADOR")
    assert.match(fields.get("63")!, /^[0-9A-F]{4}$/)
  })

  it("põe a chave dentro do Merchant Account Information, com o GUI do Pix", () => {
    const fields = decode(buildBrCode(base))
    const account = decode(fields.get("26")!)
    assert.equal(account.get("00"), "br.gov.bcb.pix")
    assert.equal(account.get("01"), base.pixKey)
  })

  it("leva a referência como txid, só com letras e números", () => {
    const fields = decode(buildBrCode(base))
    const additional = decode(fields.get("62")!)
    // "EC-7F3K2Q" -> "EC7F3K2Q": o padrão não aceita hífen no txid.
    assert.equal(additional.get("05"), "EC7F3K2Q")
  })

  it("sem referência usa *** , o valor previsto para 'sem identificador'", () => {
    const { reference, ...withoutReference } = base
    const fields = decode(buildBrCode(withoutReference))
    assert.equal(decode(fields.get("62")!).get("05"), "***")
  })

  it("marca uso único quando a cobrança é de provedor", () => {
    assert.equal(decode(buildBrCode({ ...base, singleUse: true })).get("01"), "12")
    assert.equal(decode(buildBrCode(base)).get("01"), "11")
  })

  it("converte centavos sem perder nem inventar casas", () => {
    for (const [cents, expected] of [
      [1, "0.01"],
      [99, "0.99"],
      [100, "1.00"],
      [4000, "40.00"],
      [123_456, "1234.56"],
    ] as Array<[number, string]>) {
      assert.equal(decode(buildBrCode({ ...base, amountCents: cents })).get("54"), expected)
    }
  })

  it("remove acento e cedilha, e respeita os limites do padrão", () => {
    const fields = decode(
      buildBrCode({
        ...base,
        receiverName: "Barbearia São João Coração Ação Extra",
        receiverCity: "São Gonçalo dos Campos",
      }),
    )
    assert.equal(fields.get("59"), "BARBEARIA SAO JOAO CORACA", "25 caracteres, sem acento")
    assert.equal(fields.get("60"), "SAO GONCALO DOS", "15 caracteres")
    assert.ok(isValidBrCode(buildBrCode({ ...base, receiverName: "Açaí & Cia" })))
  })

  it("recusa chave vazia e valor não positivo", () => {
    assert.throws(() => buildBrCode({ ...base, pixKey: "  " }), /Chave Pix inválida/)
    assert.throws(() => buildBrCode({ ...base, pixKey: "x".repeat(78) }), /Chave Pix inválida/)
    for (const amountCents of [0, -1, -4000, 1.5, Number.NaN]) {
      assert.throws(() => buildBrCode({ ...base, amountCents }), /Valor inválido/, String(amountCents))
    }
  })

  it("aceita os formatos reais de chave Pix", () => {
    for (const pixKey of [
      "5f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21", // aleatória
      "+5571999990000", // telefone
      "contato@erickcorttes.com.br", // e-mail
      "12345678901", // CPF
      "12345678000199", // CNPJ
    ]) {
      const payload = buildBrCode({ ...base, pixKey })
      assert.ok(isValidBrCode(payload), pixKey)
      assert.equal(decode(decode(payload).get("26")!).get("01"), pixKey)
    }
  })
})

describe("validação de BR Code", () => {
  it("aceita o que ela mesma gera e recusa payload adulterado", () => {
    const payload = buildBrCode(base)
    assert.ok(isValidBrCode(payload))
    // Um dígito do valor alterado: o CRC deixa de bater.
    assert.equal(isValidBrCode(payload.replace("40.00", "10.00")), false)
    // CRC trocado.
    assert.equal(isValidBrCode(payload.slice(0, -4) + "0000"), false)
    // Sem terminador.
    assert.equal(isValidBrCode(payload.slice(0, -8)), false)
    assert.equal(isValidBrCode(""), false)
    assert.equal(isValidBrCode("nao e um brcode"), false)
  })
})

describe("máscara da chave Pix", () => {
  it("encurta chaves longas e preserva as curtas", () => {
    assert.equal(maskPixKey("5f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21"), "5f79…8c21")
    assert.equal(maskPixKey("contato@erickcorttes.com.br"), "cont…m.br")
    // Curta o bastante para não haver o que esconder.
    assert.equal(maskPixKey("12345"), "12345")
  })
})
