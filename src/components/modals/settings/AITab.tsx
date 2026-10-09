import { ShowOn } from "@/components/ShowOn";
import { AgentToolsSection } from "./AgentToolsSection";
import { AIProviderSection } from "./AIProviderSection";
import { TtsSection } from "./TtsSection";

export function AITab() {
  return (
    <>
      <AIProviderSection />
      <TtsSection />
      {/* `glyph mcp` is a desktop command; a phone has no server to offer tools. */}
      <ShowOn on="desktop">
        <AgentToolsSection />
      </ShowOn>
    </>
  );
}
