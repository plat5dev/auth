import { object, optional, string } from "valibot"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: object({
    user_id: string(),
    // Only with AUTH_TOKEN_EMAIL=true (token-properties.ts).
    email: optional(string()),
  }),
})
