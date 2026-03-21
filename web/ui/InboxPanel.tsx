"use client";

import { useEffect, useRef } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

export interface Notification {
  id:         string;
  type:       string;
  data:       Record<string, string>;
  read:       boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  if (d < 30)  return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function renderNotification(n: Notification): { icon: string; text: string } {
  switch (n.type) {
    case "friend_added":
      return { icon: "+", text: `${n.data.from_username} added you as a friend` };
    case "challenge_received":
      return { icon: "!", text: `${n.data.from_username} challenged you (${n.data.mode})` };
    default:
      return { icon: "?", text: n.type };
  }
}

interface Props {
  open:          boolean;
  onClose:       () => void;
  notifications: Notification[];
  onMarkAllRead: () => void;
}

export function InboxPanel({ open, onClose, notifications, onMarkAllRead }: Props) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay listener so the opening click doesn't immediately close
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      ref={panelRef}
      style={{
        position:     "fixed",
        top:          48,
        right:        0,
        bottom:       0,
        width:        isMobile ? "100vw" : 340,
        background:   "var(--surface)",
        borderLeft:   "1px solid var(--border)",
        zIndex:       50,
        display:      "flex",
        flexDirection: "column",
        fontFamily:   "monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          display:       "flex",
          alignItems:    "center",
          justifyContent: "space-between",
          padding:       "12px 16px",
          borderBottom:  "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: 2,
            color:         "var(--text3)",
            textTransform: "uppercase",
          }}
        >
          Inbox {unreadCount > 0 && `(${unreadCount})`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              style={{
                background:    "transparent",
                border:        "none",
                color:         "var(--accent)",
                fontSize:      10,
                fontFamily:    "monospace",
                cursor:        "pointer",
                padding:       0,
                letterSpacing: 0.3,
              }}
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background:  "transparent",
              border:      "none",
              color:       "var(--text3)",
              fontSize:    14,
              cursor:      "pointer",
              padding:     "0 2px",
              lineHeight:  1,
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {notifications.length === 0 && (
          <div
            style={{
              padding:    "2rem 16px",
              color:      "var(--text3)",
              fontSize:   11,
              textAlign:  "center",
            }}
          >
            No notifications yet
          </div>
        )}
        {notifications.map((n) => {
          const { icon, text } = renderNotification(n);
          return (
            <div
              key={n.id}
              style={{
                padding:      "10px 16px",
                borderBottom: "1px solid var(--border)",
                background:   n.read ? "transparent" : "var(--surface2, rgba(255,255,255,0.03))",
                display:      "flex",
                gap:          10,
                alignItems:   "flex-start",
              }}
            >
              <span
                style={{
                  fontSize:     11,
                  fontWeight:   700,
                  color:        n.read ? "var(--text3)" : "var(--accent)",
                  flexShrink:   0,
                  width:        16,
                  textAlign:    "center",
                  lineHeight:   "18px",
                }}
              >
                {icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize:   11,
                    color:      n.read ? "var(--text3)" : "var(--text)",
                    lineHeight: "18px",
                  }}
                >
                  {text}
                </div>
                <div
                  style={{
                    fontSize:  9,
                    color:     "var(--text3)",
                    marginTop: 2,
                  }}
                >
                  {timeAgo(n.created_at)}
                </div>
              </div>
              {!n.read && (
                <span
                  style={{
                    width:        6,
                    height:       6,
                    borderRadius: "50%",
                    background:   "var(--accent)",
                    flexShrink:   0,
                    marginTop:    6,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
