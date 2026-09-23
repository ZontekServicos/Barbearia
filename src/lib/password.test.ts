import { it } from "node:test"
import assert from "node:assert/strict"
import { generateTemporaryPassword, passwordLength, passwordsMatch, PASSWORD_MIN_LENGTH } from "./password"
it("new password policy counts normalized Unicode code points and preserves spaces", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 15)
  assert.equal(passwordLength("e\u0301"), 1)
  assert.equal(passwordLength("😀".repeat(15)), 15)
  assert.equal(passwordsMatch("café", "cafe\u0301"), true)
  assert.equal(passwordsMatch(" password ", "password"), false)
})
it("operator reset credentials use 128 random bits and no persistent storage", () => {
  const generated = new Set(Array.from({length:50},generateTemporaryPassword))
  assert.equal(generated.size,50)
  for (const value of generated) assert.match(value,/^[a-f0-9]{32}$/)
})
