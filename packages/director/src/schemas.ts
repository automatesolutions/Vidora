import { z } from "zod"

// What the director agent returns. Structured outputs guarantee the shape; `validate.ts` checks the
// rules a schema can't express (durations, prompt length, continuity, banned content …).
// Field descriptions are part of the prompt: Claude reads them.

export const NicheStudySchema = z.object({
  read_ok: z.boolean().describe("True only when you actually fetched and read the page. False if every fetch failed or the page had no real content (login wall, error, empty shell)."),
  pages_read: z.array(z.string()).describe("Every URL you fetched and read, the creator's link first."),
  brand_name: z.string().describe("The brand or business name exactly as written on the page. Empty string if none is shown."),
  niche: z.string().describe("The niche in one sentence, in your words, based only on the page."),
  audience: z.string().describe("Who the page is talking to, from its wording and examples."),
  problem: z.string().describe("The main problem or desire the page says it solves."),
  brand_tone: z.string().describe("How the brand sounds (e.g. warm and plain-spoken, premium and calm), with two or three short phrases quoted from the page."),
  sections: z
    .array(z.object({ name: z.string(), summary: z.string().describe("What this section says, one or two sentences.") }))
    .describe("The page's sections in the order they appear: headline/hero, then each section down to the footer."),
  offerings: z
    .array(
      z.object({
        name: z.string().describe("Product, service, or plan name exactly as written."),
        price: z.string().describe("The price exactly as written, with currency and period. Empty string if no price is shown."),
        details: z.array(z.string()).describe("Its features and what's included, as the page states them."),
      })
    )
    .describe("Every product, service, or plan on the page."),
  benefits: z.array(z.string()).describe("The outcomes the page promises, close to its own wording."),
  offers: z.array(z.string()).describe("Discounts, free trials, guarantees, bonuses, deadlines, exactly as stated. Empty if none."),
  proof: z.array(z.string()).describe("Reviews, testimonials, ratings, customer counts, quoted word for word with the name or source the page shows. Empty if none."),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).describe("FAQ questions and answers as shown. Empty if none."),
  cta: z.string().describe("The page's main call to action, word for word (e.g. \"Book a free call\")."),
  visual_cues: z.string().describe("Settings, people, products, and colors the page itself describes or names (copy and image alt text). Empty string if the page doesn't say."),
  not_on_page: z.string().describe("Facts a video might want but the page doesn't give (no prices, no reviews, no location...), so nobody invents them."),
})
export type NicheStudy = z.infer<typeof NicheStudySchema>

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
  purpose: z.enum(["hook", "build", "payoff", "cta"]).describe("The three beats: hook (0-2 s), build = escalation (raise the stakes, one step per shot), payoff (deliver the open loop), then cta."),
  duration_sec: z.number().int().describe("One of the model's allowed durations, usually 3-5 s: fast pacing."),
  transition_in: z
    .enum(["none", "hard_cut", "whip_pan", "match_cut"])
    .describe("How the edit enters this shot: none for scene 1 only. match_cut: this shot's FIRST FRAME repeats the shape, position or motion of the previous shot's last moment."),
  voiceover_line: z.string().describe("Exactly what the narrator says during this scene."),
  voiceover_performance: z
    .string()
    .describe('The same line, word for word, with one or two ElevenLabs v4 audio tags in square brackets where the delivery shifts, e.g. "[excited] Three side jobs you can start tonight. [whispers] The first one surprised me."'),
  features_anchor: z.boolean().describe("True when the recurring subject described in subject_anchor appears in this shot."),
  // Short labels only; the detail lives in `prompt`, so nothing is written twice.
  shot: z.object({
    shot_type: z.string().describe("wide, medium, close-up, or extreme close-up. Never the same size twice in a row."),
    camera_motion: z.string().describe("Exactly one camera move, never static: slow push-in, handheld follow, low-angle tracking (level), lateral tracking, whip pan, dolly out."),
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
  hook_text: z.string().describe("Bold on-screen text for the first 2 seconds: 6 words or fewer, creates curiosity or tension, adds to the spoken hook instead of repeating it."),
  open_loop: z
    .object({
      question: z.string().describe("The question or promise planted in the first 5 seconds that the viewer needs answered."),
      planted_in_scene: z.number().int().describe("0-based scene where the narration plants it (must start before 5 s)."),
      paid_off_in_scene: z.number().int().describe("0-based scene where it's answered: one of the last two scenes."),
    })
    .describe("Keeps people watching to the end."),
  loop_ending: z.string().describe("How the final shot satisfies and invites a rewatch: it echoes or flows back into the first frame (same subject, position or motion) so the loop feels seamless."),
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
      lighting: z.string().describe("Motivated sources with direction (golden-hour rim light, soft key, or moody practicals), camera on the shadow side, realistic shadows, \"WB locked ____K\". One or two sentences."),
      color_grade: z.string().describe("This run's color grade from <this_run>, with the dominant tones and one accent tied to a source or surface; rich contrast, blacks not crushed. One sentence."),
      style: z.string().describe("Full-frame cinema camera, 35mm or 50mm lens, shallow depth of field, natural lens flare, subtle film grain; photorealistic live action with true-to-life skin texture and fabric detail; NOT a 3D render, NOT CGI. One or two sentences."),
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
