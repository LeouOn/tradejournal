import { useSettings, type ThemeId } from "../contexts/SettingsContext";
import { Palette, Monitor, Zap, PanelLeft, RotateCcw } from "lucide-react";

const themes: { id: ThemeId; name: string; desc: string; preview: { bg: string; accent: string; text: string } }[] = [
  { id: "default", name: "Cyber Dark", desc: "Deep navy glassmorphism with cyan accents", preview: { bg: "#060c14", accent: "#00e5ff", text: "#f0f4f8" } },
  { id: "midnight", name: "Midnight Indigo", desc: "Soft indigo-purple tones on dark slate", preview: { bg: "#08090f", accent: "#7c8aff", text: "#e8eaf0" } },
  { id: "terminal", name: "Terminal Green", desc: "Monochrome hacker terminal aesthetic", preview: { bg: "#0a0a0a", accent: "#00ff88", text: "#b0ffb0" } },
  { id: "arctic", name: "Arctic Frost", desc: "Cool sky-blue on deep ocean darks", preview: { bg: "#0b1520", accent: "#38bdf8", text: "#e0f0ff" } },
  { id: "light", name: "Daylight", desc: "Clean light mode with blue accents", preview: { bg: "#f0f2f5", accent: "#0091ea", text: "#1a1a2e" } },
];

export default function Settings() {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <div style={{ maxWidth: "720px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Settings</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "4px" }}>Appearance, behavior, and preferences</p>
        </div>
        <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "6px" }} onClick={resetSettings}>
          <RotateCcw size={13} />
          Reset All
        </button>
      </div>

      <section style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Palette size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>Theme</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => updateSettings({ theme: t.id })}
              style={{
                background: settings.theme === t.id ? "var(--accent-bg-strong)" : "var(--glass-bg)",
                border: settings.theme === t.id ? "2px solid var(--accent-blue)" : "2px solid var(--border-color)",
                borderRadius: "10px",
                padding: "14px",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color var(--transition-fast), background var(--transition-fast)",
              }}
            >
              <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
                <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: t.preview.bg, border: "1px solid var(--border-color)" }} />
                <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: t.preview.accent }} />
                <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: t.preview.text }} />
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>{t.name}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "2px" }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Monitor size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>Display</h3>
        </div>
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <ToggleRow
            label="Compact Sidebar"
            desc="Reduce sidebar width for more content space"
            value={settings.compactSidebar}
            onChange={(v) => updateSettings({ compactSidebar: v })}
          />
          <ToggleRow
            label="Glow Effects"
            desc="Pulsing glow on highlighted panels and badges"
            value={settings.showGlowEffects}
            onChange={(v) => updateSettings({ showGlowEffects: v })}
          />
        </div>
      </section>

      <section style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Zap size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>Animation Speed</h3>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["normal", "fast", "none"] as const).map((speed) => (
            <button
              key={speed}
              className="btn-secondary"
              onClick={() => updateSettings({ animationSpeed: speed })}
              style={{
                flex: 1,
                padding: "10px",
                fontSize: "0.8rem",
                textAlign: "center",
                borderColor: settings.animationSpeed === speed ? "var(--accent-blue)" : undefined,
                background: settings.animationSpeed === speed ? "var(--accent-bg-strong)" : undefined,
              }}
            >
              {speed === "normal" ? "Normal" : speed === "fast" ? "Fast" : "Disabled"}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <PanelLeft size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>About</h3>
        </div>
        <div className="glass-panel" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
          <div><strong style={{ color: "var(--text-primary)" }}>Antigravity Journal</strong> &mdash; Quantitative Trading Performance System</div>
          <div>Version 1.0.0 &middot; Built with React + Express + Prisma + LM Studio</div>
          <div>AI Coach powered by local LLM inference via OpenAI-compatible API</div>
        </div>
      </section>
    </div>
  );
}

function ToggleRow({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          cursor: "pointer",
          background: value ? "var(--accent-blue)" : "var(--bg-tertiary)",
          position: "relative",
          transition: "background var(--transition-fast)",
        }}
      >
        <div
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "var(--text-primary)",
            position: "absolute",
            top: "3px",
            left: value ? "23px" : "3px",
            transition: "left var(--transition-fast)",
          }}
        />
      </button>
    </div>
  );
}
