import { describe, it, expect, vi } from "vitest"
import { AwsSmsProvider, translateAwsError, estimateSegments } from "../sms-provider"
import { MessagingError } from "../provider"
import { classifyFailure } from "../send-policy"

// Minimal stand-in for PinpointSMSVoiceV2Client — we only ever call .send().
const fakeClient = (impl: (cmd: unknown) => Promise<unknown>) =>
  ({ send: vi.fn(impl) }) as never

const makeProvider = (impl: (cmd: unknown) => Promise<unknown>, overrides = {}) =>
  new AwsSmsProvider({
    region: "eu-west-3",
    originationIdentity: "WayStudio",
    client: fakeClient(impl),
    ...overrides,
  })

describe("AwsSmsProvider.sendTemplate", () => {
  it("sends the pre-rendered body, not the template name", async () => {
    // The whole point of `renderedBody`: SMS has no provider-side templates, so the
    // exact text approved in the queue is what goes on the wire.
    let captured: Record<string, unknown> = {}
    const provider = makeProvider(async (cmd: any) => {
      captured = cmd.input
      return { MessageId: "sms-1" }
    })

    const result = await provider.sendTemplate({
      to: "+96170123456",
      templateName: "item_ready_for_pickup",
      language: "en",
      variables: ["Sara", "mug"],
      renderedBody: "Way Studio: Hi Sara, your piece (mug) is ready.",
      category: "utility",
    })

    expect(result.providerMessageId).toBe("sms-1")
    expect(captured.MessageBody).toBe("Way Studio: Hi Sara, your piece (mug) is ready.")
    expect(captured.DestinationPhoneNumber).toBe("+96170123456")
    expect(captured.OriginationIdentity).toBe("WayStudio")
  })

  it("routes utility as TRANSACTIONAL and marketing as PROMOTIONAL", async () => {
    // Mislabelling a promo as transactional is what damages sender reputation with
    // carriers, so this mapping is worth pinning down.
    let captured: Record<string, unknown> = {}
    const provider = makeProvider(async (cmd: any) => {
      captured = cmd.input
      return { MessageId: "x" }
    })

    await provider.sendText({ to: "+96170123456", body: "hi", category: "utility" })
    expect(captured.MessageType).toBe("TRANSACTIONAL")

    await provider.sendText({ to: "+96170123456", body: "hi", category: "marketing" })
    expect(captured.MessageType).toBe("PROMOTIONAL")
  })

  it("defaults to TRANSACTIONAL when no category is given", async () => {
    // Failing safe: an uncategorised message is treated as the higher-priority kind
    // rather than silently downgraded to promotional routing.
    let captured: Record<string, unknown> = {}
    const provider = makeProvider(async (cmd: any) => {
      captured = cmd.input
      return { MessageId: "x" }
    })
    await provider.sendText({ to: "+96170123456", body: "hi" })
    expect(captured.MessageType).toBe("TRANSACTIONAL")
  })

  it("omits optional fields entirely when unconfigured", async () => {
    // Passing ConfigurationSetName: undefined is not the same as omitting it —
    // the SDK would serialise a null and AWS rejects it.
    let captured: Record<string, unknown> = {}
    const provider = makeProvider(async (cmd: any) => {
      captured = cmd.input
      return { MessageId: "x" }
    })
    await provider.sendText({ to: "+96170123456", body: "hi" })
    expect("ConfigurationSetName" in captured).toBe(false)
    expect("MaxPrice" in captured).toBe(false)
  })

  it("rejects an empty body before calling AWS", async () => {
    const send = vi.fn()
    const provider = makeProvider(send as never)
    await expect(provider.sendText({ to: "+96170123456", body: "   " })).rejects.toThrow(
      MessagingError,
    )
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects a body over the 1600-character AWS limit", async () => {
    const provider = makeProvider(async () => ({ MessageId: "x" }))
    await expect(
      provider.sendText({ to: "+96170123456", body: "a".repeat(1601) }),
    ).rejects.toThrow(/1600/)
  })

  it("treats a success response with no MessageId as an error", async () => {
    // Without an id we could never correlate the delivery receipt, so accepting it
    // would strand the message on 'sent' forever.
    const provider = makeProvider(async () => ({}))
    await expect(provider.sendText({ to: "+96170123456", body: "hi" })).rejects.toThrow(
      /MessageId/,
    )
  })
})

describe("translateAwsError", () => {
  // ⚠️ The reason this whole translation layer exists.
  //
  // The SMS v2 API returns HTTP 400 for throttling. The generic classifier maps 4xx
  // to "permanent", so without translation a rate-limited send would be marked
  // permanently failed and never retried — messages would silently stop going out
  // during any burst, e.g. mid-broadcast.
  it("classifies throttling as RETRYABLE despite its 400 status", () => {
    const raw = Object.assign(new Error("Too many requests"), {
      name: "ThrottlingException",
      $metadata: { httpStatusCode: 400 },
    })

    // Prove the bug exists without translation...
    expect(classifyFailure(raw)).toBe("permanent")
    // ...and that translation fixes it.
    expect(classifyFailure(translateAwsError(raw))).toBe("retryable")
  })

  it("classifies InternalServerException as retryable", () => {
    const raw = Object.assign(new Error("boom"), { name: "InternalServerException" })
    expect(classifyFailure(translateAwsError(raw))).toBe("retryable")
  })

  it.each([
    ["ValidationException", "SMS_INVALID_REQUEST"],
    ["ConflictException", "SMS_CONFLICT"],
    ["ResourceNotFoundException", "SMS_ORIGIN_NOT_FOUND"],
    ["AccessDeniedException", "SMS_ACCESS_DENIED"],
    ["ServiceQuotaExceededException", "SMS_QUOTA_EXCEEDED"],
  ])("maps %s to a permanent %s", (name, code) => {
    const translated = translateAwsError(Object.assign(new Error("nope"), { name }))
    expect(translated).toBeInstanceOf(MessagingError)
    expect((translated as MessagingError).code).toBe(code)
    expect(classifyFailure(translated)).toBe("permanent")
  })

  it("surfaces the AWS Reason field, which names the actual cause", () => {
    // e.g. DESTINATION_PHONE_NUMBER_OPTED_OUT — far more actionable than the
    // generic "Cannot send" message.
    const translated = translateAwsError(
      Object.assign(new Error("blocked"), {
        name: "ConflictException",
        Reason: "DESTINATION_PHONE_NUMBER_OPTED_OUT",
      }),
    ) as MessagingError
    expect(translated.message).toContain("DESTINATION_PHONE_NUMBER_OPTED_OUT")
  })

  it("passes timeouts through untouched so they stay UNCONFIRMED", () => {
    // Critical: a timeout must never be converted into a retryable error. We don't
    // know whether the message went out, and auto-retrying is precisely how a
    // client receives the same SMS twice.
    const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })
    expect(translateAwsError(timeout)).toBe(timeout)
    expect(classifyFailure(translateAwsError(timeout))).toBe("unconfirmed")
  })

  it("passes unknown errors through untouched", () => {
    const weird = new Error("who knows")
    expect(translateAwsError(weird)).toBe(weird)
  })
})

describe("estimateSegments", () => {
  it("fits a short English message in one GSM-7 segment", () => {
    const result = estimateSegments("Way Studio: your piece is ready for pickup.")
    expect(result.encoding).toBe("GSM-7")
    expect(result.count).toBe(1)
  })

  it("splits English at 160 characters", () => {
    expect(estimateSegments("a".repeat(160)).count).toBe(1)
    // Past 160 the whole message re-splits at 153 to make room for part headers.
    expect(estimateSegments("a".repeat(161)).count).toBe(2)
    expect(estimateSegments("a".repeat(306)).count).toBe(2)
    expect(estimateSegments("a".repeat(307)).count).toBe(3)
  })

  it("counts GSM-7 extension characters as two septets", () => {
    // "€" and "{}" cost double — an easy way to accidentally spill into a 2nd segment.
    expect(estimateSegments("a".repeat(159) + "€").count).toBe(2)
  })

  it("drops Arabic to 70 characters per segment", () => {
    // THE cost gotcha. Arabic can't be encoded in GSM-7, so it falls back to UCS-2
    // and a message under half the English limit already costs 2 segments.
    const arabic = "مرحبا".repeat(20) // 100 characters
    const result = estimateSegments(arabic)
    expect(result.encoding).toBe("UCS-2")
    expect(result.count).toBe(2)
  })

  it("makes a single Arabic character switch the whole message to UCS-2", () => {
    // One stray Arabic word in an English message triples its cost. Worth surfacing
    // in the compose UI.
    const mostlyEnglish = "a".repeat(100) + "مرحبا"
    expect(estimateSegments(mostlyEnglish).encoding).toBe("UCS-2")
    expect(estimateSegments("a".repeat(100)).encoding).toBe("GSM-7")
  })

  it("reports headroom left in the final segment", () => {
    expect(estimateSegments("a".repeat(150)).remainingInLastSegment).toBe(10)
  })
})
