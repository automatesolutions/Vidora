import { getDb, getHiggsfieldConnection, getProviderCredential, listAccounts } from "@vidora/db"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { requireSession } from "@/lib/server/session"
import { NewCampaignWizard } from "./wizard"

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[600px] w-full max-w-2xl bg-muted" />}>
      <Wizard />
    </Suspense>
  )
}

async function Wizard() {
  const s = await requireSession("/app/campaigns/new")
  const db = getDb()
  const [accounts, plan, apiKey] = await Promise.all([listAccounts(db, s.workspaceId), getHiggsfieldConnection(db, s.workspaceId), getProviderCredential(db, s.workspaceId)])
  return (
    <NewCampaignWizard
      channels={accounts.filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.displayName }))}
      planConnected={!!plan || apiKey?.status === "valid"}
    />
  )
}
