import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ThemeId = "default" | "midnight" | "terminal" | "light" | "arctic";

export interface AppSettings {
  theme: ThemeId;
  compactSidebar: boolean;
  showGlowEffects: boolean;
  animationSpeed: "normal" | "fast" | "none";
}

const STORAGE_KEY = "antigravity-settings";

const defaults: AppSettings = {
  theme: "default",
  compactSidebar: false,
  showGlowEffects: true,
  animationSpeed: "normal",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);

    document.documentElement.classList.toggle("no-glow", !settings.showGlowEffects);
    document.documentElement.classList.toggle("no-animations", settings.animationSpeed === "none");
    document.documentElement.classList.toggle("fast-animations", settings.animationSpeed === "fast");
    document.documentElement.classList.toggle("compact-sidebar", settings.compactSidebar);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const resetSettings = () => {
    setSettings({ ...defaults });
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
