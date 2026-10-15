import Link from "next/link"
import { Logo } from "@/components/vidora/logo"

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="safe-x flex min-h-full flex-col items-center px-4 py-10">
      <Link href="/" aria-label="Vidora home" className="mb-10 inline-flex min-h-11 items-center rounded-sm">
        <Logo width={120} priority />
      </Link>
      <main id="main" className="w-full max-w-md">
        {children}
      </main>
    </div>
  )
}
