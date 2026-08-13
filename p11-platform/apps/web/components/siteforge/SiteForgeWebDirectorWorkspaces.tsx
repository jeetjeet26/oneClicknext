'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type {
  SiteForgeArtifactIdentity,
  SiteForgeCertificationPosture,
} from '@/utils/siteforge/director/contracts'

function PanelLoading() {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      Loading workspace…
    </div>
  )
}

const BriefEditor = dynamic(
  () =>
    import('./SiteForgeBriefEditor').then(module => module.SiteForgeBriefEditor),
  { loading: PanelLoading }
)
const CreativeDirections = dynamic(
  () =>
    import('./SiteForgeCreativeDirections').then(
      module => module.SiteForgeCreativeDirections
    ),
  { loading: PanelLoading }
)
const AssetRoom = dynamic(
  () =>
    import('./SiteForgeAssetRoom').then(module => module.SiteForgeAssetRoom),
  { loading: PanelLoading }
)
const PlanJourney = dynamic(
  () =>
    import('./SiteForgePlanJourney').then(
      module => module.SiteForgePlanJourney
    ),
  { loading: PanelLoading }
)
const EditorWorkspace = dynamic(
  () =>
    import('./SiteForgeEditorWorkspace').then(
      module => module.SiteForgeEditorWorkspace
    ),
  { loading: PanelLoading }
)
const CritiqueWorkspace = dynamic(
  () =>
    import('./SiteForgeCritiqueWorkspace').then(
      module => module.SiteForgeCritiqueWorkspace
    ),
  { loading: PanelLoading }
)
const RevisionRounds = dynamic(
  () =>
    import('./SiteForgeRevisionRounds').then(
      module => module.SiteForgeRevisionRounds
    ),
  { loading: PanelLoading }
)
const Migration = dynamic(
  () =>
    import('./SiteForgeMigration').then(module => module.SiteForgeMigration),
  { loading: PanelLoading }
)
const Connectors = dynamic(
  () =>
    import('./SiteForgeConnectors').then(module => module.SiteForgeConnectors),
  { loading: PanelLoading }
)
const OperationsPanel = dynamic(
  () =>
    import('./SiteForgeOperationsPanel').then(
      module => module.SiteForgeOperationsPanel
    ),
  { loading: PanelLoading }
)
const Ownership = dynamic(
  () =>
    import('./SiteForgeOwnership').then(module => module.SiteForgeOwnership),
  { loading: PanelLoading }
)

type WorkspaceTab = {
  value: string
  label: string
}

export const SITEFORGE_PLAN_TABS: WorkspaceTab[] = [
  { value: 'plan-approval', label: 'Plan approval' },
  { value: 'brief', label: 'Brief' },
  { value: 'directions', label: 'Creative directions' },
  { value: 'assets', label: 'Asset room' },
]

export const SITEFORGE_REVIEW_TABS: WorkspaceTab[] = [
  { value: 'editor', label: 'Editor & preview' },
  { value: 'critique', label: 'Critique & proposals' },
  { value: 'client-review', label: 'Client review' },
]

export const SITEFORGE_DELIVERY_TABS: WorkspaceTab[] = [
  { value: 'migration', label: 'Migration' },
  { value: 'connectors', label: 'Connectors' },
  { value: 'launch', label: 'Launch & recovery' },
]

function WorkspaceTabList({
  tabs,
  activeTab,
  label,
  onValueChange,
}: {
  tabs: WorkspaceTab[]
  activeTab: string
  label: string
  onValueChange: (value: string) => void
}) {
  return (
    <TabsList
      className="h-auto w-full justify-start overflow-x-auto"
      currentValue={activeTab}
      onValueChange={onValueChange}
      role="tablist"
      aria-label={label}
    >
      {tabs.map(tab => (
        <TabsTrigger
          key={tab.value}
          id={`siteforge-${tab.value}-tab`}
          value={tab.value}
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-controls={`siteforge-${tab.value}-panel`}
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

function workspacePanelProps(value: string) {
  return {
    id: `siteforge-${value}-panel`,
    role: 'tabpanel' as const,
    'aria-labelledby': `siteforge-${value}-tab`,
    tabIndex: 0,
  }
}

export function SiteForgePlanWorkspace({
  websiteId,
  propertyId,
  onSnapshotChanged,
}: {
  websiteId: string
  propertyId: string
  onSnapshotChanged: () => void
}) {
  const [tab, setTab] = useState('plan-approval')
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <WorkspaceTabList
        tabs={SITEFORGE_PLAN_TABS}
        activeTab={tab}
        label="Planning workspaces"
        onValueChange={setTab}
      />
      <TabsContent
        value="plan-approval"
        {...workspacePanelProps('plan-approval')}
      >
        <PlanJourney
          websiteId={websiteId}
          propertyId={propertyId}
          onChanged={onSnapshotChanged}
        />
      </TabsContent>
      <TabsContent value="brief" {...workspacePanelProps('brief')}>
        <BriefEditor websiteId={websiteId} onChanged={onSnapshotChanged} />
      </TabsContent>
      <TabsContent value="directions" {...workspacePanelProps('directions')}>
        <CreativeDirections
          websiteId={websiteId}
          onChanged={onSnapshotChanged}
        />
      </TabsContent>
      <TabsContent value="assets" {...workspacePanelProps('assets')}>
        <AssetRoom propertyId={propertyId} />
      </TabsContent>
    </Tabs>
  )
}

export function SiteForgeReviewWorkspace({
  websiteId,
  propertyId,
  currentArtifact,
  previewCertification,
}: {
  websiteId: string
  propertyId: string
  currentArtifact: SiteForgeArtifactIdentity
  previewCertification: SiteForgeCertificationPosture | null
}) {
  const [tab, setTab] = useState('editor')
  const reviewArtifact =
    currentArtifact.artifactId &&
    currentArtifact.contentHash &&
    currentArtifact.version != null
      ? {
          id: currentArtifact.artifactId,
          content_hash: currentArtifact.contentHash,
          version: currentArtifact.version,
        }
      : null

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <WorkspaceTabList
        tabs={SITEFORGE_REVIEW_TABS}
        activeTab={tab}
        label="Build and review workspaces"
        onValueChange={setTab}
      />
      <TabsContent value="editor" {...workspacePanelProps('editor')}>
        <EditorWorkspace websiteId={websiteId} propertyId={propertyId} />
      </TabsContent>
      <TabsContent value="critique" {...workspacePanelProps('critique')}>
        <CritiqueWorkspace
          websiteId={websiteId}
          artifact={currentArtifact}
          certification={previewCertification}
        />
      </TabsContent>
      <TabsContent
        value="client-review"
        {...workspacePanelProps('client-review')}
      >
        {reviewArtifact ? (
          <RevisionRounds
            websiteId={websiteId}
            currentArtifact={reviewArtifact}
          />
        ) : (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          >
            Publish an immutable website artifact before opening client review.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

export function SiteForgeDeliveryWorkspace({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  const [tab, setTab] = useState('migration')
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <WorkspaceTabList
        tabs={SITEFORGE_DELIVERY_TABS}
        activeTab={tab}
        label="Delivery workspaces"
        onValueChange={setTab}
      />
      <TabsContent value="migration" {...workspacePanelProps('migration')}>
        <Migration websiteId={websiteId} propertyId={propertyId} />
      </TabsContent>
      <TabsContent value="connectors" {...workspacePanelProps('connectors')}>
        <Connectors websiteId={websiteId} propertyId={propertyId} />
      </TabsContent>
      <TabsContent value="launch" {...workspacePanelProps('launch')}>
        <OperationsPanel websiteId={websiteId} />
      </TabsContent>
    </Tabs>
  )
}

export function SiteForgeOwnershipWorkspace({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  return <Ownership websiteId={websiteId} propertyId={propertyId} />
}
