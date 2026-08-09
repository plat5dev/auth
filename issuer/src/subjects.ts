import { object, string } from "valibot"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: object({
    user_id: string(),
  }),
})
