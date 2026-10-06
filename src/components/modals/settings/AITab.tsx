import { AgentToolsSection } from "./AgentToolsSection";
import { AIProviderSection } from "./AIProviderSection";
import { TtsSection } from "./TtsSection";

export function AITab() {
  return (
    <>
      <AIProviderSection />
      <TtsSection />
      <AgentToolsSection />
    </>
  );
}
