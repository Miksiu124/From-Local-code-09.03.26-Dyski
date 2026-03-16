"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationBellProps {
  dropdownAnchorRef?: React.RefObject<HTMLDivElement | null>; // deprecated, kept for backwards compat
}

export function NotificationBell({ dropdownAnchorRef }: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sseConnected = useRef(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    const es = new EventSource("/api/notifications/stream", { withCredentials: true });

    es.onopen = () => {
      sseConnected.current = true;
    };

    es.onmessage = () => {
      fetchNotifications();
    };

    es.onerror = () => {
      sseConnected.current = false;
    };

    /* Only poll when SSE is disconnected — avoid redundant fetches when stream is active */
    const interval = setInterval(() => {
      if (!sseConnected.current) {
        fetchNotifications();
      }
    }, 60000);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllRead = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    } catch {
      // silent
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "relative h-9 w-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer",
          open ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
        )}
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ type: "spring", damping: 25, stiffness: 400 }}
              className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-2rem))] sm:w-96 max-h-[28rem] rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]"
            >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="overflow-y-auto max-h-[22rem] scrollbar-thin">
              {loading && notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 flex flex-col items-center text-center">
                  <BellOff className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No notifications</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors",
                      !n.isRead && "bg-primary/[0.03]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && (
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                      )}
                      <div className={cn("flex-1 min-w-0", n.isRead && "ml-4")}>
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words line-clamp-4">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground/50 mt-1">{formatDate(n.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
