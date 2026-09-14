import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The design system's type roles and fluid steps are custom `text-*` keys
 * (tailwind.config.ts fontSize, plus a few legacy utilities in index.css).
 * tailwind-merge only knows Tailwind's own sizes, so it read `text-card` as a
 * colour and silently dropped it whenever `text-ink` followed in the same
 * cn() call — half the app's type was falling back to inherited sizes.
 * src/lib/__tests__/cn.test.ts keeps this list in step with the config.
 */
export const CUSTOM_FONT_SIZES = [
  "xxs",
  "xs2",
  "fluid-2xs",
  "fluid-xs",
  "fluid-xs2",
  "fluid-sm",
  "fluid-base",
  "fluid-md",
  "fluid-lg",
  "fluid-cta",
  "fluid-h2",
  "fluid-h1",
  "fluid-mark-firstrun",
  "fluid-mark-landing",
  "title-lg",
  "title",
  "moment",
  "label",
  "body",
  "card",
  "chip",
  "section",
  "body-large",
  "display",
  "header",
  "secondary-2",
] as const

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...CUSTOM_FONT_SIZES] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
