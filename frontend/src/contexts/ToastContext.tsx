/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, Trophy, Heart, X } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "celebrate" | "nudge";

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number; // in ms
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, title?: string, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, title?: string, duration?: number) => void;
  error: (message: string, title?: string, duration?: number) => void;
  info: (message: string, title?: string, duration?: number) => void;
  celebrate: (message: string, title?: string, duration?: number) => void;
  nudge: (message: string, title?: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, title?: string, duration = 6000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message, duration }]);
    
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const success = useCallback((msg: string, title?: string, dur?: number) => addToast("success", msg, title || "Success", dur), [addToast]);
  const error = useCallback((msg: string, title?: string, dur?: number) => addToast("error", msg, title || "Error", dur), [addToast]);
  const info = useCallback((msg: string, title?: string, dur?: number) => addToast("info", msg, title || "Information", dur), [addToast]);
  const celebrate = useCallback((msg: string, title?: string, dur?: number) => addToast("celebrate", msg, title || "Disciplined Execution! 🏆", dur || 8000), [addToast]);
  const nudge = useCallback((msg: string, title?: string, dur?: number) => addToast("nudge", msg, title || "Growth Mindset 🧠", dur || 8000), [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, info, celebrate, nudge }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  return (
    <div
      style={{
        position: "fixed",
        top: "24px",
        right: "24px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxWidth: "400px",
        width: "100%",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const fadeTimer = setTimeout(() => {
        setIsFadingOut(true);
      }, toast.duration - 300); // start fade out 300ms before removing
      return () => clearTimeout(fadeTimer);
    }
  }, [toast.duration]);

  // Color theme mapping
  const themeMap = {
    success: {
      border: "rgba(0, 230, 118, 0.35)",
      bg: "rgba(6, 20, 14, 0.85)",
      accent: "#00e676",
      glow: "rgba(0, 230, 118, 0.15)",
      icon: <CheckCircle2 size={20} color="#00e676" />,
    },
    error: {
      border: "rgba(255, 45, 85, 0.35)",
      bg: "rgba(20, 6, 8, 0.85)",
      accent: "#ff2d55",
      glow: "rgba(255, 45, 85, 0.15)",
      icon: <AlertCircle size={20} color="#ff2d55" />,
    },
    info: {
      border: "rgba(0, 229, 255, 0.35)",
      bg: "rgba(6, 18, 20, 0.85)",
      accent: "#00e5ff",
      glow: "rgba(0, 229, 255, 0.15)",
      icon: <Info size={20} color="#00e5ff" />,
    },
    celebrate: {
      border: "rgba(255, 183, 0, 0.45)",
      bg: "rgba(20, 16, 6, 0.9)",
      accent: "#ffb700",
      glow: "rgba(255, 183, 0, 0.3)",
      icon: <Trophy size={22} color="#ffb700" style={{ filter: "drop-shadow(0 0 4px rgba(255, 183, 0, 0.5))" }} />,
    },
    nudge: {
      border: "rgba(160, 32, 240, 0.4)",
      bg: "rgba(12, 6, 20, 0.9)",
      accent: "#a020f0",
      glow: "rgba(160, 32, 240, 0.2)",
      icon: <Heart size={20} color="#ff75a0" style={{ fill: "#ff75a0", filter: "drop-shadow(0 0 4px rgba(255, 117, 160, 0.4))" }} />,
    },
  };

  const currentTheme = themeMap[toast.type];

  return (
    <div
      style={{
        pointerEvents: "auto",
        background: currentTheme.bg,
        border: `1px solid ${currentTheme.border}`,
        boxShadow: `0 8px 32px 0 rgba(0, 0, 0, 0.37), 0 0 15px ${currentTheme.glow}`,
        backdropFilter: "blur(12px)",
        borderRadius: "12px",
        padding: "16px",
        display: "flex",
        alignItems: "flex-start",
        gap: "14px",
        position: "relative",
        animation: isFadingOut ? "toast-fade-out 0.3s forwards" : "toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        transition: "transform 0.2s ease, opacity 0.2s ease",
      }}
      className="glass-panel"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "2px" }}>
        {currentTheme.icon}
      </div>
      
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
        {toast.title && (
          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {toast.title}
          </h4>
        )}
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
          {toast.message}
        </p>
      </div>

      <button
        onClick={onRemove}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          padding: "2px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "4px",
          transition: "background 0.2s, color 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <X size={14} />
      </button>

      {/* Progress timer bar */}
      {toast.duration && toast.duration > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: "3px",
            background: currentTheme.accent,
            borderRadius: "0 0 0 12px",
            animation: `toast-progress ${toast.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  );
}
