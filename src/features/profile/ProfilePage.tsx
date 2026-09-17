import { ChevronRight } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useCollectionsOverview } from "@/features/collections/hooks/useMoodboards"
import { useLikenessListQuery } from "@/features/likeness/hooks/useLikenessListQuery"
import { ProfileIdentityCard } from "@/features/profile/components/ProfileIdentityCard"
import { useDailyLimits } from "@/features/profile/hooks/useDailyLimits"
import { useProfilePhotoMutation, useProfileUpdateMutation } from "@/features/profile/hooks/useProfileQuery"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useToast } from "@/hooks/use-toast"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { boardPath } from "@/features/collections/boardUrl"

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

  return parts.length ? parts.join(" · ") : "Add your age and gender"
}

function readPhotoUrl(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.avatar_url
  return typeof value === "string" && value.length > 0 ? value : null
}

function ProfilePageView() {
  const { profile, gender } = useProfileContext()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const limitsQuery = useDailyLimits()
  const collectionsQuery = useCollectionsOverview()
  const likenessQuery = useLikenessListQuery({ enabled: Boolean(user) })
  const updateProfileMutation = useProfileUpdateMutation()
  const photoMutation = useProfilePhotoMutation()

  const moodboards = collectionsQuery.data?.moodboards ?? []
  const wardrobe = moodboards.find((board) => board.slug === "wardrobe")
  const boardPinCount = moodboards.reduce((total, board) => total + board.itemCount, 0)

  const tryon = limitsQuery.data?.tryon
  const tryonsRemaining = tryon ? Math.max(tryon.limit - tryon.count, 0) : null

  const profileName = profile?.name?.trim() || "Your profile"
  const joinedDate = formatJoinedDate(user?.created_at ?? profile?.created_at)
  const likenessCount = likenessQuery.data?.length ?? 0

  const handleSaveName = (name: string) => {
    updateProfileMutation.mutate(
      { name },
      { onError: () => toast({ title: "Could not save name", variant: "destructive" }) },
    )
  }
  const handlePickPhoto = (file: File) => {
    photoMutation.mutate(file, {
      onError: (error) => toast({ title: "Could not upload photo", description: error.message, variant: "destructive" }),
    })
  }
  const handleLogout = async () => {
    await signOut()
    navigate("/")
  }

  return (
    <div className="min-h-[calc(100dvh-55px)] bg-background text-foreground">
      <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-6 sm:px-6 sm:pt-8">
        <ProfileIdentityCard
          name={profileName}
          photoUrl={readPhotoUrl(user?.user_metadata)}
          detailsLine={formatAgeAndGender(profile?.age, gender)}
          email={user?.email ?? null}
          joinedLine={joinedDate}
          isSavingName={updateProfileMutation.isPending}
          isUploadingPhoto={photoMutation.isPending}
          onSaveName={handleSaveName}
          onPickPhoto={handlePickPhoto}
          onEditDetails={() => navigate("/profile/user-details")}
        />

        <section
          className="mt-5 overflow-hidden rounded-lg border border-hairline bg-white shadow-xs"
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
            onClick={() => navigate(boardPath("try-ons"))}
          />
          <ProfileRow
            label="Likeness"
            value={
              likenessQuery.isLoading
                ? "Loading…"
                : likenessCount
                  ? pluralize(likenessCount, "likeness", "likenesses")
                  : "Create yours"
            }
            onClick={() => navigate("/profile/avatar")}
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
