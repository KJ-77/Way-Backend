import "dotenv/config"

export const config = {
  aws: {
    region: process.env.AWS_REGION || "eu-west-3",
    stage: process.env.STAGE || "dev",
  },
  db: {
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    port: parseInt(process.env.DB_PORT || "5432"),
  },
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    clientId: process.env.COGNITO_CLIENT_ID!,
    region: process.env.AWS_REGION || "eu-west-3",
  },
  clientCognito: {
    userPoolId: process.env.CLIENT_COGNITO_USER_POOL_ID!,
    clientId: process.env.CLIENT_COGNITO_CLIENT_ID!,
    region: process.env.AWS_REGION || "eu-west-3",
  },
  // ── Messaging (SMS) ──
  // Note these are NOT `!`-asserted like the DB and Cognito values above. Messaging
  // is optional: with MESSAGING_PROVIDER unset the app runs on the mock provider and
  // every other feature works normally. Asserting them would break local development
  // and every non-messaging Lambda for no reason.
  messaging: {
    // "mock" | "aws-sms" | "aws-whatsapp". Defaults to mock so an unset variable can
    // never send a real message to a real client.
    provider: process.env.MESSAGING_PROVIDER || "mock",
    // Which channel the service layer defaults to. See DEFAULT_CHANNEL.
    // "whatsapp_manual" today; "sms" is built but dormant.
    defaultChannel: process.env.DEFAULT_MESSAGE_CHANNEL || "whatsapp_manual",
    sms: {
      // AWS End User Messaging SMS is region-scoped and the sender ID is registered
      // per-region, so this may differ from the backend's own region.
      region: process.env.SMS_REGION || process.env.AWS_REGION || "eu-west-3",
      // Alphanumeric sender ID, max 11 chars — what the recipient sees. Lebanon
      // supports no other origination identity type.
      senderId: process.env.SMS_SENDER_ID,
      // Configuration set that routes delivery events to SNS. Without it there are
      // no delivery receipts and every message is stuck on 'sent'.
      configurationSet: process.env.SMS_CONFIGURATION_SET,
      // Per-message spend ceiling in USD, as a string (AWS's MaxPrice format).
      // Guards against a pricing surprise — Arabic messages fan out into several
      // billable parts and can cost multiples of an English one.
      maxPrice: process.env.SMS_MAX_PRICE,
    },
  },
}
