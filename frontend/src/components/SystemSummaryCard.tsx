import { Brain } from "lucide-react";

interface SystemSummaryCardProps {
  content: string;
}

const SUMMARY_PREFIX = "[COMPRESSED HISTORY SUMMARY]";

export default function SystemSummaryCard({ content }: SystemSummaryCardProps) {
  // Strip the prefix from displayed content
  const displayContent = content.startsWith(SUMMARY_PREFIX)
    ? content.slice(SUMMARY_PREFIX.length).trim()
    : content;

  return (
    <div
      style={{
        alignSelf: "center",
        maxWidth: "90%",
        width: "100%",
        margin: "12px 0",
        background: "var(--accent-bg)",
        border: "1px solid var(--accent-blue)",
        borderRadius: "12px",
        padding: "14px 18px",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "10px",
          paddingBottom: "8px",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <Brain size={16} style={{ color: "var(--accent-blue)" }} />
        <span
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--accent-blue)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Compressed Memory
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          fontSize: "0.85rem",
          color: "var(--text-primary)",
          whiteSpace: "pre-line",
          lineHeight: 1.5,
        }}
      >
        {displayContent}
      </div>
    </div>
  );
}
