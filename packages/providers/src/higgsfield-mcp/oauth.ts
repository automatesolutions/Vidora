import {
  discoverAuthorizationServerMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js"

// "Connect Higgsfield": sign in with a Higgsfield account through Higgsfield's MCP server, so the app
// generates with the account's plan credits instead of a prepaid API key. Standard OAuth 2.1:
// dynamic client registration, authorization code + PKCE, refresh tokens (offline_access).
// Endpoints come from https://mcp.higgsfield.ai/.well-known/oauth-authorization-server (checked 2026-10-15).

export const HF_MCP_URL = "https://mcp.higgsfield.ai/mcp"
export const HF_AUTH_SERVER = "https://mcp.higgsfield.ai"
export const HF_SCOPE = "openid email offline_access"

/** What we store (encrypted) for a connected Higgsfield account. */
export type HiggsfieldTokens = {
  clientId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null // ms since epoch
}

let metadataCache: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>> | undefined
async function metadata() {
  metadataCache ??= await discoverAuthorizationServerMetadata(HF_AUTH_SERVER)
  if (!metadataCache) throw new Error("Higgsfield's sign-in server didn't publish its settings.")
  return metadataCache
}

/** Registers this app with Higgsfield's sign-in server for one redirect URL. Store the result and reuse it. */
export async function registerApp(redirectUri: string, appName: string): Promise<{ clientId: string }> {
  const info = await registerClient(HF_AUTH_SERVER, {
    metadata: await metadata(),
    clientMetadata: {
      client_name: appName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: HF_SCOPE,
    },
  })
  return { clientId: info.client_id }
}

/** The Higgsfield sign-in URL to send the user to, plus the PKCE verifier to keep until the callback. */
export async function authorizationUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const { authorizationUrl, codeVerifier } = await startAuthorization(HF_AUTH_SERVER, {
    metadata: await metadata(),
    clientInformation: { client_id: input.clientId, redirect_uris: [input.redirectUri] },
    redirectUrl: input.redirectUri,
    scope: HF_SCOPE,
    state: input.state,
    resource: new URL(HF_MCP_URL),
  })
  return { url: authorizationUrl.toString(), codeVerifier }
}

function toTokens(clientId: string, t: { access_token: string; refresh_token?: string; expires_in?: number }, previousRefresh: string | null = null): HiggsfieldTokens {
  return {
    clientId,
    accessToken: t.access_token,
    // Some servers don't rotate refresh tokens; keep the old one when no new one comes back.
    refreshToken: t.refresh_token ?? previousRefresh,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : null,
  }
}

export async function exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<HiggsfieldTokens> {
  const t = await exchangeAuthorization(HF_AUTH_SERVER, {
    metadata: await metadata(),
    clientInformation: { client_id: input.clientId, redirect_uris: [input.redirectUri] },
    authorizationCode: input.code,
    codeVerifier: input.codeVerifier,
    redirectUri: input.redirectUri,
    resource: new URL(HF_MCP_URL),
  })
  return toTokens(input.clientId, t)
}

export async function refreshTokens(tokens: HiggsfieldTokens): Promise<HiggsfieldTokens> {
  if (!tokens.refreshToken) throw new Error("The Higgsfield sign-in expired. Connect Higgsfield again.")
  const t = await refreshAuthorization(HF_AUTH_SERVER, {
    metadata: await metadata(),
    clientInformation: { client_id: tokens.clientId },
    refreshToken: tokens.refreshToken,
    resource: new URL(HF_MCP_URL),
  })
  return toTokens(tokens.clientId, t, tokens.refreshToken)
}

/** True when the access token is missing or expires within the next minute. */
export function needsRefresh(tokens: HiggsfieldTokens, now = Date.now()) {
  return !tokens.accessToken || (tokens.expiresAt !== null && tokens.expiresAt - now < 60_000)
}

/**
 * Access-token source for HiggsfieldMcpProvider: refreshes when the token is about to expire and
 * hands the new tokens to `save` (store them encrypted), so every caller shares one refresh path.
 */
export function accessTokenSource(initial: HiggsfieldTokens, save: (tokens: HiggsfieldTokens) => Promise<void>) {
  let current = initial
  let refreshing: Promise<HiggsfieldTokens> | null = null
  return async () => {
    if (needsRefresh(current)) {
      refreshing ??= refreshTokens(current).then(async (t) => {
        await save(t)
        return t
      })
      try {
        current = await refreshing
      } finally {
        refreshing = null
      }
    }
    return current.accessToken
  }
}
