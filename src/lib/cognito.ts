import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider"
import { config } from "./config"

const client = new CognitoIdentityProviderClient({ region: config.cognito.region })

export const createCognitoUser = async (
  email: string,
  fullName: string,
  phone?: string,
): Promise<string> => {
  const attrs = [
    { Name: "email", Value: email },
    { Name: "email_verified", Value: "true" },
    { Name: "name", Value: fullName },
  ]
  if (phone) attrs.push({ Name: "phone_number", Value: phone })

  const result = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      UserAttributes: attrs,
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  )

  const sub = result.User?.Attributes?.find((a) => a.Name === "sub")?.Value
  if (!sub) throw new Error("Failed to get cognito_sub from created user")
  return sub
}

export const addUserToGroup = async (username: string, groupName: string): Promise<void> => {
  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
      GroupName: groupName,
    }),
  )
}

export const removeUserFromGroup = async (username: string, groupName: string): Promise<void> => {
  await client.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
      GroupName: groupName,
    }),
  )
}

// Syncs mutable user attributes (name, phone) back to Cognito
export const updateCognitoUserAttributes = async (
  username: string,
  attrs: { fullName?: string; phone?: string | null },
): Promise<void> => {
  const userAttributes: { Name: string; Value: string }[] = []
  if (attrs.fullName !== undefined) {
    userAttributes.push({ Name: "name", Value: attrs.fullName })
  }
  if (attrs.phone !== undefined) {
    userAttributes.push({ Name: "phone_number", Value: attrs.phone || "" })
  }
  if (userAttributes.length === 0) return

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
      UserAttributes: userAttributes,
    }),
  )
}

export const deleteCognitoUser = async (username: string): Promise<void> => {
  await client.send(
    new AdminDeleteUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
    }),
  )
}

export const getCognitoUser = async (username: string) => {
  return client.send(
    new AdminGetUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
    }),
  )
}

// Sets a temporary password and puts the user into FORCE_CHANGE_PASSWORD state.
// On next login they'll be prompted to set a new password.
export const resetCognitoUserPassword = async (username: string): Promise<string> => {
  const tempPassword = generateTempPassword()
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: username,
      Password: tempPassword,
      Permanent: false, // forces FORCE_CHANGE_PASSWORD state
    }),
  )
  return tempPassword
}

// ── Client Pool helpers (WayBeirut-Clients) ──

const clientPool = new CognitoIdentityProviderClient({ region: config.clientCognito.region })

// Generates a temp password meeting pool requirements (8+ chars, upper, lower, number)
const generateTempPassword = (): string => {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lower = "abcdefghijklmnopqrstuvwxyz"
  const digits = "0123456789"
  const all = upper + lower + digits
  // Guarantee at least one of each required type
  let pw = upper[Math.floor(Math.random() * 26)]
    + lower[Math.floor(Math.random() * 26)]
    + digits[Math.floor(Math.random() * 10)]
  for (let i = 3; i < 12; i++) pw += all[Math.floor(Math.random() * all.length)]
  // Shuffle to avoid predictable positions
  return pw.split("").sort(() => Math.random() - 0.5).join("")
}

/**
 * Creates a client user in the WayBeirut-Clients Cognito pool.
 * - With email: Cognito sends temp password to client's email
 * - Without email: returns generated temp password for admin to share verbally
 */
export const createClientCognitoUser = async (
  phone: string,
  fullName: string,
  email?: string,
): Promise<{ sub: string; tempPassword: string | null }> => {
  // Strip spaces for Cognito — username and phone_number attribute require no whitespace
  const cognitoPhone = phone.replace(/\s+/g, "")

  const attrs: { Name: string; Value: string }[] = [
    { Name: "name", Value: fullName },
    { Name: "phone_number", Value: cognitoPhone },
  ]
  if (email) {
    attrs.push({ Name: "email", Value: email })
    attrs.push({ Name: "email_verified", Value: "true" })
  }

  // With email: Cognito delivers temp password via email
  // Without email: suppress delivery and use our generated password
  const hasEmail = !!email
  const tempPassword = hasEmail ? undefined : generateTempPassword()

  const result = await clientPool.send(
    new AdminCreateUserCommand({
      UserPoolId: config.clientCognito.userPoolId,
      Username: cognitoPhone, // must be space-free for Cognito username constraint
      UserAttributes: attrs,
      ...(hasEmail
        ? { DesiredDeliveryMediums: ["EMAIL"] }
        : { MessageAction: "SUPPRESS", TemporaryPassword: tempPassword }),
    }),
  )

  const sub = result.User?.Attributes?.find((a) => a.Name === "sub")?.Value
  if (!sub) throw new Error("Failed to get cognito_sub from created client user")
  return { sub, tempPassword: tempPassword ?? null }
}

export const deleteClientCognitoUser = async (username: string): Promise<void> => {
  await clientPool.send(
    new AdminDeleteUserCommand({
      UserPoolId: config.clientCognito.userPoolId,
      // Caller passes whatever was used as Username at creation time
      // (phone with spaces stripped for admin-created users; email for self-signup users)
      Username: username.replace(/\s+/g, ""),
    }),
  )
}

/**
 * Self-signup against the client pool — used by the public POST /auth/signup endpoint.
 *
 * Uses Cognito's unauthenticated `SignUp` API (not AdminCreateUser): the user picks their
 * own password, Cognito emails them a verification code, and they confirm via
 * ConfirmSignUp (called from the frontend directly with the same ClientId).
 *
 * Returns the new user's `sub` (used as the PK in our users table).
 *
 * Username choice: we pass `email` as Username because email is the auto-verified attribute
 * on this pool. Phone goes in as an attribute. Both phone and email then work as login
 * aliases since the pool's UsernameAttributes = [phone_number, email].
 */
export const clientSignUp = async (
  email: string,
  password: string,
  fullName: string,
  phone: string,
): Promise<string> => {
  // Strip whitespace from phone — Cognito phone_number requires E.164 with no spaces
  const cleanPhone = phone.replace(/\s+/g, "")

  const result = await clientPool.send(
    new SignUpCommand({
      ClientId: config.clientCognito.clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "name", Value: fullName },
        { Name: "email", Value: email },
        { Name: "phone_number", Value: cleanPhone },
      ],
    }),
  )

  if (!result.UserSub) throw new Error("Cognito SignUp succeeded but did not return UserSub")
  return result.UserSub
}

export const updateClientCognitoUserAttributes = async (
  phone: string, // DB phone (may have spaces) — normalized to match Cognito username
  attrs: { fullName?: string; phone?: string; email?: string },
): Promise<void> => {
  const userAttributes: { Name: string; Value: string }[] = []
  if (attrs.fullName !== undefined) userAttributes.push({ Name: "name", Value: attrs.fullName })
  // Strip spaces from new phone value too — phone_number attribute requires E.164 format
  if (attrs.phone !== undefined) userAttributes.push({ Name: "phone_number", Value: attrs.phone.replace(/\s+/g, "") })
  if (attrs.email !== undefined) {
    userAttributes.push({ Name: "email", Value: attrs.email })
    userAttributes.push({ Name: "email_verified", Value: "true" })
  }
  if (userAttributes.length === 0) return

  await clientPool.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: config.clientCognito.userPoolId,
      Username: phone.replace(/\s+/g, ""), // normalize to match how user was created
      UserAttributes: userAttributes,
    }),
  )
}
