import { CircleAlert, CircleCheck, Clapperboard, KeyRound } from "lucide-react"
import { Suspense } from "react"
import { accountForDisplay, creditsChargedSince, credentialForDisplay, getDb, getHiggsfieldConnection, getProviderCredential, listAccounts } from "@vidora/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PlatformIcon } from "@/components/vidora/platform-chip"
import { higgsfieldPlanStatus } from "@/lib/server/higgsfield"
import { requireSession } from "@/lib/server/session"
import { BalanceForm, DisconnectHiggsfieldButton, HiggsfieldKeyForm, RemoveKeyButton } from "./forms"

// Connections: the Higgsfield API key (makes the videos) and the YouTube channels (where they post).

const CONNECT_MESSAGES: Record<string, { tone: "success" | "danger"; title: string; body: string }> = {
  "higgsfield=connected": { tone: "success", title: "Higgsfield connected", body: "Campaigns can make videos with your plan credits now." },
  "higgsfield=denied": { tone: "danger", title: "Higgsfield wasn't connected", body: "The Higgsfield sign-in was canceled. Connect again when you're ready." },
  "higgsfield=unavailable": { tone: "danger", title: "Higgsfield's sign-in isn't responding", body: "Try again in a minute." },
  "higgsfield=forbidden": { tone: "danger", title: "You can't connect Higgsfield", body: "Ask a workspace owner or admin to connect it." },
  "higgsfield=failed": { tone: "danger", title: "Higgsfield wasn't connected", body: "Something went wrong on the way back from Higgsfield. Try connecting again." },
  "higgsfield=disconnected": { tone: "success", title: "Higgsfield disconnected", body: "Campaigns stop making videos until you connect again." },
  "connected=1": { tone: "success", title: "Channel connected", body: "Campaigns can post to it now." },
  "connect=denied": { tone: "danger", title: "YouTube wasn't connected", body: "Google sign-in was canceled. Connect again when you're ready." },
  "connect=missing_scope": {
    tone: "danger",
    title: "YouTube wasn't connected",
    body: "We need permission to upload videos. Connect again and leave the upload box checked.",
  },
  "connect=no_channel": { tone: "danger", title: "No YouTube channel found", body: "That Google account doesn't have a channel yet. Create one on YouTube, then connect again." },
  "connect=not_configured": { tone: "danger", title: "YouTube isn't set up yet", body: "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env." },
  "connect=forbidden": { tone: "danger", title: "You can't connect channels", body: "Ask a workspace owner or admin to connect YouTube." },
  "connect=failed": { tone: "danger", title: "YouTube wasn't connected", body: "Something went wrong on the way back from Google. Try connecting again." },
}

export default function ConnectionsPage({ searchParams }: PageProps<"/app/connections">) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">Connections</h1>
        <p className="text-body-md text-muted-foreground">Higgsfield makes your videos. YouTube is where they post.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full bg-muted" />}>
        <Connections searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Connections({ searchParams }: { searchParams: PageProps<"/app/connections">["searchParams"] }) {
  const s = await requireSession("/app/connections")
  const params = await searchParams
  const notice = Object.entries(params)
    .map(([k, v]) => CONNECT_MESSAGES[`${k}=${String(v)}`])
    .find(Boolean)

  const db = getDb()
  const [credential, connection, accounts] = await Promise.all([
    getProviderCredential(db, s.workspaceId),
    getHiggsfieldConnection(db, s.workspaceId),
    listAccounts(db, s.workspaceId),
  ])
  const key = credential ? credentialForDisplay(credential) : null
  const plan = connection ? await higgsfieldPlanStatus(db, connection) : null
  // Estimated API balance: what the user entered, minus what we've been charged since.
  const estimated =
    key?.balanceCredits != null && key.balanceUpdatedAt ? key.balanceCredits - (await creditsChargedSince(db, s.workspaceId, key.balanceUpdatedAt)) : null

  return (
    <>
      {notice && (
        <InlineAlert tone={notice.tone} title={notice.title}>
          {notice.body}
        </InlineAlert>
      )}

      <section aria-labelledby="hf-title" className="flex flex-col gap-6 rounded-md bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="hf-title" className="flex items-center gap-2 text-display-xs">
              <Clapperboard aria-hidden className="size-5" strokeWidth={1.75} />
              Higgsfield
            </h2>
            <p className="text-body-sm text-muted-foreground">
              Sign in with your Higgsfield account. Videos are made with your plan&apos;s credits, and you can disconnect any time.
            </p>
          </div>
          {connection && plan?.ok && (
            <Badge variant="outline" className="gap-1.5">
              <CircleCheck aria-hidden className="size-4 text-success" strokeWidth={1.75} />
              Connected{plan.plan ? ` · ${plan.plan} plan` : ""}
            </Badge>
          )}
        </div>

        {connection && plan?.ok && (
          <p className="text-body-sm text-foreground">
            Plan credits left: <span className="tabular text-body-sm-strong">{formatCredits(plan.credits)}</span>
          </p>
        )}
        {connection && plan && !plan.ok && (
          <InlineAlert title="We couldn't reach your Higgsfield account">{plan.error} Connect again to fix it.</InlineAlert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href="/api/connect/higgsfield/start">{connection ? "Connect again" : "Connect Higgsfield"}</a>
          </Button>
          {connection && <DisconnectHiggsfieldButton />}
        </div>

        <details className="group border-t border-border pt-6" open={!!key}>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-body-sm-strong text-foreground">
            <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
            Use a developer API key instead
            {key && <KeyStatus status={key.status} hint={key.keyHint} />}
          </summary>
          <div className="flex flex-col gap-6 pt-4">
            <p className="text-body-sm text-muted-foreground">
              For automated campaigns at scale. API credits are prepaid separately at console.higgsfield.ai; your plan credits don&apos;t apply.
            </p>
            {key?.status === "invalid" && key.lastError && <InlineAlert title="Higgsfield rejected this key">{key.lastError}</InlineAlert>}
            <HiggsfieldKeyForm hasKey={!!key} />
            {key && (
              <div className="flex flex-col gap-4 border-t border-border pt-6">
                {estimated !== null && (
                  <p className="text-body-sm text-foreground">
                    Estimated API balance: <span className="tabular text-body-sm-strong">{formatCredits(estimated)} credits</span>
                  </p>
                )}
                <BalanceForm current={key.balanceCredits} />
                <div>
                  <RemoveKeyButton />
                </div>
              </div>
            )}
          </div>
        </details>
      </section>

      <section aria-labelledby="yt-title" className="flex flex-col gap-6 rounded-md bg-card p-6">
        <div className="flex flex-col gap-1">
          <h2 id="yt-title" className="flex items-center gap-2 text-display-xs">
            <PlatformIcon platform="youtube" className="size-5" />
            YouTube channels
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Shorts upload as private with a publish time, then go live on schedule. Every upload is labeled as AI-generated.
          </p>
        </div>
        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {accounts.map((a) => {
              const acc = accountForDisplay(a)
              return (
                <li key={acc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background p-4">
                  <div className="flex flex-col">
                    <span className="text-body-sm-strong text-foreground">{acc.displayName}</span>
                    {acc.handle && <span className="text-body-sm text-muted-foreground">{acc.handle}</span>}
                  </div>
                  {acc.status === "active" ? (
                    <Badge variant="outline" className="gap-1.5">
                      <CircleCheck aria-hidden className="size-4 text-success" strokeWidth={1.75} />
                      Connected
                    </Badge>
                  ) : (
                    <Button variant="tertiary" size="sm" asChild>
                      <a href="/api/connect/youtube/start">Reconnect {acc.displayName}</a>
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-body-sm text-muted-foreground">No channels yet. Connect one so campaigns have somewhere to post.</p>
        )}
        <div>
          <Button variant="secondary" asChild>
            <a href="/api/connect/youtube/start">{accounts.length ? "Connect another channel" : "Connect YouTube"}</a>
          </Button>
        </div>
      </section>
    </>
  )
}

function KeyStatus({ status, hint }: { status: "unverified" | "valid" | "invalid"; hint: string }) {
  if (status === "valid")
    return (
      <Badge variant="outline" className="gap-1.5">
        <CircleCheck aria-hidden className="size-4 text-success" strokeWidth={1.75} />
        Working · key ending {hint}
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1.5">
      <CircleAlert aria-hidden className={status === "invalid" ? "size-4 text-danger" : "size-4 text-warning"} strokeWidth={1.75} />
      {status === "invalid" ? "Rejected" : "Not checked yet"} · key ending {hint}
    </Badge>
  )
}

const formatCredits = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n)
