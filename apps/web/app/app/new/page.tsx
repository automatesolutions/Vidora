import type { Metadata } from "next"
import { Suspense } from "react"
import { getBrandKit, getCredits, getDb, getUpload, getWorkspace } from "@vidora/db"
import { Skeleton } from "@/components/ui/skeleton"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { Wizard } from "./wizard"

export const metadata: Metadata = { title: "New video" }

export default function NewVideoPage() {
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <NewVideo />
    </Suspense>
  )
}

async function NewVideo() {
  const s = await requireSession("/app/new")
  const db = getDb()
  const [workspace, credits, kit] = await Promise.all([getWorkspace(db, s.workspaceId), getCredits(db, s.workspaceId), getBrandKit(db, s.workspaceId)])
  const logo = kit?.logoUploadId ? await getUpload(db, s.workspaceId, kit.logoUploadId) : null
  return (
    <Wizard
      email={s.email}
      emailVerified={s.emailVerified}
      knownKind={workspace?.kind ?? null}
      available={credits.available}
      freeVideoAvailable={!workspace?.freeVideoUsedAt}
      brandKit={
        kit
          ? {
              logo: logo?.status === "ready" ? { id: logo.id, name: "Logo", previewUrl: await getStorage().presignGet(logo.storageKey) } : null,
              colors: kit.colors,
              endCardText: kit.endCardText ?? "",
            }
          : null
      }
    />
  )
}

function WizardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Skeleton className="h-4 w-40 bg-muted" />
      <Skeleton className="h-10 w-3/4 bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 bg-muted" />
        ))}
      </div>
    </div>
  )
}
