import type { Metadata } from "next"
import Link from "next/link"
import { A, LegalPage, type LegalSection } from "@/components/vidora/legal-page"
import { SiteValue } from "@/components/vidora/site-chrome"

// DRAFT. Needs a lawyer's review before launch (docs/platform-applications.md).
export const metadata: Metadata = {
  title: "Terms of service",
  description: "The rules for using Vidora.",
}

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement",
    body: (
      <p>
        These terms are an agreement between you and <SiteValue field="legalName" /> (“Vidora”, “we”, “us”). By creating an
        account or using Vidora, you agree to them. If you use Vidora for a company, you confirm you can accept these terms
        for it.
      </p>
    ),
  },
  {
    id: "service",
    title: "What Vidora does",
    body: (
      <p>
        Vidora makes videos with AI based on the strategy you set, shows them to you for review, and posts the ones you
        approve to the YouTube and TikTok accounts you connect. Nothing is posted until you approve it.
      </p>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use Vidora",
    body: (
      <p>
        You must be 18 or older and able to form a binding contract. You’re responsible for your account, for keeping your
        password safe, and for what people you invite to your workspace do there.
      </p>
    ),
  },
  {
    id: "platforms",
    title: "YouTube and TikTok",
    body: (
      <>
        <p>
          When you connect a channel, you allow Vidora to post on your behalf. You must follow the{" "}
          <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>, YouTube’s Community Guidelines, and{" "}
          <A href="https://www.tiktok.com/legal/page/global/terms-of-service/en">TikTok’s Terms of Service</A> and Community
          Guidelines. Their decisions about your content or account, including removal, limits, and monetization, are theirs
          and not ours.
        </p>
        <p>
          Vidora labels every posted video as AI-generated, using each platform’s disclosure setting. You agree not to remove
          or hide these labels.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content and AI output",
    body: (
      <>
        <p>
          You keep the rights you have in what you give us, such as strategies, feedback, and uploads. As between you and us,
          you own the videos Vidora makes for you, to the extent the law allows. Copyright protection for AI-generated
          material is limited in some countries.
        </p>
        <p>
          You give us a limited license to store, process, and post your content only to run Vidora for you. This license ends
          when you delete the content, except for copies we must keep by law.
        </p>
        <p>
          AI output can be wrong, can look like other people’s work, or can be unsuitable for your audience. Review every
          video before you approve it. You’re responsible for the videos you approve.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "What you can’t do",
    body: (
      <>
        <p>Don’t use Vidora to make or post content that:</p>
        <ul>
          <li>Shows or imitates a real person’s face, body, or voice without their written permission</li>
          <li>Deceives people about real events, elections, health, or finance</li>
          <li>Infringes copyright, trademarks, or other rights, including music you don’t have a license for</li>
          <li>Harasses, threatens, or sexualizes anyone, or involves minors in any sexual or harmful way</li>
          <li>Is spam, or is mass-produced in a way the platforms prohibit</li>
          <li>Breaks the law or the rules of YouTube or TikTok</li>
        </ul>
        <p>
          Also don’t try to break, overload, or reverse engineer Vidora, or resell it without our written permission. We may
          remove content or suspend accounts that break these rules.
        </p>
      </>
    ),
  },
  {
    id: "billing",
    title: "Plans, credits, and payment",
    body: (
      <>
        <ul>
          <li>Paid plans renew each month until you cancel. Stripe processes payments.</li>
          <li>Each plan includes monthly credits. Plan credits reset at the start of each billing period and don’t roll over.</li>
          <li>Top-up credits last 12 months from purchase.</li>
          <li>If a video fails to generate, we return the credits it reserved.</li>
          <li>Each video includes two free change requests. Later changes use credits, and we show the cost before you confirm.</li>
          <li>
            You can cancel at any time. Your plan stays active until the end of the period you paid for. Except where the law
            says otherwise, payments aren’t refundable.
          </li>
          <li>We’ll tell you at least 30 days before a price change affects you.</li>
        </ul>
      </>
    ),
  },
  {
    id: "our-service",
    title: "Our service and changes",
    body: (
      <p>
        Vidora, including its software, design, and brand, belongs to us. We may change or stop features. If we stop a paid
        feature you rely on, we’ll tell you in advance and refund any prepaid amount for it.
      </p>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p>
        Vidora depends on services we don’t control, such as YouTube, TikTok, AI providers, and Stripe. We aren’t responsible
        for their availability or decisions, including API limits, audits, or changes to their rules.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        Vidora is provided “as is”. To the extent the law allows, we disclaim all warranties, including fitness for a
        particular purpose. We don’t promise any number of views, followers, or earnings, or that a platform will accept or
        monetize your videos.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the extent the law allows, we aren’t liable for indirect or consequential losses, such as lost profits or a
        suspended channel. Our total liability for any claim is limited to the amount you paid us in the 12 months before the
        claim. Nothing here limits liability that can’t be limited by law.
      </p>
    ),
  },
  {
    id: "indemnity",
    title: "Your responsibility for claims",
    body: (
      <p>
        If someone makes a claim against us because of content you approved or your breach of these terms, you agree to cover
        our reasonable costs of that claim, to the extent the law allows.
      </p>
    ),
  },
  {
    id: "ending",
    title: "Ending the agreement",
    body: (
      <p>
        You can stop using Vidora and delete your account at any time. We may suspend or end your access if you seriously or
        repeatedly break these terms, or if the law requires it. After your account ends, we delete your data as described in
        our{" "}
        <Link href="/legal/privacy" className="text-primary-text underline underline-offset-4 hover:no-underline">
          privacy policy
        </Link>
        .
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of <SiteValue field="governingLaw" />. Courts there have jurisdiction, unless
        the law where you live gives you the right to bring a claim locally.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        If we change these terms in a way that matters, we’ll email you at least 30 days before the change. If you keep using
        Vidora after that, the new terms apply.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        <SiteValue field="legalName" />, <SiteValue field="address" />. Email: <SiteValue field="supportEmail" />.
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <p>
          These terms explain the rules for using Vidora. They cover your account, the videos we make and post for you,
          billing, and what happens if something goes wrong.
        </p>
      }
      sections={sections}
    />
  )
}
