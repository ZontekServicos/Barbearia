import { after, beforeEach, it } from "node:test"
import assert from "node:assert/strict"
import { clearBookingIntent, readBookingIntent, saveBookingIntent } from "./booking-intent"
const prior = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")
const memory = new Map<string, string>()
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
} })
after(() => { if (prior) Object.defineProperty(globalThis, "sessionStorage", prior); else Reflect.deleteProperty(globalThis, "sessionStorage") })
beforeEach(() => memory.clear())
const intent = { serviceId: "7f8fd43f-7b36-4704-8801-2db9b5ec666c", date: "2026-10-01", startsAt: "09:00" }
it("preserves service, date and time without personal data or credentials", () => {
  saveBookingIntent(intent)
  assert.deepEqual(Object.keys(readBookingIntent()!).sort(), ["date", "savedAt", "serviceId", "startsAt"])
  assert.equal(readBookingIntent()!.serviceId, intent.serviceId)
})
it("expires and removes selections after two hours", () => {
  memory.set("ec.booking.intent", JSON.stringify({ ...intent, savedAt: Date.now() - 7200001 }))
  assert.equal(readBookingIntent(), null)
  assert.equal(memory.size, 0)
})
it("rejects malformed, future and non-object selections", () => {
  for (const payload of [null, [], "string", { ...intent, savedAt: Date.now() + 60000 }, { ...intent, serviceId: "other", savedAt: Date.now() }, { ...intent, date: "bad", savedAt: Date.now() }]) {
    memory.set("ec.booking.intent", JSON.stringify(payload))
    assert.equal(readBookingIntent(), null)
  }
})
it("clears a completed booking selection", () => {
  saveBookingIntent(intent)
  clearBookingIntent()
  assert.equal(readBookingIntent(), null)
})
