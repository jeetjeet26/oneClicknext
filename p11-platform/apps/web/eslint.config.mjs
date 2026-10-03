import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Keep existing asynchronous editor loading/reset behavior intact during the
  // dependency upgrade. These compiler optimization diagnostics are advisory on
  // the legacy screens; new components retain the full recommended error rules.
  {
    files: [
      "components/siteforge/ExistingConsoleWebsites.tsx",
      "components/siteforge/ManualFloorPlansConsole.tsx",
      "components/siteforge/PropertyAssetsStep.tsx",
      "components/siteforge/SiteForgeAssetRoom.tsx",
      "components/siteforge/SiteForgeBriefEditor.tsx",
      "components/siteforge/SiteForgeBriefHistory.tsx",
      "components/siteforge/SiteForgeConnectors.tsx",
      "components/siteforge/SiteForgeCreativeDirections.tsx",
      "components/siteforge/SiteForgeDeliveryRecords.tsx",
      "components/siteforge/SiteForgeEditorWorkspace.tsx",
      "components/siteforge/SiteForgeGuidedWorkspace.tsx",
      "components/siteforge/SiteForgeMigration.tsx",
      "components/siteforge/SiteForgeOperationsPanel.tsx",
      "components/siteforge/SiteForgeOwnership.tsx",
      "components/siteforge/SiteForgeReporting.tsx",
      "components/siteforge/WebsitePreview.tsx",
      "app/dashboard/page.tsx",
      "app/dashboard/lumaleasing/page.tsx",
      "components/forgestudio/DraftPickerModal.tsx"
],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
