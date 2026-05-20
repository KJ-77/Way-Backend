import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda"
import { CognitoJwtVerifier } from "aws-jwt-verify"

// Pool configs come from a single JSON env var so the authorizer stays project-agnostic.
// Format: JWT_POOLS='[{"userPoolId":"...","clientId":"...","label":"admin"},...]'
// `label` is surfaced to handlers as `source_pool` (e.g. "admin" | "client") so
// downstream code can branch without coupling to specific pool IDs.
interface PoolConfig {
  userPoolId: string
  clientId: string
  label: string
}

const POOLS: PoolConfig[] = JSON.parse(process.env.JWT_POOLS || "[]")

// One verifier per pool, built at module load. Each verifier lazily fetches its
// JWKS on first use and caches it in memory, so warm invocations skip the network.
const verifiers = POOLS.map((p) => ({
  label: p.label,
  verifier: CognitoJwtVerifier.create({
    userPoolId: p.userPoolId,
    tokenUse: "id", // ID token — has email/name; switch to "access" if we ever need scopes
    clientId: p.clientId,
  }),
}))

interface SimpleResponse {
  isAuthorized: boolean
  context?: Record<string, string>
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<SimpleResponse> => {
  // API Gateway v2 lowercases header names but we still tolerate the canonical casing
  const auth = event.headers?.authorization || event.headers?.Authorization
  const token = auth?.replace(/^Bearer\s+/i, "").trim()

  if (!token) return { isAuthorized: false }

  // Try each configured pool in order. The first verifier to accept the token wins.
  // verify() throws on signature/issuer/audience/expiry mismatch, so we just swallow
  // and move on to the next pool.
  for (const { label, verifier } of verifiers) {
    try {
      const payload = await verifier.verify(token)
      const groups = payload["cognito:groups"] ?? []
      return {
        isAuthorized: true,
        context: {
          // simpleResponse context must be string-valued — flatten everything
          sub: String(payload.sub),
          email: String(payload.email ?? payload["cognito:username"] ?? ""),
          groups: Array.isArray(groups) ? groups.join(",") : String(groups),
          source_pool: label,
        },
      }
    } catch {
      // token didn't match this pool — try the next
    }
  }

  return { isAuthorized: false }
}
