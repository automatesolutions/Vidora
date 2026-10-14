import { getAuth } from "@/lib/auth"

// Better Auth endpoints (sign up, sign in, sign out, email verification, Google sign-in).
export const GET = (req: Request) => getAuth().handler(req)
export const POST = (req: Request) => getAuth().handler(req)
