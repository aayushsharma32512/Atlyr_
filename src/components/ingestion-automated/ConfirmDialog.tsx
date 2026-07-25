import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}

// Styled confirm dialog replacing native window.confirm() — replicates the design
// prototype's confirm-delete popup (Atlyr Prototype.dc.html:46-57). Reuses the shadcn
// AlertDialog so it's theme-aware and focus-trapped.
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive, onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-xs leading-relaxed">{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn('h-8 text-xs', destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
