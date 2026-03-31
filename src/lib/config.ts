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
}
