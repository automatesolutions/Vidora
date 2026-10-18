import "server-only"
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { organization } from "better-auth/plugins"
import { authDatabase, generateAuthId, getDb, getMembership, ORGANIZATION_SCHEMA, provisionWorkspaceForUser } from "@vidora/db"
import { sendEmail } from "@/lib/server/email"

// Better Auth with the organization plugin. A Better Auth organization is a Vidora workspace.
// Built on first use (not at import), so `next build` doesn't need a database.

function createAuth() {
  const db = getDb()
  const google =
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET } }
      : {}

  return betterAuth({
    appName: "Vidora",
    baseURL: process.env.APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authDatabase(db),
    advanced: { database: { generateId: generateAuthId } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
      // Sign-in works before the email is verified; making a video needs a verified email (free video abuse).
      requireEmailVerification: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email for Vidora",
          text: `Confirm your email to make your first video:\n\n${url}\n\nIf you didn't sign up for Vidora, you can ignore this email.`,
        })
      },
    },
    socialProviders: google,
    // Google verifies the email, so "Continue with Google" with the same address as an existing
    // email-and-password account signs into that account instead of failing.
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    databaseHooks: {
      user: {
        create: {
          after: async (u) => {
            await provisionWorkspaceForUser(db, { id: u.id, name: u.name, email: u.email })
          },
        },
      },
      session: {
        create: {
          // Open every session in the user's workspace.
          before: async (s) => {
            const m = await getMembership(db, s.userId)
            return { data: { ...s, activeOrganizationId: m?.workspaceId ?? null } }
          },
        },
      },
    },
    plugins: [
      organization({ schema: ORGANIZATION_SCHEMA, allowUserToCreateOrganization: false, creatorRole: "owner" }),
      nextCookies(), // must stay last: sets cookies from server actions
    ],
  })
}

type Auth = ReturnType<typeof createAuth>
const g = globalThis as unknown as { __vidoraAuth?: Auth }
export function getAuth(): Auth {
  g.__vidoraAuth ??= createAuth()
  return g.__vidoraAuth
}
