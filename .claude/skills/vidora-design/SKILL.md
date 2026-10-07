---
name: vidora-design
description: Vidora's locked design rules (tokens, brand/logo check, contrast results, component rules, tone of voice and banned words). Use before building, editing or reviewing ANY Vidora screen, component, email, icon, image asset or user-facing copy.
---

# Vidora design rules

Read this before touching UI, copy or brand assets. It does not replace `DESIGN.md`; it records how
Vidora applies it.

## 1. Order of authority

1. `DESIGN.md` (project root) is the source of truth for colors, type, spacing, radius, elevation and components.
2. This file records the approved **extensions** (marked ⊕) and the brand-logo reconciliation.
3. If a needed component is not in DESIGN.md, build it in the same style (12px radius, 1px ink hairline,
   cream-on-cream elevation) and add it here under §6 before shipping.
4. DESIGN.md is *inspired by* Zapier. Never use Zapier's name, logo or illustrations. Use Vidora's own.

## 2. Brand check (done 2026-10-07, from `assets/vidora-logo.png`)

- Wordmark spelling confirmed: **Vidora** (capital V, lowercase "idora").
- Source file: 1024×1024 PNG, RGB, **no alpha**, logo occupies the middle ~25% of the height.
- Colors were sampled from pixels (script), not guessed:

| Role | Hex |
|---|---|
| Gradient start (amber, top-left) | `#FD9A1B` |
| Gradient midpoint (computed, 50%) | `#FD7333` |
| Gradient end (coral, bottom tip) | `#FD4E4E` |
| Wordmark charcoal | `#28303A` |
| Background / play-glyph knockout | `#FEFEFE` |

The gradient is linear in RGB (least-squares fit, RMSE ~3 per channel), two stops, CSS angle **140deg**
(axis 48.6deg below +x in image space). The vector logo reproduces the master with a mean channel
difference of 3.8/255 (`pnpm brand` prints this check).

| Logo color | vs DESIGN.md | Verdict |
|---|---|---|
| Coral `#FD4E4E` | `primary` `#FF4F00` | Close (same luminance, redder hue) |
| Amber `#FD9A1B` | none | Conflict: second accent hue. Decorative only. |
| Wordmark `#28303A` | `ink` `#201515` | Conflict: cool slate vs warm coffee. Logo only, never UI text. |
| Background `#FEFEFE` | `canvas` `#FFFEFB` | Close, but no alpha. Use transparent derived files. |

### Logo rules
- **Never recolor, redraw, stretch or re-gradient the master logo.** The original stays in `assets/`.
- Approved derived files live in `apps/web/public/brand/` (see `README.md` there). Regenerate them with `pnpm brand`;
  never edit them by hand.
- The mark's play button is **negative space** (transparent). On dark surfaces it shows the surface color; that is correct.
- Dark surfaces use `vidora-logo-dark.*`: same mark gradient, wordmark set to `#FFFEFB`
  (the charcoal wordmark is 1.33:1 on ink and disappears).
- Minimum clear space around the logo: the height of the play glyph. Minimum width: 96px (full logo), 16px (mark).
- `--gradient-brand` is allowed ONLY on: the logo mark, app icon / favicon, OG and email headers, the generation
  progress bar / loader, and highlights inside illustrations. **Never** on text, buttons or approval actions.

## 3. Tokens

Implemented in `apps/web/app/globals.css` (Tailwind v4 `@theme`, no `tailwind.config`). Do not add raw hex
values in components; use the token utilities (`bg-canvas`, `text-ink`, `rounded-md`, `p-xl` …).

### Colors (DESIGN.md, exact)
`primary #ff4f00` · `on-primary #fffefb` · `ink #201515` · `ink-soft #2f2a26` · `ink-mid #36342e` ·
`body #605d52` · `body-mid #939084` · `mute #c5c0b1` · `canvas #fffefb` · `canvas-soft #f8f4f0`

### ⊕ Extensions (approved with the plan, 2026-10-07)
| Token | Light | Dark | Why |
|---|---|---|---|
| `primary-text` | `#C73E00` (5.06:1 on canvas) | `#FF6A2B` (4.96:1 on ink-soft) | Orange text / links / small orange buttons that pass AA |
| `success` | `#1F7A4D` | `#4FBF86` | Status only, always with icon + label |
| `warning` | `#8A5A00` | `#F2B544` | Status only |
| `danger` | `#B42318` | `#F97066` | Status and destructive confirm only |
| `shadow-modal` | `0 12px 32px rgb(32 21 21 / .14)` | `0 12px 32px rgb(0 0 0 / .4)` | DESIGN.md says "elevated shadow" without a value |
| `gradient-brand` | `linear-gradient(140deg,#FD9A1B 0%,#FD4E4E 100%)` | same | Logo accent, see §2 |

### ⊕ Dark mode (DESIGN.md has none)
background `ink #201515` · card `ink-soft #2F2A26` · raised `ink-mid #36342E` · text `#FFFEFB` ·
secondary text `mute #C5C0B1` · tertiary `body-mid #939084` **only on ink, never on ink-soft** (4.43:1 fails) ·
primary fill stays `#FF4F00`.

### Type (DESIGN.md scale, all 16 styles as `text-*` utilities)
- Display face: **Mona Sans 500** (DESIGN.md's named free substitute for Degular Display). Swap to Degular if licensed.
- Everything else: **Inter** (400/500/600/700) with `cv11`, `ss01`; tabular numbers for times and counts.
- One deviation: `button-md` label is **19px / 700** (not 18/600) so the white-on-orange label counts as large text.
- Sentence case everywhere. Uppercase only for the eyebrow style.
- App UI default body is `body-sm` 16px; marketing body is `body-md` 18px.

### Spacing, radius, breakpoints
Spacing (4px base): xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48 · 4xl 64.
Radius: sm 6 (inputs, inline pills) · md 12 (buttons, cards) · pill 9999 (badges) · full 9999 (icon circles).
Breakpoints: mobile < 768 · tablet 768–1023 · desktop ≥ 1024.

## 4. Contrast results (WCAG AA, computed)

| Pair | Ratio | Rule |
|---|---|---|
| `#FFFEFB` on `#FF4F00` (primary button) | 3.27 | Large text only, hence 19px/700 labels. Never small white text on orange. |
| `#FF4F00` on canvas / canvas-soft | 3.27 / 3.01 | Non-text (focus ring, icons ≥ 24px) only. Text uses `primary-text`. |
| `#FF4F00` on ink | 5.40 | OK for text. |
| `#FF4F00` on ink-soft | 4.30 | Fails for text. Use `#FF6A2B`. |
| `body-mid` on canvas | 3.17 | Large text / metadata ≥ 18px only. Use `body` (6.54) for small secondary text. |
| `body-mid` on canvas-soft | 2.92 | **Fails even for large text. Never use `subtle-foreground` on cards**; use `muted-foreground`. |
| `mute` on canvas | 1.80 | Borders and disabled only, never text. |
| Logo amber on canvas | 2.12 | Never as text. |

`pnpm contrast` (scripts/contrast-check.ts) recomputes these and fails CI on regressions.

## 5. Component rules

- Base: **shadcn/ui** (files in `apps/web/components/ui`, restyled to tokens). Vidora parts in `components/vidora`.
- Buttons: 12px radius, never pills. Variants: `primary` (orange), `secondary` (ink), `tertiary` (1px ink outline),
  `text`. **At most two filled buttons per view.** Min height 48px (44px minimum hit area everywhere).
- Inputs: canvas fill, 1px ink border, 6px radius, `body-md`.
- Cards: `canvas-soft` on `canvas`, 24px padding, no shadow (surface contrast is the elevation). Modals add `shadow-modal`.
- Focus: 2px `primary` ring, 2px offset, on every interactive element.
- Icons: **Lucide only** (`lucide-react`, inline SVG, `currentColor`), stroke **1.75**, 20px in UI / 24px in nav.
  Icon buttons pad out to 44×44. Lottie (lordicon) only for success check, generation loader, notification bell.
- 21st.dev: landing sections only. reactbits.dev / canvasui.dev: landing hero + at most one empty state.
  **Nothing decorative in `/app/queue` or `/app/videos/*`.**
- Motion: landing GSAP reveals; in-app 150–200ms opacity/translate ≤ 8px; `prefers-reduced-motion` turns slides into
  fades and removes swipe animation. Every gesture has a button twin.
- Status is never color alone: pill = icon + label + color.
- No auto-dismiss timers on anything you must act on (undo toasts stay until dismissed).
- Safe areas: `env(safe-area-inset-*)`, 16px side gutter on phones. Test at 375, 440, 1280 and 200% zoom.

## 6. ⊕ Components not in DESIGN.md (built in its style)

Video player frame · approval action bar · swipe card · bottom sheet · pipeline stepper / progress (uses
`gradient-brand`) · status pill (semantic) · platform chip · calendar · switch · select · date-time picker ·
skeleton · dark mode. Each must appear on `/design-system` with all its states before use in a screen.

## 7. Tone of voice

Friendly and direct, US English, Oxford comma, contractions fine. Open with what the screen does, end with one
next step. "You" for the reader, "we" for Vidora, never "I". No exclamation marks in UI, no emoji in UI, no
dashes or ellipses for effect. Buttons name the action ("Approve for Tue 6:00 PM", "Reconnect TikTok").
Errors say what happened and what to do next, without blame. Product name is always **Vidora**.

### Banned words (enforced by `pnpm copy-lint`)
delve, seamless/seamlessly, game-changer, unlock, supercharge, elevate, leverage, empower, robust,
cutting-edge, revolutionize, harness, tapestry, journey, magic/magical, effortless, simply, just, easy,
please, "click here", "Submit", "OK" (as a label when a verb fits), "users" (say "creators" or "you").

### Approved microcopy
| Where | Copy |
|---|---|
| Empty queue | "Nothing to review right now. Your next videos start generating at {time}." · `Make a video now` |
| Onboarding, connect | "Connect where you post. We'll only post videos you approve." |
| Publish error | "We couldn't post to TikTok. Your TikTok login expired." · `Reconnect TikTok` |
| Approve | `Approve for {day time}` → toast "Approved. Posting {day time}." · `Undo` |
| Reject confirm | "Reject this video? We won't post it, and it won't use more credits." · `Reject video` · `Keep it` |
| Request changes | Sheet title "What should change?" · chips Script, Voice, Visuals, Captions, Thumbnail · placeholder "Example: Make the hook shorter and use a calmer voice." · `Send changes` |
| Generation failed | "This video didn't finish. We didn't use your credits." · `Try again` |

## 8. UX audit gate (every UI phase)

A UI phase is done only when all pass: hierarchy (≤ 2 filled buttons per view) · spacing on tokens only ·
`pnpm contrast` and an axe scan pass in light and dark · empty, loading and error states exist · 375 / 440 /
1280px and 200% zoom work · approval flow works keyboard-only and one-handed · every control has an accessible
name · reduced motion respected · `pnpm copy-lint` passes · Lighthouse accessibility ≥ 95.

## 9. Implementation notes (learned in Phase 0, 2026-10-07)

- **Stack:** Next.js 16.4 (App Router, `cacheComponents` on), Tailwind v4 (`@theme` in `apps/web/app/globals.css`),
  shadcn/ui `radix-nova` preset. Next 16 differs from older docs: read `apps/web/node_modules/next/dist/docs/` first.
- **Class merging:** always import `cn` from `@/lib/utils`, never from the `cn` package directly. The local one knows
  the DESIGN.md type scale; the raw one silently drops `text-body-sm` when it meets `text-ink`.
- **New shadcn components** (`pnpm dlx shadcn@latest add …`) arrive with shadcn defaults. Before use: switch the import
  to `@/lib/utils`, map variants (`default`→`primary`, `outline`→`tertiary`, `ghost`→`text`), use token type
  (`text-body-sm`, not `text-sm`), 6px inputs / 12px surfaces, and 44px minimum heights.
- **Toasts:** informational toasts may auto-dismiss. Toasts with an action (Undo, Reconnect) use
  `duration: Infinity` and `closeButton: true`.
- **Spacing:** use Tailwind's numeric scale (`p-6` = spacing.xl). Do not add named `--spacing-*` tokens; they collide
  with `max-w-*` sizes in Tailwind v4.
- **Display type:** `text-display-*` and `text-eyebrow` set size only; add `font-display` for the Mona Sans styles.
- **Checks:** `pnpm check` (contrast + copy-lint + typecheck + lint). The UX audit (axe WCAG 2.2 AA, 44px targets,
  overflow at 375/1280 in light and dark, A/R/C shortcuts) passed on `/` and `/design-system`. In Playwright mobile
  emulation, measure overflow against `screen.width`, not `innerWidth` (the layout viewport grows to fit).
- **`/design-system`** is off in production unless `ENABLE_DESIGN_SYSTEM=true`.
- **Marketing pages** live in `app/(marketing)/` with the shared `SiteHeader`/`SiteFooter` (`components/vidora/site-chrome.tsx`).
  Business details come from `lib/site.ts`; render them with `<SiteValue field=… />` so placeholders show highlighted.
  Long-form pages use `LegalPage` (70ch measure, table of contents, anchored sections).
- **Touch targets:** links inside running text are exempt from the 44px rule (WCAG 2.5.8 inline exception).
  Standalone links (nav, footer, table of contents) still get `min-h-11`.
