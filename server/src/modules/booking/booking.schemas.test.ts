import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  availabilityQuerySchema,
  createServiceSchema,
  shopDateSchema,
  updateServiceSchema,
} from "./booking.schemas.js"

describe("datas do calendário da barbearia", () => {
  it("rejeita datas inexistentes antes de aplicar os limites de antecedência", () => {
    for (const date of ["2026-02-30", "2026-02-29", "2026-99-01", "2026-00-01", "2026-09-00"]) {
      assert.equal(shopDateSchema.safeParse(date).success, false, date)
      assert.equal(availabilityQuerySchema.safeParse({
        date,
        serviceId: "f57b9bb2-e6c4-41d5-8798-a82c5c471533",
      }).success, false, date)
    }
    assert.equal(shopDateSchema.safeParse("2028-02-29").success, true)
  })
})

describe("buffers desabilitados no contrato administrativo", () => {
  const service = {
    name: "Corte",
    description: "Corte completo",
    priceCents: 3000,
    durationMinutes: 30,
    active: true,
  }

  it("mantém todos os campos suportados para criar e editar serviços", () => {
    assert.deepEqual(createServiceSchema.parse(service), service)
    assert.deepEqual(updateServiceSchema.parse({ durationMinutes: 45 }), { durationMinutes: 45 })
    assert.deepEqual(updateServiceSchema.parse({ active: false }), { active: false })
    assert.deepEqual(updateServiceSchema.parse({ priceCents: 4500 }), { priceCents: 4500 })
    assert.equal(updateServiceSchema.safeParse({}).success, false)
    assert.deepEqual(createServiceSchema.parse({ name: "Corte", priceCents: 3000, durationMinutes: 30 }), {
      name: "Corte", priceCents: 3000, durationMinutes: 30, description: "", active: true,
    })
  })

  it("rejeita configuração de buffer até haver proteção de concorrência no banco", () => {
    for (const field of ["bufferBeforeMinutes", "bufferAfterMinutes"]) {
      assert.equal(createServiceSchema.safeParse({ ...service, [field]: 5 }).success, false)
      assert.equal(updateServiceSchema.safeParse({ durationMinutes: 45, [field]: 5 }).success, false)
    }
  })
})
