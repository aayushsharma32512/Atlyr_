import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			spacing: {
				104: "26rem",
				// Fluid rhythm, paired with the fontSize ramp below. See the
				// scale definition in src/index.css.
				'fluid-sm': 'var(--fluid-gap-sm)',
				'fluid-lg': 'var(--fluid-gap-lg)',
				'fluid-btn': 'var(--fluid-btn-y)',
			},
			fontFamily: {
				'sans': ['var(--font-sans)'],
				'serif': ['var(--font-serif)'],
				'mono': ['var(--font-mono)'],
				'display': ['var(--font-serif)'],
				// Brand surfaces only (कलागृह wordmark, taglines). Never UI copy.
				'deva': ['var(--font-deva)'],
			},
			fontSize: {
				xxs: ["0.5rem", { lineHeight: "0.75rem" }],
				xs2: ["0.625rem", { lineHeight: "0.875rem" }],
				// ── Fluid ramp for the Kalagriha surfaces. Values live in
				// src/index.css; these are the names the components use.
				// Deliberately bare strings rather than [size, { lineHeight }]
				// tuples — the gate and first-run screens set their own
				// leading-[1.35] / leading-[1.08], and a tuple here would ship a
				// competing line-height for every one of them to override.
				'fluid-2xs': 'var(--fluid-2xs)',
				'fluid-xs': 'var(--fluid-xs)',
				'fluid-xs2': 'var(--fluid-xs2)',
				'fluid-sm': 'var(--fluid-sm)',
				'fluid-base': 'var(--fluid-base)',
				'fluid-md': 'var(--fluid-md)',
				'fluid-lg': 'var(--fluid-lg)',
				'fluid-cta': 'var(--fluid-cta)',
				'fluid-h2': 'var(--fluid-h2)',
				'fluid-h1': 'var(--fluid-h1)',
				'fluid-mark-firstrun': 'var(--fluid-mark-firstrun)',
				'fluid-mark-landing': 'var(--fluid-mark-landing)',
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				chart: {
					1: 'hsl(var(--chart-1))',
					2: 'hsl(var(--chart-2))',
					3: 'hsl(var(--chart-3))',
					4: 'hsl(var(--chart-4))',
					5: 'hsl(var(--chart-5))'
				},
				// ── Tantu brand ramp. These sit outside the shadcn semantics on
				// purpose: `gold` in particular must never become --accent, or
				// every dropdown hover in the app turns into a provenance cue.
				ink: {
					DEFAULT: 'hsl(var(--ink))',
					deep: 'hsl(var(--ink-deep))',
					deepest: 'hsl(var(--ink-deepest))',
					soft: 'hsl(var(--ink-soft))',
					line: 'hsl(var(--ink-line))',
					body: 'hsl(var(--body-ink))'
				},
				'on-ink': {
					1: 'hsl(var(--on-ink-1))',
					2: 'hsl(var(--on-ink-2))',
					3: 'hsl(var(--on-ink-3))'
				},
				terracotta: {
					DEFAULT: 'hsl(var(--terracotta))',
					tint: 'hsl(var(--terracotta-tint))'
				},
				gold: {
					DEFAULT: 'hsl(var(--gold))',
					deep: 'hsl(var(--gold-deep))',
					muted: 'hsl(var(--gold-muted))'
				},
				taupe: 'hsl(var(--taupe))',
				faint: 'hsl(var(--faint))',
				editorial: 'hsl(var(--editorial))',
				skeleton: 'hsl(var(--skeleton))',
				hairline: {
					DEFAULT: 'hsl(var(--hairline))',
					2: 'hsl(var(--hairline-2))',
					3: 'hsl(var(--hairline-3))',
					4: 'hsl(var(--hairline-4))',
					dashed: 'hsl(var(--border-dashed))'
				},
				warp: 'hsl(var(--warp))'
			},
			borderRadius: {
				xl: 'calc(var(--radius) + 4px)',
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				'4xl': '2rem',
				// Kalagriha shape scale: buttons/chips/search = 3px, frames = 6px,
				// seals/badges = 2px. Cards stay on --radius (5px).
				frame: 'var(--radius-frame)',
				badge: 'var(--radius-badge)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
