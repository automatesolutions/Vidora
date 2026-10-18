import { z } from "zod"

// What the director agent returns. Structured outputs guarantee the shape; `validate.ts` checks the
// rules a schema can't express (durations, prompt length, continuity, banned content …).
// Field descriptions are part of the prompt: Claude reads them.

export const IdeationSchema = z.object({
  hooks: z
    .array(
      z.object({
        text: z.string().describe("The opening line, spoken in the first 1-3 seconds. Under 15 words."),
        angle: z.string().describe("Which script angle this hook sets up."),
        visual_idea: z.string().describe("The first image the viewer sees while the hook is spoken, in one sentence."),
      })
    )
    .describe("8 hooks, each clearly different in wording and idea."),
})
export type Ideation = z.infer<typeof IdeationSchema>

export const SceneSchema = z.object({
  purpose: z.enum(["hook", "build", "payoff", "cta"]),
  duration_sec: z.number().int().describe("Must be one of the model's allowed durations."),
  voiceover_line: z.string().describe("Exactly what the narrator says during this scene."),
  features_anchor: z.boolean().describe("True when the recurring subject described in subject_anchor appears in this shot."),
  // Short labels only; the detail lives in `prompt`, so nothing is written twice.
  shot: z.object({
    shot_type: z.string().describe("e.g. extreme close-up, medium shot, wide shot, overhead."),
    camera_motion: z.string().describe("Exactly one camera move (or locked off), using this run's camera language."),
    hero_moment: z.string().describe("The shot's one peak in a few words, e.g. \"coins SLIDE OUT at 3.0s\"."),
  }),
  prompt: z.string().describe("This scene's sections only: SHOT, SUBJECT, LOCATION, FIRST FRAME, OPTICS, CAMERA, ACTION, PERFORMANCE, PHYSICS, AUDIO. We append the shared look."),
  negative_prompt: z.string().describe("What the model must avoid. Empty string if the model has no negative prompt."),
  caption_words: z.string().describe("2-6 key words we overlay as captions later. Never part of the video prompt."),
})

export const PlanSchema = z.object({
  concept: z.string().describe("The whole Short in one sentence."),
  angle: z.string(),
  hook: z.string().describe("The chosen hook, word for word."),
  subject_anchor: z
    .string()
    .describe("A fixed visual description of the recurring subject or place, repeated word for word in every prompt that features it. Empty string if nothing recurs."),
  narrator: z
    .object({ gender: z.enum(["female", "male"]), age: z.enum(["young", "middle_aged", "old"]) })
    .describe("The narrator's voice. When one person carries the video, match them: the viewer hears the narration as theirs."),
  continuity: z.object({
    palette: z.string(),
    wardrobe_and_props: z.string(),
    location: z.string(),
  }),
  look: z
    .object({
      lighting: z.string().describe("Motivated sources with direction, camera on the shadow side, \"WB locked ____K\". One or two sentences."),
      color_grade: z.string().describe("Dominant tones plus one accent color tied to a source or surface. One sentence."),
      style: z.string().describe("This run's visual style as photorealistic live action, with the realism and anti-CGI locks. One or two sentences."),
      locks: z.string().describe("Three to five short locks shared by every shot, separated by semicolons."),
    })
    .describe("Written once and appended by us to every scene's prompt, so all clips look like one shoot."),
  scenes: z.array(SceneSchema),
  voiceover_script: z.string().describe("The full narration: every voiceover_line joined, in order."),
  title: z.string().describe("YouTube title, under 70 characters, no clickbait lies, no hashtags."),
  description: z.string().describe("2-3 short sentences for the YouTube description. No hashtags."),
  hashtags: z.array(z.string()).describe("5-10 relevant hashtags without #Shorts (we add it)."),
  cta_line: z.string(),
  thumbnail_scene_index: z.number().int().describe("0-based index of the scene whose frame makes the best thumbnail."),
  self_check: z.string().describe("One or two sentences confirming the plan follows the rules, or naming what you traded off."),
})
export type Plan = z.infer<typeof PlanSchema>
export type Scene = z.infer<typeof SceneSchema>

export const RewriteSchema = z.object({
  prompt: z.string(),
  negative_prompt: z.string(),
  what_changed: z.string().describe("One sentence on what was reworded and why it keeps the shot's intent."),
})
export type Rewrite = z.infer<typeof RewriteSchema>
