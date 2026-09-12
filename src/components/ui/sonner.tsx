import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

// Compact card with a visible cross. Width is capped in index.css (.toaster)
// so on phones it no longer stretches into a full-width bar.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      offset={12}
      mobileOffset={12}
      closeButton
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:items-start group-[.toaster]:gap-2 group-[.toaster]:rounded-lg group-[.toaster]:border-hairline group-[.toaster]:bg-card group-[.toaster]:py-2.5 group-[.toaster]:pl-3 group-[.toaster]:pr-8 group-[.toaster]:text-ink group-[.toaster]:shadow-floating",
          title: "group-[.toast]:text-[12px] group-[.toast]:font-semibold group-[.toast]:leading-snug",
          description: "group-[.toast]:mt-0.5 group-[.toast]:text-[11px] group-[.toast]:leading-snug group-[.toast]:text-taupe",
          icon: "group-[.toast]:mt-px group-[.toast]:size-3.5 group-[.toast]:[&>svg]:size-3.5",
          actionButton:
            "group-[.toast]:h-6 group-[.toast]:rounded-control group-[.toast]:bg-primary group-[.toast]:px-2 group-[.toast]:text-[11px] group-[.toast]:font-semibold group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:h-6 group-[.toast]:rounded-control group-[.toast]:bg-muted group-[.toast]:px-2 group-[.toast]:text-[11px] group-[.toast]:text-muted-foreground",
          // Sonner hangs the cross off the top-left corner; we tuck it into the
          // top-right of the card, where a dismiss control is expected.
          closeButton:
            "group-[.toast]:left-auto group-[.toast]:right-1.5 group-[.toast]:top-1.5 group-[.toast]:size-5 group-[.toast]:translate-x-0 group-[.toast]:translate-y-0 group-[.toast]:rounded-control group-[.toast]:border-hairline group-[.toast]:bg-card group-[.toast]:text-taupe group-[.toast]:hover:text-ink",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
