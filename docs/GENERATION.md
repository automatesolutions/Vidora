# Generation workflow plan (draft 2026-10-09)

How Vidora turns a brief, images or videos into realistic, consistent output for less than the credit price. This extends `docs/PLAN.md` (the provider gateway, n8n pipeline, `provider_runs`, credits). Prices below come from the public pages of Kie and Higgsfield between 2026-09-16 and 2026-10-02. They change often, so phase R0 re-checks them before we commit.

## 1. The problem in numbers

The credit price fixes our budget per video. At about $0.08 provider cost per credit:

| Tier | Credits | Customer pays | Provider budget | Target spend |
|---|---|---|---|---|
| Standard short (hybrid) | 20 | $5.00 | $1.60 | **≤ $1.00** |
| Premium short (all AI) | 60 | $15.00 | $4.80 | **≤ $3.00** |

The gap between target and budget pays for retries, failed shots and the 2 free change requests. Visuals take about 70% of the cost (`STAGE_COST_SHARE` in `packages/core/src/credits.ts`), so the workflow below focuses on visuals.

Three things break quality, and each has a fix in §3:

- **Realism:** text-to-video invents faces, hands and products. We start from checked stills and animate those.
- **Consistency:** each shot is generated on its own, so faces, products and colour drift. Every shot gets the same references, and one colour grade is applied over all of them.
- **Cost:** video is billed per second, and a bad clip is paid for in full. We catch problems at the still stage, where an image costs $0.003 to $0.02, before paying $0.02 to $0.20 per second of video.

## 2. Kie vs Higgsfield: use both, for different jobs

Both have a server API with pay-per-use USD billing and webhooks, and neither charges for failed generations. Many models are on both (Kling 3.0, Seedance 2.0 and 2.5, Wan 3.0, MiniMax H3, Veo 3.1), so each one can be the fallback for the other.

| | Kie (`api.kie.ai`) | Higgsfield (`api.higgsfield.ai`) |
|---|---|---|
| Auth | `Authorization: Bearer <key>`, IP allowlist, per-key caps | `Authorization: Key <id>:<secret>` |
| Async flow | `createTask` → `callBackUrl` or poll `recordInfo` | submit → `hf_webhook` or poll `status_url` |
| Gotchas | Errors come back as HTTP 200 with `code` in the body. Files are deleted after **14 days**. 20 new tasks per 10 s. The team says to expect "occasional instability". | Webhooks retried for 2 h, duplicates possible (dedupe on `request_id` + status). 4xx is permanent. 20 concurrent requests to start. |
| Best for | LLMs (Claude, Gemini, GPT at 40–70% off), TTS (ElevenLabs, Gemini TTS), cheap stills, cheapest video (Veo 3.1 Lite), lip-sync (Infinitalk, OmniHuman), music (Suno) | Identity (Soul ID), very cheap stills (Soul 2), discounted Kling 3.0 and Wan 3.0, ad tools (Marketing Studio, Ad Multiplier), video edits (Genjutsu, Kling Omni Edit), reframe, upscale |

### Starting price sheet (to verify in R0)

| Job | Cheapest good option | Price |
|---|---|---|
| Script and shot list | Claude Haiku 5.5 on Kie, prompt caching on | about $0.01 per short |
| Voiceover | Gemini 3.8 Flash TTS or ElevenLabs Turbo 2.5 on Kie | about $0.02–0.05 per short |
| Stills, general | Seedream 5 Flash on Kie / Nano Banana 2.1 1K on Kie | $0.016 / $0.02 per image |
| Stills, same person | Soul 2 with a Soul ID on Higgsfield | from $0.0032 per image |
| Video, budget | Veo 3.1 Lite on Kie ($0.15 per 8 s clip) / Wan 3.0 on Higgsfield (discounted) | about $0.019 / $0.025 per s |
| Video, good motion | Kling 3.0 on Higgsfield (discounted) / Kling 3.0 std on Kie | $0.042 / $0.07 per s |
| Video, best identity from references | Seedance 2.0 on Higgsfield (discounted) / on Kie, 720p | $0.099 / $0.124 per s |
| Video, top end (rare) | Seedance 2.5, Cinema Studio 4.0, Veo 3.1 Quality | $0.14–0.21 per s |
| Product ad, avatar | Higgsfield Marketing Studio (12–15 s, avatar + product) | check in R0 |

Higgsfield's discounts (15% by default, up to 50% when you pick 4 more models) depend on account setup. Get them in place before comparing prices.

### Rules for routing

1. Route by **step**, not by provider. The gateway reads a `provider_prices` table and the R0 scores, then picks the cheapest model that passes the quality bar for that step.
2. Every step has a primary model and a fallback on the other provider. Switch to the fallback after 2 provider errors or a timeout. Content-policy failures need a new prompt, not a switch.
3. Turn off native audio on video models (`sound: off`, `generate_audio: false`). It costs more, and our voiceover and music are added in assembly anyway.
4. Copy every output to R2 as soon as it's done. Kie deletes files after 14 days, and Higgsfield URLs aren't permanent either.

## 3. The workflow

One pipeline, organised around stills first. It maps onto the existing stages (`ideation → script → voiceover → visuals → captions → thumbnail → render`). The new steps sit inside `visuals`.

```
brief / uploads
  → 1. Plan        LLM writes the script AND a structured shot list (JSON)
  → 2. Voice       TTS first, so its timing sets each shot's length
  → 3. Keyframes   one still per shot, all from the same reference pack
  → 4. Check       automated checks on the stills; redo only failed shots (max 2)
  → 5. Motion      image-to-video from the approved stills (first frame, plus last frame if needed)
  → 6. Check       sample frames from each clip; redo or fall back to a still with camera motion
  → 7. Assemble    ffmpeg: one LUT, film grain, captions, voice, music, loudness, end card
  → 8. Approval    the existing approval queue
```

### 3.1 Consistency kit (set up once per workspace)

Store it as a **brand kit**, and pass the same kit to every shot:

- **Characters:** 1 to 3 reference photos, or a character sheet (Higgsfield, $0.05 each). For a recurring person, train a **Soul ID** once (`POST /v1/custom-references`, `model_version: "v2"`) and store its id. Soul IDs belong to Vidora's Higgsfield account, so keep a `workspace_id → soul_id` mapping and a consent record. A real person's likeness needs proof of consent (see §6).
- **Products:** 3 to 6 clean photos with the background removed (Recraft remove-background on Kie). These are reference images for every product shot.
- **Look:** palette in hex, lighting words, lens words, and one `.cube` LUT. The LLM copies these into every shot prompt word for word.
- **Never generated:** logos, prices, on-screen text and end cards. Assembly overlays them from real files, because models garble text and logos.

### 3.2 Shot list contract

The LLM returns JSON that is validated with zod before anything is spent (it's stored as the `visual_plan` asset):

```json
{
  "shots": [
    {
      "id": "s1",
      "seconds": 3.5,
      "kind": "ai_clip | still_motion | stock | product_hero",
      "subject_refs": ["char:mia", "product:serum"],
      "action": "Mia lifts the serum bottle toward the window",
      "camera": "slow push-in, 35mm, eye level",
      "light": "soft morning window light from the left",
      "keyframe_prompt": "...",
      "motion_prompt": "..."
    }
  ]
}
```

`kind` sets the price for each shot:

- `still_motion`: a still with pan, zoom or parallax done in ffmpeg. Costs only the still.
- `stock`: B-roll from a free-licence stock API (Pexels). Costs nothing.
- `ai_clip`: image-to-video. The expensive one.
- `product_hero`: the real product photo with light motion, or Seedance using product references.

Standard shorts allow **at most 3 `ai_clip` shots**. Premium has no limit, but every shot is still image-to-video.

### 3.3 Automated checks

Cheap checks first. Each one runs before the next expensive step:

- **Stills:** a vision LLM (Gemini Flash on Kie) scores the still against the shot description and the references: right subject, no stray text, hands, product shape. For people, compare face embeddings with the reference (InsightFace on the VPS CPU is enough for one frame per shot). Below the threshold, redo the still once with a stricter prompt, then once with a different model.
- **Clips:** take 3 frames (start, middle, end) and run the same checks, plus a check for morphing between frames. Failing twice means the shot becomes `still_motion` from its approved still. The video always gets finished, and the retry spend has a cap.
- **Whole job:** the existing `limits.max_cost_usd` stops the run, and the gateway checks it before every provider call, not after.

### 3.4 Assembly

Done in ffmpeg on the worker. It's free and fully under our control:

- One LUT and one grain pass over every clip, which removes most of the colour drift between models.
- Captions come from the TTS word timings, styled from the design tokens.
- Loudness normalised to -14 LUFS. Music comes from a licensed library or Suno, after the licence check (see §6).
- Real logo, end card and on-screen text are overlaid from the brand kit.

### 3.5 Preview, then final (the biggest saving, needs a decision)

Generate clips at 480p or 720p for the approval preview, and render the final version only after approval. Seedance 2.5 on Higgsfield has a built-in `draft` mode (a 480p draft that can be finalised at 1080p within 7 days). For other models, generate at 720p and upscale (Bytedance or Topaz upscaler) after approval, if R0 shows upscaling costs less than generating at 1080p. Rejected videos then cost a fraction, and change requests reuse every shot that wasn't touched (`reuse_assets` is already in the contract).

This changes the state machine: `approved` would trigger a `finalizing` step before `scheduled`. See §7, question 1.

## 4. Workflows by customer

All three use the same gateway and checks, with different steps turned on.

**A. Creators (MVP):** brief → the pipeline above. Standard mixes stills, stock and up to 3 AI clips. Premium is all AI clips. Target 30–45 s, with shots of 2–5 s.

**B. Ad companies (Phase 2):** for them, what matters is that the product looks exactly right and that they get many variants.

1. Product kit: upload, remove the background, generate packshots (Marketing Studio Image or Nano Banana edit with the product as reference).
2. Hero ad: Marketing Studio Video (avatar + product, UGC, unboxing or review formats) or Seedance 2.0 with multiple references.
3. Variants: Ad Multiplier regenerates only the hook or the CTA, or recreates the ad for a new language, audience or cast. A variant pays for the changed seconds, not the whole ad.
4. Formats: Higgsfield Reframe for 9:16, 1:1 and 16:9 from one master.
5. Approval in batches: approve or reject variants in a grid.

**C. Converting existing media (Phase 2):** a creator brings their own photos or footage.

- Photo → clip: the photo is the first frame (image-to-video).
- Restyle or swap a subject in a clip: Kling 3.0 Omni Edit, Seedance 2.5 `video_edit`, Genjutsu replace-object (priced by source length).
- Long video → shorts: our own transcript, highlights and ffmpeg cuts, or Higgsfield Clipify.
- Translate: Higgsfield dubbing, or our own TTS plus lip-sync (Infinitalk or Volcengine lip-sync on Kie).
- Upscale or clean up: upscale, deflicker.

## 5. Build plan

| Phase | Length | What ships |
|---|---|---|
| **R0: Model benchmark** | 1 week, about $150–300 of credits | A test set of 20 briefs: 10 creator niches, 5 products, 5 people with references. Run the candidate models from §2 on both providers. Score each on identity similarity, product match, artefacts, prompt match (vision LLM plus Jonel's blind rating), cost, time and failure rate. Output: the first routing table and the real cost per Standard and Premium short. Re-run monthly, because the models change every month. |
| **G1: Provider gateway** | 1.5 weeks | `packages/providers`: a `kie` and a `higgsfield` adapter behind one interface (`submit`, `status`, `cancel`, `normalizeResult`, `costOf`). `provider_prices` table, budget check before every call, R2 copy on finish, `provider_runs` rows. Webhooks land on Cloud Run (`/api/webhooks/providers/{kie,higgsfield}`), which verifies them, stores them in `webhook_events` (dedupe) and wakes the worker. `reconcile.ts` polls anything stuck as a backup. |
| **G2: Standard pipeline** | 2 weeks | Shot list contract, TTS timing, keyframes, still checks, up to 3 AI clips, ffmpeg assembly with LUT and captions. Replaces the stub n8n pipeline. |
| **G3: Consistency kit** | 1.5 weeks | Brand kit tables and UI, references, Soul ID training with consent, face-embedding checks. |
| **G4: Premium and preview/final** | 1.5 weeks | All-AI shots, draft → final (if approved in §7), change requests that reuse untouched shots. |
| **G5: Ad workflows** | 2 weeks | Product kit, Marketing Studio, Ad Multiplier variants, Reframe, batch approval. |
| **G6: Convert workflows** | 2 weeks | Photo → clip, restyle, long → shorts, dubbing, upscale. |

R0 to G2 fit inside Phase 1 (the n8n pipeline item). G3 and G4 are the end of Phase 1 or the start of Phase 2. G5 and G6 are Phase 2.

### Schema additions

- `provider_prices` (provider, model, mode, unit, usd_per_unit, valid_from)
- `brand_kits`, `brand_kit_assets` (character, product, logo, LUT)
- `characters` (workspace_id, provider, external_ref_id such as the Soul ID, consent_record_id, status)
- `shots` (job_id, revision, shot_id, kind, status, still_asset_id, clip_asset_id, attempts, cost_usd), so a change request can redo only some shots

### Cost per short (estimate, R0 replaces it)

| | Standard 45 s | Premium 45 s |
|---|---|---|
| Script, shot list, checks | $0.03 | $0.05 |
| Voiceover | $0.04 | $0.04 |
| Stills (12 shots, plus 30% retries) | $0.25 | $0.25 |
| Video | 3 clips × 4 s on Wan 3.0 or Veo Lite: about $0.30 | 11 clips × 4 s on Kling 3.0, preview at 720p: about $1.85 |
| Retries and fallback (30% of video) | $0.09 | $0.55 |
| **Total** | **about $0.71** (budget $1.60) | **about $2.74** (budget $4.80) |

## 6. Risks

- **Provider outage or price change:** each step has a fallback on the other provider, and prices live in a table we can update without a deploy.
- **Kie stability:** expect occasional failures. Retry with backoff, then switch to the fallback.
- **Real-person likeness:** `docs/PLAN.md` blocks it today. Soul ID for the creator's own face needs a consent step (a selfie video saying a phrase, kept in `consent_records`) and a check that they're the account owner. Until then, only AI-made characters.
- **Music licence:** check Suno's commercial terms and whether YouTube Content ID flags Suno tracks before using them. Until then, use a licensed royalty-free library.
- **Synthetic media labels:** keep setting `containsSyntheticMedia` on YouTube and the AI label on TikTok. Ads may also need a disclosure in the ad platform.
- **Prices in this doc go out of date:** R0 and the monthly re-run are the source of truth.

## 7. Decisions needed from Jonel

1. **Preview, then final:** approve a 480p or 720p preview and render the final version after approval? It saves the most money but adds a `finalizing` state.
2. **Ad workflows (G5):** keep them in Phase 2, or move them into the MVP because ad companies are a target customer?
3. **Creator's own face:** allow it in Phase 2 with a consent step, or keep only AI characters until Phase 3?
4. **R0 budget:** OK to spend about $150–300 across both providers for the benchmark?
