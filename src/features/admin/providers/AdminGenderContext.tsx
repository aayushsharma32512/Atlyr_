import { createContext, useContext, useState, type ReactNode } from "react"

type Gender = "male" | "female"

interface AdminGenderContextValue {
  selectedGender: Gender
  setSelectedGender: (gender: Gender) => void
}

const AdminGenderContext = createContext<AdminGenderContextValue | null>(null)

export function useAdminGender() {
  const context = useContext(AdminGenderContext)
  if (!context) {
    throw new Error("useAdminGender must be used within AdminGenderProvider")
  }
  return context
}

/**
 * Returns admin-selected gender if in admin context, otherwise null.
 * Use this to optionally override profile gender in shared components.
 */
export function useOptionalAdminGender(): Gender | null {
  const context = useContext(AdminGenderContext)
  return context?.selectedGender ?? null
}

interface AdminGenderProviderProps {
  children: ReactNode
  defaultGender?: Gender
}

export function AdminGenderProvider({ 
  children, 
  defaultGender = "female" 
}: AdminGenderProviderProps) {
  // Initialize from localStorage or default
  const [selectedGender, _setSelectedGender] = useState<Gender>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("admin_studio_gender")
      if (saved === "male" || saved === "female") {
        return saved
      }
    }
    return defaultGender
  })

  const setSelectedGender = (gender: Gender) => {
    _setSelectedGender(gender)
    localStorage.setItem("admin_studio_gender", gender)
  }

  return (
    <AdminGenderContext.Provider value={{ selectedGender, setSelectedGender }}>
      {children}
    </AdminGenderContext.Provider>
  )
}
