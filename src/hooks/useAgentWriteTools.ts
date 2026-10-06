import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

// The MCP server's tools that change notes, asked of the backend so its
// registry stays the one place that names them. Empty where there is no
// server to ask (mobile).
export function useAgentWriteTools(): string[] {
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    invoke<string[]>("agent_write_tools")
      .then((names) => {
        if (mounted && Array.isArray(names)) setTools(names);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return tools;
}
