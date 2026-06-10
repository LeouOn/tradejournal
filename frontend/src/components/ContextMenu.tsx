import { useState, useEffect, useRef } from "react";
import { BookOpen, TrendingUp, BarChart3, ChevronDown } from "lucide-react";
import type { ContextFlags } from "../lib/contextFlags";

interface ContextMenuProps {
  flags: ContextFlags;
  onFlagsChange: (flags: ContextFlags) => void;
}

interface MenuOption {
  key: keyof ContextFlags;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const MENU_OPTIONS: MenuOption[] = [
  {
    key: "recentTrades",
    label: "Recent Trades",
    icon: <TrendingUp size={14} />,
    description: "Include last 5 trades in context",
  },
  {
    key: "performanceStats",
    label: "Performance Stats",
    icon: <BarChart3 size={14} />,
    description: "Include metrics summary",
  },
  {
    key: "playbookRules",
    label: "Playbook Rules",
    icon: <BookOpen size={14} />,
    description: "Include playbook edge guidelines",
  },
];

export default function ContextMenu({ flags, onFlagsChange }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const activeCount = Object.values(flags).filter(Boolean).length;

  const toggleFlag = (key: keyof ContextFlags) => {
    onFlagsChange({ ...flags, [key]: !flags[key] });
  };

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn-secondary"
        style={{
          padding: "10px",
          height: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          borderColor: activeCount > 0 ? "var(--accent-blue)" : undefined,
          color: activeCount > 0 ? "var(--accent-blue)" : undefined,
        }}
        onClick={() => setIsOpen(!isOpen)}
        title="Context options"
      >
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>@</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: "8px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "6px 0",
            minWidth: "220px",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              padding: "6px 12px 8px",
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              borderBottom: "1px solid var(--border-color)",
              marginBottom: "4px",
              fontWeight: 600,
            }}
          >
            Context Injection ({activeCount} active)
          </div>
          {MENU_OPTIONS.map((opt) => {
            const isActive = flags[opt.key];
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleFlag(opt.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontSize: "0.82rem",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "3px",
                    border: isActive
                      ? "2px solid var(--accent-blue)"
                      : "2px solid var(--text-secondary)",
                    background: isActive ? "var(--accent-blue)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: "10px",
                    color: "white",
                    fontWeight: 700,
                  }}
                >
                  {isActive ? "✓" : ""}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-secondary)" }}>
                  {opt.icon}
                </span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span>{opt.label}</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                    {opt.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
