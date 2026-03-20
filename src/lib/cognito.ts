import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
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
