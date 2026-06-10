/**
 * Formats a date as a relative time string.
 * Examples: "just now", "5m ago", "2h ago", "Yesterday", "3d ago", "5w ago", "Mar 15, 2025"
 */
export function formatRelativeTime(date: Date | string, now?: Date): string {
  const target = typeof date === "string" ? new Date(date) : date;
  const reference = now ?? new Date();

  const diffMs = reference.getTime() - target.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 365) return `${diffWeeks}w ago`;

  // More than 1 year — full date
  return target.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
