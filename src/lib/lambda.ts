import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"

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
    throw new Error(errorPayload.errorMessage || errorPayload.message || "Lambda invocation failed")
  }

  if (!result.Payload) return null as T
  return JSON.parse(Buffer.from(result.Payload).toString()) as T
}
