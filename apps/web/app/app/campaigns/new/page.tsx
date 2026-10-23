import { getDb, listAccounts } from "@vidora/db"
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
  const accounts = await listAccounts(getDb(), s.workspaceId)
  return <NewCampaignWizard channels={accounts.filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.displayName }))} />
}
