import { useState } from "react"

import { AppShellLayout } from "@/layouts/AppShellLayout"
import { ThemePickerList } from "@/features/outfit-screener-review/components/ThemePickerList"
import { ThemeQueueView } from "@/features/outfit-screener-review/components/ThemeQueueView"

/**
 * Admin review queue for AI-generated top/bottom outfit candidates: pick a
 * theme, then accept or reject its pairs one at a time.
 */
export default function OutfitScreenerDashboard() {
    const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)

    return (
        <AppShellLayout>
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
                <div>
                    <h1 className="text-2xl font-semibold text-foreground">Outfit Screener</h1>
                    <p className="text-sm text-muted-foreground">
                        Review generated top/bottom pairings, theme by theme. Accept or reject one at a time.
                    </p>
                </div>

                {selectedThemeId ? (
                    <ThemeQueueView themeId={selectedThemeId} onBack={() => setSelectedThemeId(null)} />
                ) : (
                    <ThemePickerList onSelectTheme={setSelectedThemeId} />
                )}
            </div>
        </AppShellLayout>
    )
}
