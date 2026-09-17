import { describe, it, expect, afterEach } from "vitest"
import { getProvider, isManualChannel, __setProviderForTests } from "../index"

afterEach(() => __setProviderForTests(null))

describe("isManualChannel", () => {
  it("is true only for hand-sent WhatsApp", () => {
    expect(isManualChannel("whatsapp_manual")).toBe(true)
    expect(isManualChannel("sms")).toBe(false)
    expect(isManualChannel("whatsapp")).toBe(false)
  })
})

describe("getProvider", () => {
  it("refuses the manual channel outright", () => {
    // With MESSAGING_PROVIDER unset the mock would otherwise "send" a hand-sent
    // message and mark it sent — a silent lie in the history.
    expect(() => getProvider("whatsapp_manual")).toThrow(/sent by hand/)
  })

  it("refuses the manual channel even when a provider is already cached", () => {
    // The guard must run before the cache lookup, or a warm Lambda container could
    // skip it.
    getProvider("sms") // warms the cache with the mock
    expect(() => getProvider("whatsapp_manual")).toThrow(/sent by hand/)
  })

  it("still returns the mock for provider channels by default", () => {
    const provider = getProvider("sms")
    expect(provider.name).toBe("mock")
    expect(provider.channel).toBe("sms")
  })
})
