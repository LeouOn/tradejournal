import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Brain, Paperclip, X, RotateCcw, Pencil, Trash2, Check, Archive, Activity, PanelLeftOpen, Maximize2, Minimize2, Columns2, PanelLeftClose, PanelLeft } from "lucide-react";
import type { ViewMode } from "../lib/paneState";
import { useToast } from "../contexts/ToastContext";
import { useSettings } from "../contexts/SettingsContext";
import ChatSessionSidebar, { type ChatSession } from "./ChatSessionSidebar";
import ContextMenu from "./ContextMenu";
import SystemSummaryCard from "./SystemSummaryCard";
import JournalProposalCard from "./JournalProposalCard";
import { deserializeContextFlags, serializeContextFlags, type ContextFlags } from "../lib/contextFlags";

interface Message {
  role: "user" | "assistant";
  content: string;
  image?: string;
  message_id?: string;
  is_summary?: boolean;
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content: "Hello! I am your Antigravity Quantitative Trading Coach. I analyze your trade entries, scaling behavior, qualitative emotional tags, and current Hidden Markov Model market regimes. Ask me anything, or run one of the diagnostics below.",
};

interface AICoachProps {
  accountId: string;
  onRefreshTrades: () => void;
  compact?: boolean;
  initialPrompt?: string;
  trades?: any[];
  initialBalance?: number;
  onMountWidget?: (component: string) => void;
  onToggleEngine?: (engine: "FIFO" | "LIFO") => void;
  onPaneModeChange?: (mode: ViewMode) => void;
  paneMode?: ViewMode;
}

export default function AICoach({ accountId, onRefreshTrades, compact = false, initialPrompt = "", trades: _trades = [], initialBalance: _initialBalance = 0, onMountWidget, onToggleEngine, onPaneModeChange, paneMode = "split" }: AICoachProps) {
  const toast = useToast();
  const { settings } = useSettings();

  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isUnloadingModel, setIsUnloadingModel] = useState(false);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageContent, setEditMessageContent] = useState("");

  // Feature 1: Thread Sidebar state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Feature 2: Context flags (persisted in localStorage)
  const contextFlagsStorageKey = `contextFlags_${accountId}`;
  const [contextFlags, setContextFlags] = useState<ContextFlags>(() =>
    deserializeContextFlags(localStorage.getItem(contextFlagsStorageKey))
  );

  const handleContextFlagsChange = useCallback((flags: ContextFlags) => {
    setContextFlags(flags);
    localStorage.setItem(contextFlagsStorageKey, serializeContextFlags(flags));
  }, [contextFlagsStorageKey]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (initialPrompt) {
      setInputMessage(initialPrompt);
    }
  }, [initialPrompt]);

  // Fetch available models
  useEffect(() => {
    fetch("http://localhost:5000/api/ai/models")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setModels(data);
        }
      })
      .catch((err) => console.error("Error fetching models:", err));
  }, []);

  // Fetch sessions on mount and when accountId changes
  const fetchSessions = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats/sessions?accountId=${accountId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSessions(data);
          if (!activeSessionId && data.length > 0) {
            setActiveSessionId(data[0].session_id);
          }
        }
      }
    } catch (e) {
      console.error("Error fetching sessions:", e);
    }
  }, [accountId, activeSessionId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Fetch chat history (filtered by active session)
  useEffect(() => {
    if (!accountId) return;
    const params = new URLSearchParams({ accountId });
    if (activeSessionId) {
      params.set("sessionId", activeSessionId);
    }
    fetch(`http://localhost:5000/api/ai/chats?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages([
            WELCOME_MESSAGE,
            ...data.map((m: { role: "user" | "assistant"; content: string; image_data?: string; message_id?: string; is_summary?: boolean }) => ({
              role: m.role,
              content: m.content,
              image: m.image_data,
              message_id: m.message_id,
              is_summary: m.is_summary,
            })),
          ]);
        } else {
          setMessages([WELCOME_MESSAGE]);
        }
      })
      .catch((err) => console.error("Error fetching chats:", err));
  }, [accountId, activeSessionId]);

  // Session management handlers
  const handleNewChat = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/ai/chats/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, title: "New Chat" }),
      });
      if (res.ok) {
        const session = await res.json();
        setActiveSessionId(session.session_id);
        setMessages([WELCOME_MESSAGE]);
        await fetchSessions();
      }
    } catch (e) {
      console.error("Error creating session:", e);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats/sessions/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        const remaining = sessions.filter((s) => s.session_id !== sessionId);
        setSessions(remaining);
        if (activeSessionId === sessionId) {
          setActiveSessionId(remaining.length > 0 ? remaining[0].session_id : null);
          if (remaining.length === 0) {
            setMessages([WELCOME_MESSAGE]);
          }
        }
      }
    } catch (e) {
      console.error("Error deleting session:", e);
    }
  };

  const [isCompressing, setIsCompressing] = useState(false);

  const handleCompressMemory = async () => {
    if (!window.confirm("Are you sure you want to compress your chat history? This will generate a dense memory block and archive raw history to improve speed.")) return;
    setIsCompressing(true);
    try {
      const res = await fetch("http://localhost:5000/api/ai/chats/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, sessionId: activeSessionId })
      });
      if (res.ok) {
        toast.success("History compressed successfully into a dense memory block.");
        const params = new URLSearchParams({ accountId });
        if (activeSessionId) params.set("sessionId", activeSessionId);
        const chatRes = await fetch(`http://localhost:5000/api/ai/chats?${params.toString()}`);
        const data = await chatRes.json();
        if (Array.isArray(data) && data.length > 0) {
          setMessages([
            WELCOME_MESSAGE,
            ...data.map((m: { role: "user" | "assistant"; content: string; image_data?: string; message_id?: string; is_summary?: boolean }) => ({
              role: m.role, content: m.content, image: m.image_data, message_id: m.message_id, is_summary: m.is_summary
            }))
          ]);
        }
      } else {
        toast.error("Failed to compress history.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Network error compressing history.");
    } finally {
      setIsCompressing(false);
    }
  };

  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to clear your chat history?")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats?accountId=${accountId}${activeSessionId ? `&sessionId=${activeSessionId}` : ""}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages([WELCOME_MESSAGE]);
      }
    } catch (err) {
      console.error("Error clearing chat logs:", err);
    }
  };

  const handleLoadModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      const res = await fetch("http://localhost:5000/api/ai/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel })
      });
      if (res.ok) {
        toast.celebrate(`Model loaded successfully!`, "Model Loaded");
      } else {
        toast.nudge("Failed to load model.", "Model Load Failed");
      }
    } catch (e) {
      console.error(e);
      toast.nudge("Failed to load model. Ensure backend is running.", "Error");
    }
    setIsLoadingModel(false);
  };

  const handleUnloadModel = async () => {
    if (!selectedModel) return;
    setIsUnloadingModel(true);
    try {
      const res = await fetch("http://localhost:5000/api/ai/models/unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel })
      });
      if (res.ok) {
        toast.info(`Model unloaded.`, "Model Unloaded");
      } else {
        toast.nudge("Failed to unload model.", "Error");
      }
    } catch (e) {
      console.error(e);
    }
    setIsUnloadingModel(false);
  };

  const handleSendMessage = async (queryText: string, imageToAttach?: string | null) => {
    if (!queryText.trim() && !imageToAttach && !selectedImage) return;

    const currentQuery = queryText;
    const currentImage = imageToAttach !== undefined ? imageToAttach : selectedImage;

    const updatedMessages = [...messages, { role: "user" as const, content: currentQuery, image: currentImage || undefined }];
    setMessages(updatedMessages);
    setInputMessage("");
    setSelectedImage(null);
    setIsTyping(true);

    setMessages((prev) => [...prev, { role: "assistant" as const, content: "" }]);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("http://localhost:5000/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          accountId,
          query: currentQuery,
          model: selectedModel,
          image: currentImage,
          systemPrompt: settings.coachSystemPrompt,
          historyLimit: settings.coachHistoryLimit,
          sessionId: activeSessionId,
          context: {
            recentTrades: contextFlags.recentTrades,
            performanceStats: contextFlags.performanceStats,
            playbookRules: contextFlags.playbookRules,
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to connect to AI Coach.");
      if (!res.body) throw new Error("No response body.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let currentResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (!dataStr) continue;
            
            try {
              const data = JSON.parse(dataStr);
              if (data.user_message_id) {
                setMessages((prev) => {
                  const list = [...prev];
                  const lastUserIdx = list.findLastIndex(m => m.role === "user");
                  if (lastUserIdx !== -1) {
                    list[lastUserIdx] = { ...list[lastUserIdx], message_id: data.user_message_id };
                  }
                  return list;
                });
              }
              if (data.session_id && !activeSessionId) {
                setActiveSessionId(data.session_id);
                fetchSessions();
              }
              if (data.token) {
                currentResponse += data.token;
                setMessages((prev) => {
                  const list = [...prev];
                  const last = list[list.length - 1];
                  if (last && last.role === "assistant") {
                    list[list.length - 1] = { ...last, content: last.content + data.token };
                  }
                  return list;
                });
              }
              if (data.complete) {
                setIsTyping(false);
                if (data.message_id) {
                  setMessages((prev) => {
                    const list = [...prev];
                    const last = list[list.length - 1];
                    if (last && last.role === "assistant") {
                      list[list.length - 1] = { ...last, message_id: data.message_id };
                    }
                    return list;
                  });
                }
                if (currentResponse.includes("✅ **Trade successfully logged!**")) {
                  if (currentResponse.includes("⚠️ Nudge: Rules were broken.")) {
                    toast.nudge("Self-reporting mistakes takes courage. The AI logged your rule violation.", "Mistake Logged");
                  } else {
                    toast.celebrate("Elite discipline! The AI logged your trade successfully.", "Disciplined Trade Logged!");
                  }
                  onRefreshTrades();
                }
              }
            } catch (e) {
              console.warn("Error parsing SSE line:", line, e);
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log("Inference cancelled by user.");
        return;
      }
      console.error(e);
      setMessages((prev) => {
        const list = [...prev];
        const last = list[list.length - 1];
        if (last && last.role === "assistant" && !last.content) {
          list[list.length - 1] = {
            ...last,
            content: "Error connecting to AI Coach endpoint. Please make sure LM Studio is running or that you have configured an OpenAI API key.",
          };
        }
        return list;
      });
      setIsTyping(false);
    }
  };

  const handleCancelInference = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      setMessages(prev => prev.slice(0, -1));
      handleSendMessage(lastUserMsg.content, lastUserMsg.image);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats/${msgId}`, { method: "DELETE" });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.message_id !== msgId));
        toast.info("Message deleted.");
      }
    } catch (e) {
      console.error(e);
      toast.nudge("Failed to delete message.");
    }
  };

  const handleSaveEdit = async (msgId: string) => {
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats/${msgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editMessageContent })
      });
      if (res.ok) {
        setMessages(prev => prev.map(m => m.message_id === msgId ? { ...m, content: editMessageContent } : m));
        setEditingMessageId(null);
        toast.info("Message updated.");
      }
    } catch (e) {
      console.error(e);
      toast.nudge("Failed to update message.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const diagnosticSuggestions = [
    { label: "Performance Snapshot", query: "Give me a full breakdown of my current performance stats, expectancy, and where my edge is strongest." },
    { label: "Rule Adherence Audit", query: "Analyze my rule adherence, identify any violations, and calculate the cost of indiscipline across my trades." },
    { label: "Audit Worst Trade", query: "Please identify and heavily critique my single worst trade logged. What critical mistakes did I make in execution and sizing?" },
    { label: "Identify Leaks", query: "Analyze all my recent data and identify my biggest statistical leak. Be brutally honest." }
  ];

  return (
    <div style={{ height: compact ? "400px" : "calc(100vh - 180px)", width: "100%", margin: "0 auto" }}>
      <div className="glass-panel" style={{ display: "flex", flexDirection: "row", height: "100%" }}>
        
        {/* Feature 1: Thread Sidebar */}
        {sidebarOpen && (
          <div style={{ width: "30%", minWidth: "180px", maxWidth: "260px", flexShrink: 0 }}>
            <ChatSessionSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewChat={handleNewChat}
              onDeleteSession={handleDeleteSession}
            />
          </div>
        )}

        {/* Main Chat Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Brain style={{ color: "var(--accent-blue)" }} />
              <h3 style={{ fontSize: "1.1rem" }}>AI Diagnostic Coach</h3>
              <div style={{ display: "flex", gap: "2px", marginLeft: "4px" }}>
                {/* Sidebar toggle */}
                <button
                  type="button"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  title={sidebarOpen ? "Hide sessions" : "Show sessions"}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", display: "flex", alignItems: "center" }}
                >
                  {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
                </button>
                {paneMode === "split" && (
                  <>
                    <button
                      type="button"
                      onClick={() => onPaneModeChange?.("minimized")}
                      title="Minimize coach"
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", display: "flex", alignItems: "center" }}
                    >
                      <Minimize2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPaneModeChange?.("maximized")}
                      title="Maximize coach"
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", display: "flex", alignItems: "center" }}
                    >
                      <Maximize2 size={14} />
                    </button>
                  </>
                )}
                {paneMode === "maximized" && (
                  <button
                    type="button"
                    onClick={() => onPaneModeChange?.("split")}
                    title="Restore split view"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", display: "flex", alignItems: "center" }}
                  >
                    <Columns2 size={14} />
                  </button>
                )}
                {paneMode === "minimized" && (
                  <button
                    type="button"
                    onClick={() => onPaneModeChange?.("split")}
                    title="Expand coach"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", display: "flex", alignItems: "center" }}
                  >
                    <PanelLeftOpen size={14} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                className="input-field"
                style={{ padding: "4px 8px", fontSize: "0.8rem", width: "160px", margin: 0, height: "30px", minHeight: "30px" }}
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="">Default Model</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m.length > 20 ? m.slice(0, 20) + "..." : m}
                  </option>
                ))}
              </select>
              {selectedModel && (
                <>
                  <button
                    className="btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={handleLoadModel}
                    disabled={isLoadingModel}
                    title="Load Model"
                  >
                    {isLoadingModel ? "..." : "Load"}
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={handleUnloadModel}
                    disabled={isUnloadingModel}
                    title="Unload Model"
                  >
                    {isUnloadingModel ? "..." : "Unload"}
                  </button>
                </>
              )}
              <button
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                onClick={handleCompressMemory}
                disabled={isCompressing}
              >
                <Archive size={12} /> {isCompressing ? "Compressing..." : "Compress History"}
              </button>
              <button
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={handleClearChat}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Message logs */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingRight: "8px", marginBottom: "16px" }}>
            {messages.map((m, index) => {
              // Feature 3: Render summary messages via SystemSummaryCard
              if (m.is_summary) {
                return <SystemSummaryCard key={m.message_id || index} content={m.content} />;
              }

              return (
                <div
                  key={m.message_id || index}
                  className="chat-bubble-container"
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative"
                  }}
                >
                  <div
                    style={{
                      background: m.role === "user" ? "var(--msg-user-bg)" : "var(--msg-assistant-bg)",
                      border: `1px solid ${m.role === "user" ? "var(--accent-blue)" : "var(--border-color)"}`,
                      borderRadius: "12px",
                      padding: "10px 14px",
                      fontSize: "0.9rem",
                      color: "var(--text-primary)",
                      whiteSpace: "pre-line",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px"
                    }}
                  >
                    {m.image && (
                      <a href={m.image} target="_blank" rel="noopener noreferrer">
                        <img src={m.image} alt="User Attachment" style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border-color)" }} />
                      </a>
                    )}
                    {editingMessageId === m.message_id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "250px" }}>
                        <textarea 
                          className="input-field" 
                          value={editMessageContent}
                          onChange={(e) => setEditMessageContent(e.target.value)}
                          style={{ minHeight: "80px", resize: "vertical" }}
                        />
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          <button className="btn-secondary" style={{ padding: "4px 8px" }} onClick={() => setEditingMessageId(null)}>
                            Cancel
                          </button>
                          <button className="btn-primary" style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleSaveEdit(m.message_id!)}>
                            <Check size={14} /> Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {m.content.split(/(\[WIDGET:\s*\{.*?\}\s*\]|\[LENS_TOGGLE:\s*\{.*?\}\s*\]|\[JOURNAL_PROPOSAL:\s*\{.*?\}\s*\])/g).map((part, i) => {
                          if (part.startsWith("[WIDGET:")) {
                            try {
                              const jsonStr = part.replace("[WIDGET:", "").replace(/\]$/, "").trim();
                              const obj = JSON.parse(jsonStr);
                              
                              if (onMountWidget) {
                                setTimeout(() => {
                                  onMountWidget(obj.component);
                                }, 50);
                              }
                              
                              return (
                                <div key={i} style={{ 
                                  marginTop: "10px", 
                                  padding: "12px", 
                                  background: "rgba(10, 132, 255, 0.15)", 
                                  borderRadius: "8px", 
                                  border: "1px solid var(--accent-blue)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px"
                                }}>
                                  <Brain size={18} style={{ color: "var(--accent-blue)" }} />
                                  <div style={{ display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "var(--accent-blue)" }}>Widget Deployed</span>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Check the dynamic canvas on the right for: {obj.component}</span>
                                  </div>
                                </div>
                              );
                            } catch (e) {
                              return <span key={i}>{part}</span>;
                            }
                          } else if (part.startsWith("[LENS_TOGGLE:")) {
                            try {
                              const jsonStr = part.replace("[LENS_TOGGLE:", "").replace(/\]$/, "").trim();
                              const obj = JSON.parse(jsonStr);

                              if (onToggleEngine) {
                                setTimeout(() => {
                                  onToggleEngine(obj.engine);
                                }, 50);
                              }

                              return (
                                <div key={i} style={{
                                  marginTop: "10px",
                                  padding: "12px",
                                  background: "rgba(52, 211, 153, 0.15)",
                                  borderRadius: "8px",
                                  border: "1px solid var(--accent-green)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px"
                                }}>
                                  <Activity size={18} style={{ color: "var(--accent-green)" }} />
                                  <div style={{ display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "var(--accent-green)" }}>Lens Swapped</span>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>The backend engine is now filtering your data via: {obj.engine}</span>
                                  </div>
                                </div>
                              );
                            } catch (e) {
                              return <span key={i}>{part}</span>;
                            }
                          } else if (part.startsWith("[JOURNAL_PROPOSAL:")) {
                            try {
                              const jsonStr = part.replace("[JOURNAL_PROPOSAL:", "").replace(/\]$/, "").trim();
                              const data = JSON.parse(jsonStr);
                              return (
                                <JournalProposalCard
                                  key={i}
                                  accountId={accountId}
                                  token={data.token}
                                  payload={data.payload}
                                  onResolved={(entry) => {
                                    if (entry) {
                                      setMessages((prev) => [...prev, { role: "assistant" as const, content: `📌 Saved journal entry: ${entry.title}` }]);
                                    }
                                  }}
                                />
                              );
                            } catch (e) {
                              return <span key={i}>{part}</span>;
                            }
                          }
                          return <span key={i}>{part}</span>;
                        })}
                      </div>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  {m.message_id && editingMessageId !== m.message_id && (
                    <div style={{
                      display: "flex", gap: "6px", marginTop: "4px", 
                      justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                      opacity: 0.6
                    }}>
                      <button type="button" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} 
                        onClick={() => { setEditingMessageId(m.message_id!); setEditMessageContent(m.content); }}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)" }} 
                        onClick={() => handleDeleteMessage(m.message_id!)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {isTyping && (
              <div style={{ alignSelf: "flex-start", color: "var(--text-secondary)", fontSize: "0.85rem", fontStyle: "italic", marginLeft: "10px" }}>
                Coach is compiling stats and writing report...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Diagnostic Shortcuts */}
          <div style={{ marginBottom: "14px" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Quick Diagnostics:</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {diagnosticSuggestions.map((s, idx) => (
                <button
                  key={idx}
                  className="btn-secondary"
                  style={{ padding: "4px 8px", fontSize: "0.75rem", borderRadius: "16px" }}
                  onClick={() => handleSendMessage(s.query)}
                  disabled={isTyping}
                >
                  {s.label}
                </button>
              ))}
              <button
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.75rem", borderRadius: "16px", borderColor: "var(--accent-blue)", color: "var(--accent-blue)" }}
                onClick={() => handleSendMessage("Generate a summary of today's trades and overall performance.")}
                disabled={isTyping}
              >
                Generate Daily Summary
              </button>
            </div>
          </div>

          {/* Input area */}
          <div style={{ position: "relative" }}>
            {selectedImage && (
              <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: "8px", background: "var(--bg-secondary)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border-color)", display: "flex", alignItems: "center" }}>
                <img src={selectedImage} alt="Preview" style={{ height: "40px", borderRadius: "4px" }} />
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", marginLeft: "8px" }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputMessage);
              }}
              style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}
            >
              <input type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
              {/* Feature 2: @ Context menu button */}
              <ContextMenu flags={contextFlags} onFlagsChange={handleContextFlagsChange} />
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "10px", height: "44px", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => fileInputRef.current?.click()}
                disabled={isTyping}
                title="Attach Image"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                className="input-field"
                placeholder="Query your trading performance patterns... (Shift+Enter for new line)"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(inputMessage);
                  }
                }}
                disabled={isTyping}
                style={{ resize: "none", minHeight: "44px", maxHeight: "150px", overflowY: "auto", flex: 1, paddingTop: "12px", boxSizing: "border-box" }}
                rows={1}
              />
              {!isTyping && messages.length > 1 && (
                <button type="button" className="btn-secondary" style={{ padding: "10px 16px", height: "44px" }} onClick={handleRetry} title="Retry Last Message">
                  <RotateCcw size={16} />
                </button>
              )}
              {isTyping ? (
                <button type="button" className="btn-secondary" style={{ padding: "10px 16px", height: "44px", color: "var(--color-error)", borderColor: "var(--color-error)" }} onClick={handleCancelInference} title="Stop Generating">
                  <X size={16} />
                </button>
              ) : (
                <button type="submit" className="btn-primary" style={{ padding: "10px 16px", height: "44px" }} disabled={!inputMessage.trim() && !selectedImage}>
                  <Send size={16} />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
