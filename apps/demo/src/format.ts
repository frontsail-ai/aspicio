/** Human-readable byte size: "512 B", "72 KB", "1.2 MB". Shared by the fetch
 *  progress readout and the recent-URLs list. Returns "—" for unknown sizes. */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "—";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}
