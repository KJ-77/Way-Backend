import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { decodeDbError } from "./dbError"

const client = new LambdaClient({ region: process.env.AWS_REGION || "eu-west-3" })

// Invoke another Lambda function synchronously and return parsed response
export const invokeLambda = async <T = unknown>(
  functionName: string,
  payload: unknown,
): Promise<T> => {
  const result = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  )

  if (result.FunctionError) {
    const errorPayload = result.Payload
      ? JSON.parse(Buffer.from(result.Payload).toString())
      : { message: "Lambda invocation failed" }

    const message = errorPayload.errorMessage || errorPayload.message || "Lambda invocation failed"

    // Rehydrate pg metadata (code/constraint/detail) when the callee encoded it.
    // Lambda's error serialization drops custom properties, so without this a
    // unique-constraint violation is indistinguishable from any other failure and
    // handleError() can only answer with a generic 500. See lib/dbError.ts.
    const decoded = decodeDbError(message)
    if (decoded) throw decoded

    throw new Error(message)
  }

  if (!result.Payload) return null as T
  return JSON.parse(Buffer.from(result.Payload).toString()) as T
}
