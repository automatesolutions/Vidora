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
  shot: z.object({
    shot_type: z.string().describe("e.g. extreme close-up, medium shot, wide establishing shot, overhead."),
    subject: z.string().describe("Who or what is on screen, with concrete visual details."),
    action: z.string().describe("One continuous, visible motion from start to end of the shot."),
    setting: z.string().describe("Where it happens: specific place, objects, time of day."),
    lighting: z.string(),
    camera_motion: z.string().describe("Exactly one camera move, using this run's camera language."),
    lens_and_framing: z.string().describe("Lens feel and vertical framing notes."),
    style: z.string().describe("The run's visual style, applied to this shot."),
    mood: z.string(),
  }),
  prompt: z.string().describe("The final Higgsfield prompt for this shot: one paragraph assembled from the shot fields."),
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
  continuity: z.object({
    palette: z.string(),
    wardrobe_and_props: z.string(),
    location: z.string(),
  }),
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
