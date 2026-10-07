import type { Metadata } from "next"
import { A, LegalPage, type LegalSection } from "@/components/vidora/legal-page"
import { SiteValue } from "@/components/vidora/site-chrome"

// DRAFT. Written to cover Google API Services User Data Policy, YouTube API Services Developer Policies,
// and TikTok Developer Terms disclosure points. Needs a lawyer's review before launch (docs/platform-applications.md).
export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Vidora collects, how we use it, and the choices you have.",
}

const sections: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <p>
        Vidora is a service run by <SiteValue field="legalName" />, <SiteValue field="address" /> (“Vidora”, “we”, “us”). It
        makes videos for your YouTube and TikTok accounts and posts the ones you approve. Questions about this policy go to{" "}
        <SiteValue field="privacyEmail" />.
      </p>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address, and password (stored as a one-way hash), or the
            basic profile from the sign-in provider you choose.
          </li>
          <li>
            <strong>Workspace content:</strong> your content strategies (niche, audience, tone, schedule), video briefs,
            scripts, captions, hashtags, review decisions, and the feedback you write.
          </li>
          <li>
            <strong>YouTube data:</strong> your channel ID, channel name, and channel picture; access and refresh tokens that
            let us upload videos you approve; the IDs and links of videos we post; and public statistics for those videos
            (views, likes, comments).
          </li>
          <li>
            <strong>TikTok data:</strong> your TikTok account ID, display name, and avatar; access and refresh tokens; the
            posting options TikTok offers for your account; the IDs and status of videos we post; and their public
            statistics.
          </li>
          <li>
            <strong>Generated media:</strong> the scripts, voiceovers, images, video clips, captions, thumbnails, and final
            videos made for you.
          </li>
          <li>
            <strong>Billing details:</strong> your plan, invoices, and credit usage. Our payment processor, Stripe, handles
            your card. We never see or store full card numbers.
          </li>
          <li>
            <strong>Technical data:</strong> IP address, browser type, device type, and logs of requests and errors, which
            we use to run and secure the service.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use your information",
    body: (
      <ul>
        <li>To make videos based on your strategy and feedback.</li>
        <li>To post a video to YouTube or TikTok only after you approve it, at the time you choose.</li>
        <li>To show your connected accounts, your post history, and how your posts perform.</li>
        <li>To send you emails and in-app notices, such as “a new video is ready for review”.</li>
        <li>To bill you, track credits, and prevent fraud and abuse.</li>
        <li>To keep the service secure, fix problems, and improve it using aggregated, non-identifying data.</li>
      </ul>
    ),
  },
  {
    id: "google-youtube",
    title: "YouTube and Google data",
    body: (
      <>
        <p>
          Vidora uses YouTube API Services. By connecting a YouTube channel, you agree to the{" "}
          <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>, and Google’s handling of your data is
          covered by the <A href="https://policies.google.com/privacy">Google Privacy Policy</A>.
        </p>
        <p>
          Vidora’s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
          <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>,
          including the Limited Use requirements.
        </p>
        <ul>
          <li>We use Google user data only to provide and improve the Vidora features you use.</li>
          <li>We don’t sell Google user data, and we don’t use it for advertising.</li>
          <li>We don’t use Google user data to train or improve AI or machine learning models, ours or anyone else’s.</li>
          <li>No person at Vidora reads your Google user data unless you ask us to, it’s needed for security, or the law requires it.</li>
          <li>We refresh or delete the YouTube data we store at least every 30 days.</li>
        </ul>
        <p>
          You can remove Vidora’s access at any time in Vidora (Settings, then Accounts, then Disconnect) or on your{" "}
          <A href="https://security.google.com/settings/security/permissions">Google security settings page</A>.
        </p>
      </>
    ),
  },
  {
    id: "tiktok",
    title: "TikTok data",
    body: (
      <p>
        We use TikTok data only to post the videos you approve, with the privacy and interaction settings you choose, and to
        show their status and statistics in Vidora. We don’t sell TikTok data or use it to train AI models. You can remove
        access in Vidora or in the TikTok app under Settings and privacy, then Security and permissions, then Apps and
        services permissions.
      </p>
    ),
  },
  {
    id: "ai",
    title: "AI processing",
    body: (
      <>
        <p>
          To make your videos, we send AI providers the text needed for each step: your strategy, the topic, the script, and
          your feedback. They return scripts, voiceovers, images, and video clips. We don’t send AI providers your YouTube or
          TikTok tokens, statistics, or account details.
        </p>
        <p>
          We choose providers whose terms don’t allow them to train their models on the data we send. Every video Vidora
          posts is labeled as AI-generated on YouTube and TikTok.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share data with",
    body: (
      <>
        <p>We share data only with service providers that help us run Vidora, under contracts that limit their use of it:</p>
        <ul>
          <li>Hosting and databases: Vercel, Hetzner, Neon</li>
          <li>File storage: Cloudflare (R2)</li>
          <li>AI providers: Anthropic (scripts), ElevenLabs (voice), and video and image model providers through fal.ai or Kie.ai</li>
          <li>Payments: Stripe</li>
          <li>Email: Resend</li>
          <li>Error tracking and product analytics: Sentry, PostHog</li>
          <li>YouTube and TikTok, when we post a video you approved</li>
        </ul>
        <p>
          We may also share data if the law requires it, to protect people’s safety, or as part of a merger or sale, in which
          case this policy keeps applying to your data. We don’t sell personal information.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect your data",
    body: (
      <p>
        We encrypt data in transit (TLS) and at rest. YouTube and TikTok tokens are encrypted again with AES-256 before we
        store them, and only the service that posts your videos can decrypt them. Access to production systems is limited to
        the people who run Vidora and protected with two-factor authentication.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: (
      <ul>
        <li>When you disconnect a YouTube or TikTok account, we delete its tokens right away.</li>
        <li>We refresh or delete stored YouTube data at least every 30 days.</li>
        <li>Rejected videos and their files are deleted after 30 days.</li>
        <li>
          When you delete your workspace or account, we delete its data within 30 days. Backups that contain it are
          overwritten within another 30 days.
        </li>
        <li>We keep billing records for as long as tax law requires.</li>
      </ul>
    ),
  },
  {
    id: "your-choices",
    title: "Your rights and choices",
    body: (
      <>
        <p>
          You can view and edit your information in Vidora, disconnect accounts, export your videos, and delete your account.
          Depending on where you live, you may also have the right to request a copy of your data, correct it, delete it,
          limit or object to how we use it, or complain to your data protection authority.
        </p>
        <p>
          To make a request, email <SiteValue field="privacyEmail" />. We answer within 30 days.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use cookies that keep you signed in and remember your settings, such as light or dark mode. If we add analytics
        cookies, we’ll ask for your consent first where the law requires it.
      </p>
    ),
  },
  {
    id: "age",
    title: "Age requirement",
    body: <p>Vidora is for people aged 18 or older. We don’t knowingly collect data from children.</p>,
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        Our providers may process data outside your country. When they do, we rely on safeguards such as the European
        Commission’s Standard Contractual Clauses.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy in a way that matters, we’ll email you before the change takes effect. The date at the top
        shows the latest version.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        <SiteValue field="legalName" />, <SiteValue field="address" />. Email: <SiteValue field="privacyEmail" />.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <p>
          This policy explains what Vidora collects, how we use it, and the choices you have. The short version: we use your
          data to make and post the videos you approve, we never sell it, and we don’t use your YouTube or TikTok data to
          train AI models.
        </p>
      }
      sections={sections}
    />
  )
}
