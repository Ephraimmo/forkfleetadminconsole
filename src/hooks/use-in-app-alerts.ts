import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStaffSession } from "@/hooks/use-staff-session";
import {
  fetchInboxOnce,
  markInboxItemRead,
  subscribeInbox,
  type InboxItem,
} from "@/lib/notifications.firebase";
import { listNotifications, markNotificationRead } from "@/lib/notifications.functions";

/**
 * The signed-in user's in-app alert feed: Firebase alerts (audience-targeted,
 * real-time, with per-user read receipts) merged with the seeded demo
 * notifications. Drop-in shape for the shell bell ({ id, title, body,
 * severity, created_at, read_at, link }).
 */
export function useInAppAlerts() {
  const staff = useStaffSession();
  const queryClient = useQueryClient();
  const session = staff.session;
  const userId = session?.userId ?? null;
  const roles = useMemo(() => session?.roles ?? [], [session]);

  const queryKey = useMemo(() => ["in-app-alerts", userId] as const, [userId]);

  const query = useQuery<InboxItem[]>({
    queryKey,
    queryFn: async () => {
      const firebaseItems = await fetchInboxOnce({ userId: userId ?? "", roles });
      const demoItems = await listNotifications({ unreadOnly: false });
      const merged: InboxItem[] = [
        ...firebaseItems,
        ...demoItems.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          severity: item.severity,
          created_at: item.created_at,
          read_at: item.read_at,
          link: item.link,
          source: "demo" as const,
          trigger_name: item.trigger ?? null,
        })),
      ];
      return merged.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 40);
    },
    enabled: !!userId,
    staleTime: 15_000,
  });

  // Real-time: new alerts and read receipts stream straight into the feed.
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    return subscribeInbox({ userId, roles }, (rows) => {
      queryClient.setQueryData<InboxItem[]>(queryKey, (previous = []) => {
        const demoItems = previous.filter((item) => item.source === "demo");
        return [...rows, ...demoItems]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 40);
      });
    });
  }, [userId, roles, queryClient, queryKey]);

  const items = query.data ?? [];
  const unreadCount = items.filter((item) => !item.read_at).length;

  async function markRead(item: InboxItem): Promise<void> {
    if (item.read_at) return;
    if (item.source === "firebase" && userId) {
      await markInboxItemRead({ alertId: item.id, userId });
    } else {
      await markNotificationRead({ id: item.id });
      void queryClient.invalidateQueries({ queryKey: queryKey });
    }
  }

  async function markAllRead(): Promise<void> {
    const unread = items.filter((item) => !item.read_at);
    await Promise.all(unread.map((item) => markRead(item)));
  }

  return { ...query, items, unreadCount, markRead, markAllRead };
}
