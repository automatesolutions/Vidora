import { SearchX } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/vidora/empty-state"

export default function AppNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="We couldn't find that page"
      body="It may have been deleted, or it belongs to another workspace."
      action={
        <Button variant="secondary" asChild>
          <Link href="/app">Go to the dashboard</Link>
        </Button>
      }
      className="mx-auto max-w-2xl"
    />
  )
}
