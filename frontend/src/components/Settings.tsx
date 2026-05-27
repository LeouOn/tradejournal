import React, { useState, useEffect } from "react";
import { useSettings, type ThemeId } from "../contexts/SettingsContext";
import { Palette, Monitor, Zap, PanelLeft, RotateCcw, Wallet, Brain } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const themes: { id: ThemeId; name: string; desc: string; preview: { bg: string; accent: string; text: string } }[] = [
  { id: "default", name: "Cyber Dark", desc: "Deep navy glassmorphism with cyan accents", preview: { bg: "#060c14", accent: "#00e5ff", text: "#f0f4f8" } },
  { id: "midnight", name: "Midnight Indigo", desc: "Soft indigo-purple tones on dark slate", preview: { bg: "#08090f", accent: "#7c8aff", text: "#e8eaf0" } },
  { id: "terminal", name: "Terminal Green", desc: "Monochrome hacker terminal aesthetic", preview: { bg: "#0a0a0a", accent: "#00ff88", text: "#b0ffb0" } },
  { id: "arctic", name: "Arctic Frost", desc: "Cool sky-blue on deep ocean darks", preview: { bg: "#0b1520", accent: "#38bdf8", text: "#e0f0ff" } },
  { id: "light", name: "Daylight", desc: "Clean light mode with blue accents", preview: { bg: "#f0f2f5", accent: "#0091ea", text: "#1a1a2e" } },
];

interface SettingsProps {
  accountId: string;
  onAccountUpdated: () => void;
}

export default function Settings({ accountId, onAccountUpdated }: SettingsProps) {
  const { settings, updateSettings, resetSettings } = useSettings();
  const toast = useToast();

  const [accountName, setAccountName] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [initialBalance, setInitialBalance] = useState<number | string>("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const fetchAccount = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/accounts");
        const accounts = await res.json();
        const acc = accounts.find((a: { account_id: string; account_name?: string; broker_name?: string; initial_balance?: number | string }) => a.account_id === accountId);
        if (acc) {
          setAccountName(acc.account_name || "");
          setBrokerName(acc.broker_name || "");
          setInitialBalance(Number(acc.initial_balance) || "");
        }
      } catch (err) {
        console.error("Failed to load account details in Settings:", err);
      }
    };
    fetchAccount();
  }, [accountId]);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    if (!accountName.trim()) {
      toast.error("Account Profile Name cannot be empty.");
      return;
    }
    const balanceNum = Number(initialBalance);
    if (isNaN(balanceNum) || balanceNum <= 0) {
      toast.error("Starting Capital must be a positive number.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`http://localhost:5000/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_name: accountName,
          broker_name: brokerName,
          initial_balance: balanceNum,
        }),
      });
      if (res.ok) {
        toast.success("Account capital settings updated successfully!");
        onAccountUpdated();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update account settings.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error while updating account settings.");
    } finally {
      setIsSaving(false);
    }
  };

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
          <Wallet size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>Account Profile & Capital</h3>
        </div>
        <form onSubmit={handleSaveAccount} className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label className="label-text">Account Profile Name</label>
              <input
                type="text"
                className="input-field"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. Quantitative Prop Account"
              />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label className="label-text">Broker Name</label>
              <input
                type="text"
                className="input-field"
                value={brokerName}
                onChange={(e) => setBrokerName(e.target.value)}
                placeholder="e.g. Interactive Brokers"
              />
            </div>
          </div>
          <div>
            <label className="label-text">Starting Capital (USD)</label>
            <input
              type="number"
              className="input-field"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              placeholder="e.g. 50000"
              step="0.01"
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSaving}
            style={{ width: "fit-content", alignSelf: "flex-end" }}
          >
            {isSaving ? "Saving..." : "Save Account Settings"}
          </button>
        </form>
      </section>

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

      <section style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Brain size={18} style={{ color: "var(--accent-blue)" }} />
          <h3 style={{ fontSize: "1rem" }}>AI Coach Preferences</h3>
        </div>
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label className="label-text">History Context Limit</label>
            <input
              type="number"
              className="input-field"
              value={settings.coachHistoryLimit}
              onChange={(e) => updateSettings({ coachHistoryLimit: parseInt(e.target.value) || 20 })}
              placeholder="e.g. 20"
              min="1"
              max="100"
            />
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
              How many previous messages the coach remembers (default: 20).
            </div>
          </div>
          <div>
            <label className="label-text">Custom System Prompt</label>
            <textarea
              className="input-field"
              value={settings.coachSystemPrompt}
              onChange={(e) => updateSettings({ coachSystemPrompt: e.target.value })}
              placeholder="Override the default coach persona (leave blank to use the default Antigravity Quantitative Coach)."
              style={{ minHeight: "80px", resize: "vertical" }}
            />
          </div>
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
