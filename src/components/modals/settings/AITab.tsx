import { ShowOn } from "@/components/ShowOn";
import { AgentToolsSection } from "./AgentToolsSection";
import { AIProviderSection } from "./AIProviderSection";
import { AssistantToolsSection } from "./AssistantToolsSection";
import { TtsSection } from "./TtsSection";

export function AITab() {
  return (
    <>
      <AIProviderSection />
      {/* The vault tools exist only in the desktop app, for the assistant and `glyph mcp` alike. */}
      <ShowOn on="desktop">
        <AssistantToolsSection />
      </ShowOn>
      <TtsSection />
      <ShowOn on="desktop">
        <AgentToolsSection />
      </ShowOn>
    </>
  );
}
