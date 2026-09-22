import { supabase } from "@/integrations/supabase/client"

import type { UserNotification, UserNotificationKind } from "./types"

type Row = {
  id: string
  kind: string
  title: string
  body: string | null
  href: string | null
  product_id: string | null
  read_at: string | null
  created_at: string
}

const COLUMNS = "id,kind,title,body,href,product_id,read_at,created_at"

function toNotification(row: Row): UserNotification {
  return {
    id: row.id,
    kind: row.kind as UserNotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    productId: row.product_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

async function listRecent(limit = 30): Promise<UserNotification[]> {
  const { data, error } = await supabase
    .from("user_notifications")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toNotification)
}

async function listUnread(limit = 30): Promise<UserNotification[]> {
  const { data, error } = await supabase
    .from("user_notifications")
    .select(COLUMNS)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(toNotification)
}

async function markRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw new Error(error.message)
}

export const notificationsService = { listRecent, listUnread, markRead }
