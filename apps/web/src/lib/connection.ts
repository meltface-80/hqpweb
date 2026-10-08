// The header dot's tooltip: how the selected HQPlayer is answering, in a few words.

export type Online = "connecting" | "live" | "unreachable" | "lost";

export function dotTitle(o: {
  online: Online;
  since: Date | null;
  reason: string;
  latencyMs: number | undefined;
  slow: boolean;
}): string {
  if (o.online === "unreachable") {
    const at = o.since ? ` since ${o.since.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
    return `Not responding${at}: ${o.reason}`;
  }
  if (o.online === "live") return `Responding — ${o.latencyMs ?? "?"} ms${o.slow ? " (slow)" : ""}`;
  if (o.online === "lost") return "Lost connection to the app's server";
  return "Connecting…";
}
