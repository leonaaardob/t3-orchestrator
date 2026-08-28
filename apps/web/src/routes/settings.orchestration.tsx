import { createFileRoute } from "@tanstack/react-router";

import { OrchestrationSettingsPanel } from "../components/settings/OrchestrationSettingsPanel";

function SettingsOrchestrationRoute() {
  return <OrchestrationSettingsPanel />;
}

export const Route = createFileRoute("/settings/orchestration")({
  component: SettingsOrchestrationRoute,
});
