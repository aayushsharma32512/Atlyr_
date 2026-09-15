import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useCandidateThemes } from "../hooks/useCandidateThemes"

interface ThemePickerListProps {
    onSelectTheme: (themeId: string) => void
}

/** The 20 themes, each showing a live count of pairs still pending review. */
export function ThemePickerList({ onSelectTheme }: ThemePickerListProps) {
    const { data: themes, isLoading, error } = useCandidateThemes()

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
            </div>
        )
    }

    if (error) {
        return (
            <div className="py-12 text-center text-destructive">
                Failed to load themes: {error.message}
            </div>
        )
    }

    if (!themes || themes.length === 0) {
        return <div className="py-12 text-center text-muted-foreground">No themes found</div>
    }

    const totalPending = themes.reduce((sum, theme) => sum + theme.pendingCount, 0)

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Themes</CardTitle>
                <CardDescription>
                    {themes.length} themes &middot; {totalPending} pairs pending review
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <ul className="divide-y divide-border">
                    {themes.map((theme) => (
                        <li key={theme.theme_id}>
                            <button
                                type="button"
                                onClick={() => onSelectTheme(theme.theme_id)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                            >
                                <span className="text-sm font-medium text-foreground">{theme.theme_name}</span>
                                <Badge
                                    variant={theme.pendingCount > 0 ? "secondary" : "outline"}
                                    className={
                                        theme.pendingCount > 0
                                            ? "text-violet"
                                            : "border-violet text-foreground"
                                    }
                                >
                                    {theme.pendingCount} pending
                                </Badge>
                            </button>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}
