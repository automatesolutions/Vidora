// Business details used by the legal pages, the footer, emails, and the platform applications.
// Values in angle brackets are placeholders. `pnpm launch-check` fails while any remain.
export const SITE = {
  name: "Vidora",
  legalName: "<Legal business name>",
  address: "<Business mailing address>",
  domain: "<your-domain.com>",
  supportEmail: "<support@your-domain.com>",
  privacyEmail: "<privacy@your-domain.com>",
  governingLaw: "<Country, state, or province>",
  effectiveDate: "<Month D, YYYY>",
  copyrightYear: 2026,
} as const

export type SiteField = keyof typeof SITE

export function isPlaceholder(value: string | number) {
  return typeof value === "string" && value.startsWith("<") && value.endsWith(">")
}

export const HAS_PLACEHOLDERS = Object.values(SITE).some(isPlaceholder)
