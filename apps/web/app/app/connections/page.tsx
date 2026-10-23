import { CircleCheck } from "lucide-react"
import { Suspense } from "react"
import { accountForDisplay, getDb, listAccounts } from "@vidora/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PlatformIcon, type Platform } from "@/components/vidora/platform-chip"
import { requireSession } from "@/lib/server/session"

// Connections: where Shorts post (YouTube now; TikTok and Facebook Reels next). The video engine is
// configured on the server (HF_CREDENTIALS, PLATFORM_WORKSPACE_ID) and never shown in the app.

const CONNECT_MESSAGES: Record<string, { tone: "success" | "danger"; title: string; body: string }> = {
  "higgsfield=connected": { tone: "success", title: "Video engine connected", body: "Every campaign makes its videos with this account now." },
  "higgsfield=denied": { tone: "danger", title: "The video engine wasn't connected", body: "The sign-in was canceled. Connect again when you're ready." },
  "higgsfield=unavailable": { tone: "danger", title: "The video engine's sign-in isn't responding", body: "Try again in a minute." },
  "higgsfield=forbidden": { tone: "danger", title: "You can't connect the video engine", body: "Ask a workspace owner or admin to connect it." },
  "higgsfield=failed": { tone: "danger", title: "The video engine wasn't connected", body: "Something went wrong on the way back from the sign-in. Try connecting again." },
  "connected=1": { tone: "success", title: "Channel connected", body: "Campaigns can post to it now." },
  "connect=denied": { tone: "danger", title: "YouTube wasn't connected", body: "Google sign-in was canceled. Connect again when you're ready." },
  "connect=missing_scope": {
    tone: "danger",
    title: "YouTube wasn't connected",
    body: "Google asked which permissions to give, and the YouTube boxes weren't ticked. Connect again and tick both YouTube permissions.",
  },
  "connect=no_channel": { tone: "danger", title: "No YouTube channel found", body: "That Google account doesn't have a channel yet. Create one on YouTube, then connect again." },
  "connect=api_disabled": {
    tone: "danger",
    title: "YouTube isn't available right now",
    body: "We couldn't reach YouTube for your channel. Try again in a few minutes.",
  },
  "connect=not_configured": { tone: "danger", title: "YouTube isn't available yet", body: "Try again later." },
  "connect=forbidden": { tone: "danger", title: "You can't connect channels", body: "Ask a workspace owner or admin to connect YouTube." },
  "connect=failed": { tone: "danger", title: "YouTube wasn't connected", body: "Something went wrong on the way back from Google. Try connecting again." },
}

export default function ConnectionsPage({ searchParams }: PageProps<"/app/connections">) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">Connections</h1>
        <p className="text-body-md text-muted-foreground">Where your Shorts post. We make the videos; you choose the channels.</p>
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
  const accounts = await listAccounts(getDb(), s.workspaceId)

  return (
    <>
      {notice && (
        <InlineAlert tone={notice.tone} title={notice.title}>
          {notice.body}
        </InlineAlert>
      )}

      <section aria-labelledby="yt-title" className="flex flex-col gap-6 rounded-md bg-card p-6">
        <div className="flex flex-col gap-1">
          <h2 id="yt-title" className="flex items-center gap-2 text-display-xs">
            <PlatformIcon platform="youtube" className="size-5" />
            YouTube Shorts
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

      <ComingSoon platform="tiktok" title="TikTok" body="Post the same Shorts to your TikTok account, with TikTok's privacy and comment settings." />
      <ComingSoon platform="facebook" title="Facebook Reels" body="Post the same Shorts as Reels on your Facebook Page." />

    </>
  )
}

function ComingSoon({ platform, title, body }: { platform: Platform; title: string; body: string }) {
  const id = `${platform}-title`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-md bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="flex items-center gap-2 text-display-xs">
            <PlatformIcon platform={platform} className="size-5" />
            {title}
          </h2>
          <p className="text-body-sm text-muted-foreground">{body}</p>
        </div>
        <Badge variant="outline">Coming soon</Badge>
      </div>
      <div>
        <Button variant="secondary" disabled>
          Connect {title}
        </Button>
      </div>
    </section>
  )
}
