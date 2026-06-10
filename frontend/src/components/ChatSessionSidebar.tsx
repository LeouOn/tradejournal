import { X, Plus, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "../lib/relativeTime";

export interface ChatSession {
  session_id: string;
  title: string;
  account_id: string;
  created_at: string;
  updated_at: string;
}

interface ChatSessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export default function ChatSessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
}: ChatSessionSidebarProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
      }}
    >
      {/* New Chat Button */}
      <div style={{ padding: "8px", borderBottom: "1px solid var(--border-color)" }}>
        <button
          className="btn-primary"
          style={{
            width: "100%",
            padding: "8px",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
          onClick={onNewChat}
        >
          <Plus size={14} />
          New Chat
        </button>
      </div>

      {/* Session List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sessions.length === 0 && (
          <div
            style={{
              padding: "16px",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
            }}
          >
            No chat sessions yet
          </div>
        )}
        {sessions.map((session) => {
          const isActive = session.session_id === activeSessionId;
          return (
            <div
              key={session.session_id}
              onClick={() => onSelectSession(session.session_id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                cursor: "pointer",
                background: isActive ? "var(--accent-bg)" : "transparent",
                borderLeft: isActive
                  ? "3px solid var(--accent-blue)"
                  : "3px solid transparent",
                transition: "background 0.15s",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "var(--bg-primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <MessageSquare size={12} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {session.title}
                  </span>
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", paddingLeft: "18px" }}>
                  {formatRelativeTime(session.updated_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Delete this chat session and its messages?")) {
                    onDeleteSession(session.session_id);
                  }
                }}
                title="Delete session"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  padding: "2px",
                  display: "flex",
                  alignItems: "center",
                  opacity: 0.4,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.color = "var(--color-error)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.4";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
