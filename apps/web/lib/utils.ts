import { createCn } from "cn/config"

// Teach the class merger Vidora's DESIGN.md type scale, so `text-body-sm` (a size)
// never cancels `text-ink` (a color) or the other way round.
const TYPE_SCALE = [
  "display-xl",
  "display-lg",
  "display-md",
  "display-sub-lg",
  "display-sub-md",
  "display-sub-sm",
  "display-xs",
  "body-lg",
  "body-md",
  "body-md-strong",
  "body-sm",
  "body-sm-strong",
  "caption",
  "eyebrow",
  "button-md",
  "button-sm",
]

export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: TYPE_SCALE }] } },
})
