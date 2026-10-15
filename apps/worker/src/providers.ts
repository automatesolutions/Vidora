import type { TokenKey } from "@vidora/core"
import { readHiggsfieldTokens, readProviderSecret, saveRefreshedHiggsfieldTokens, type Db, type ProviderCredential } from "@vidora/db"
import { accessTokenSource, HiggsfieldMcpProvider, HiggsfieldProvider, type VideoProvider } from "@vidora/providers"

// Which provider a stored credential drives: a developer API key, or a "Connect Higgsfield" sign-in
// (plan credits through Higgsfield's MCP server, tokens refreshed and saved as they rotate).
export function providerForCredential(db: Db, keys: readonly TokenKey[], credential: ProviderCredential): VideoProvider {
  if (credential.provider === "higgsfield_mcp") {
    const tokens = readHiggsfieldTokens(credential, keys)
    return new HiggsfieldMcpProvider({ accessToken: accessTokenSource(tokens, (t) => saveRefreshedHiggsfieldTokens(db, keys, credential.id, t)) })
  }
  return new HiggsfieldProvider({ credentials: readProviderSecret(credential, keys) })
}
