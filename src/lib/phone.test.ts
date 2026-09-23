import { it } from "node:test"
import assert from "node:assert/strict"
import { looksLikeCompletePhone, maskPhone } from "./phone"
it("pasted E.164, local and national-trunk phones preserve all subscriber digits", () => {
  for (const value of ["(71) 99999-1111", "71999991111", "5571999991111", "+55 (71) 99999-1111", "071999991111"])
    assert.equal(maskPhone(value), "(71) 99999-1111")
})
it("DDD 55 is not mistaken for a country code in a local number", () => {
  assert.equal(maskPhone("55999991111"), "(55) 99999-1111")
})
it("overlong input cannot be silently truncated into a complete phone", () => {
  assert.equal(looksLikeCompletePhone(maskPhone("71999991111234")), false)
})
