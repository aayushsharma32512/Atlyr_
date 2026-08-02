import { ChevronRight } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useCollectionsOverview } from "@/features/collections/hooks/useMoodboards"
import { MannequinHeadAvatar } from "@/features/profile/components/MannequinHeadAvatar"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import { useDailyLimits } from "@/features/profile/hooks/useDailyLimits"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { AppShellLayout } from "@/layouts/AppShellLayout"

type ProfileRowProps = {
  label: string
  value: string
  onClick: () => void
}

function ProfileRow({ label, value, onClick }: ProfileRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-16 w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="shrink-0 text-[15px] font-semibold text-foreground">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right text-sm font-medium text-muted-foreground">
        {value}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  )
}

function formatJoinedDate(dateValue?: string | null) {
  if (!dateValue) return null

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null

  const month = new Intl.DateTimeFormat("en", { month: "short" }).format(date)
  return `${month} '${String(date.getFullYear()).slice(-2)}`
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatAgeAndGender(age?: number | null, gender?: "male" | "female" | null) {
  const parts = [
    typeof age === "number" ? `${age} years` : null,
    gender ? `${gender.charAt(0).toUpperCase()}${gender.slice(1)}` : null,
  ].filter(Boolean)

  return parts.length ? parts.join(" · ") : "Not set"
}

function ProfilePageView() {
  const { profile, gender, skinTone, hairStyleId, hairColorHex } = useProfileContext()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const hairStylesQuery = useAvatarHairStyles(gender)
  const limitsQuery = useDailyLimits()
  const collectionsQuery = useCollectionsOverview()

  const resolvedHairStyle = (() => {
    if (!hairStylesQuery.data.length) return null
    if (hairStyleId && hairStylesQuery.byId.has(hairStyleId)) {
      return hairStylesQuery.byId.get(hairStyleId) ?? null
    }
    return hairStylesQuery.defaultStyle
  })()

  const moodboards = collectionsQuery.data?.moodboards ?? []
  const wardrobe = moodboards.find((board) => board.slug === "wardrobe")
  const boardPinCount = moodboards.reduce((total, board) => total + board.itemCount, 0)

  const tryon = limitsQuery.data?.tryon
  const tryonsRemaining = tryon ? Math.max(tryon.limit - tryon.count, 0) : null

  const profileName = profile?.name?.trim() || "Your profile"
  const profileInitial = profileName.charAt(0).toUpperCase()
  const joinedDate = formatJoinedDate(user?.created_at ?? profile?.created_at)
  const handleLogout = async () => {
    await signOut()
    navigate("/")
  }

  return (
    <div className="min-h-[calc(100dvh-55px)] bg-background text-foreground">
      <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-6 sm:px-6 sm:pt-8">
        <header className="flex items-end justify-between gap-4 px-1">
          <h1 className="min-w-0 truncate font-display text-[38px] font-medium leading-none tracking-[-0.025em] text-foreground sm:text-[42px]">
            {profileName}
          </h1>
          {joinedDate ? (
            <p className="shrink-0 pb-0.5 text-sm font-medium text-muted-foreground sm:text-base">
              joined {joinedDate}
            </p>
          ) : null}
        </header>

        <button
          type="button"
          onClick={() => navigate("/profile/avatar")}
          className="group mt-7 flex min-h-36 w-full items-center gap-5 rounded-lg border border-hairline bg-card p-4 text-left shadow-xs hover:border-hairline-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
        >
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-muted/30 sm:size-28">
            {gender ? (
              <MannequinHeadAvatar
                size={88}
                gender={gender}
                skinToneHex={skinTone}
                hairStyle={
                  resolvedHairStyle
                    ? { styleKey: resolvedHairStyle.styleKey, gender }
                    : null
                }
                hairColorHex={hairColorHex}
                className="rounded-md bg-transparent"
              />
            ) : (
              <span className="font-display text-3xl text-muted-foreground">{profileInitial}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-foreground">Your likeness</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Your saved avatar and likenesses
            </p>
          </div>

          <ChevronRight
            className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>

        <section
          className="mt-5 overflow-hidden rounded-lg border border-hairline bg-card shadow-xs"
          aria-label="Profile details"
        >
          <ProfileRow
            label="Wardrobe"
            value={
              collectionsQuery.isLoading
                ? "Loading…"
                : pluralize(wardrobe?.itemCount ?? 0, "piece")
            }
            onClick={() => navigate("/collection")}
          />
          <ProfileRow
            label="Try-ons"
            value={
              limitsQuery.isLoading
                ? "Loading…"
                : tryonsRemaining === null || !tryon
                  ? "Unavailable"
                  : `${tryonsRemaining} of ${tryon.limit} left`
            }
            onClick={() => navigate("/home?moodboard=try-ons")}
          />
          <ProfileRow
            label="User details"
            value={formatAgeAndGender(profile?.age, gender)}
            onClick={() => navigate("/profile/user-details")}
          />
          <ProfileRow
            label="Boards"
            value={
              collectionsQuery.isLoading
                ? "Loading…"
                : `${pluralize(moodboards.length, "board")} · ${pluralize(boardPinCount, "pin")}`
            }
            onClick={() => navigate("/collection")}
          />
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="mx-auto mt-8 block min-h-11 px-5 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

function ProfilePage() {
  return (
    <AppShellLayout>
      <ProfilePageView />
    </AppShellLayout>
  )
}

export default ProfilePage
