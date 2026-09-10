import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "supabase/functions/**", "src/components/vto/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Design-token gate (docs/redesign/). Keeps arbitrary px, hex and raw palette
  // classes from creeping back in. Warnings for now — promote to "error" with the
  // Collections PR. App surfaces only; admin, landing and components/ui are exempt.
  {
    files: [
      "src/features/**/*.{ts,tsx}",
      "src/design-system/**/*.{ts,tsx}",
      "src/layouts/**/*.{ts,tsx}",
    ],
    ignores: ["src/features/landing-page/**"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/text-\\[[0-9.]+px\\]/]",
          message:
            "Arbitrary font size. Use a type role: text-title-lg | text-title | text-moment | text-label | text-body | text-card | text-chip | text-section. See docs/redesign/COMPONENTS.md.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/text-\\[[0-9.]+px\\]/]",
          message:
            "Arbitrary font size. Use a type role: text-title-lg | text-title | text-moment | text-label | text-body | text-card | text-chip | text-section. See docs/redesign/COMPONENTS.md.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/rounded(-[a-z]+)?-\\[[0-9.]+px\\]/]",
          message:
            "Arbitrary radius. The scale is 2/3/5/6: rounded-badge (seals) | rounded-control (buttons, chips, fields) | rounded-lg (cards) | rounded-frame (frames, canvas).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/rounded(-[a-z]+)?-\\[[0-9.]+px\\]/]",
          message:
            "Arbitrary radius. The scale is 2/3/5/6: rounded-badge (seals) | rounded-control (buttons, chips, fields) | rounded-lg (cards) | rounded-frame (frames, canvas).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(bg|text|border|fill|stroke|ring|from|to|via)-\\[#[0-9a-fA-F]{3,8}\\]/]",
          message:
            "Raw hex colour. Use a brand token: ink | terracotta | gold | taupe | hairline | muted | background. Gold is provenance only.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(bg|text|border|fill|stroke|ring|from|to|via)-\\[#[0-9a-fA-F]{3,8}\\]/]",
          message:
            "Raw hex colour. Use a brand token: ink | terracotta | gold | taupe | hairline | muted | background. Gold is provenance only.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)/]",
          message:
            "Raw Tailwind palette colour. The app runs on the Kalagriha ramp: ink | terracotta | gold | taupe | hairline | muted | editorial | skeleton.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)/]",
          message:
            "Raw Tailwind palette colour. The app runs on the Kalagriha ramp: ink | terracotta | gold | taupe | hairline | muted | editorial | skeleton.",
        },
      ],
    },
  }
);
