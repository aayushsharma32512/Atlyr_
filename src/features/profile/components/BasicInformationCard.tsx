import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import { MannequinHeadAvatar } from "@/features/profile/components/MannequinHeadAvatar"

interface BasicInformationCardProps {
  name: string
  age: string
  gender: string
  skinTone?: string | null
  hairStyleId?: string | null
  hairColorHex?: string | null
  onNameChange: (name: string) => void
  onAgeChange: (age: string) => void
  onGenderChange: (gender: string) => void
}

export function BasicInformationCard({
  name,
  age,
  gender,
  skinTone,
  hairStyleId,
  hairColorHex,
  onNameChange,
  onAgeChange,
  onGenderChange,
}: BasicInformationCardProps) {
  const { profile, skinTone: profileSkinTone, hairStyleId: profileHairStyleId, hairColorHex: profileHairColorHex } = useProfileContext()
  const fallbackName = name || profile?.name || "User"
  const fallbackInitial = fallbackName.trim() ? fallbackName.trim().charAt(0).toUpperCase() : "U"
  const resolvedGender: "male" | "female" | null =
    gender === "male" || gender === "female"
      ? gender
      : profile?.gender === "male" || profile?.gender === "female"
        ? profile.gender
        : null
  const resolvedSkinTone = skinTone ?? profileSkinTone ?? null
  const resolvedHairStyleId = hairStyleId ?? profileHairStyleId ?? null
  const resolvedHairColorHex = hairColorHex ?? profileHairColorHex ?? null
  const hairStylesQuery = useAvatarHairStyles(resolvedGender)
  const resolvedHairStyle = (() => {
    if (!hairStylesQuery.data.length) return null
    if (resolvedHairStyleId && hairStylesQuery.byId.has(resolvedHairStyleId)) {
      return hairStylesQuery.byId.get(resolvedHairStyleId) ?? null
    }
    return hairStylesQuery.defaultStyle
  })()

  return (
    <div className="bg-card rounded-[18px] p-6 border border-border" style={{ boxSizing: "border-box" }}>
      <h3 className="text-sm font-medium text-foreground mb-4">Basic Information</h3>
      <div className="flex items-start gap-4">
        {/* Profile Picture */}
        <div className="w-16 h-16 flex-shrink-0">
          {resolvedGender ? (
            <MannequinHeadAvatar
              size={64}
              gender={resolvedGender}
              skinToneHex={resolvedSkinTone}
              hairStyle={
                resolvedHairStyle
                  ? {
                      assetUrl: resolvedHairStyle.assetUrl,
                      lengthPct: resolvedHairStyle.lengthPct,
                      yOffsetPct: resolvedHairStyle.yOffsetPct,
                      xOffsetPct: resolvedHairStyle.xOffsetPct,
                      zIndex: resolvedHairStyle.zIndex,
                    }
                  : null
              }
              hairColorHex={resolvedHairColorHex}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {fallbackInitial}
            </div>
          )}
        </div>

        {/* Form Fields */}
        <div className="flex-1 space-y-4">
          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm text-foreground">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              className="w-full"
            />
          </div>

          {/* Age and Gender Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Age Select */}
            <div className="space-y-2">
              <Label htmlFor="age" className="text-sm text-foreground">
                Age
              </Label>
              <Select value={age || undefined} onValueChange={onAgeChange}>
                <SelectTrigger id="age" className="w-full">
                  <SelectValue placeholder="Select age" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 83 }, (_, i) => i + 18).map((age) => (
                    <SelectItem key={age} value={age.toString()}>
                      {age}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Gender Select */}
            <div className="space-y-2">
              <Label htmlFor="gender" className="text-sm text-foreground">
                Gender
              </Label>
              <Select value={gender || undefined} onValueChange={onGenderChange}>
                <SelectTrigger id="gender" className="w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
