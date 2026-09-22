export type UserNotificationKind = "wardrobe_item_added"

export type UserNotification = {
  id: string
  kind: UserNotificationKind
  title: string
  body: string | null
  href: string | null
  productId: string | null
  readAt: string | null
  createdAt: string
}
