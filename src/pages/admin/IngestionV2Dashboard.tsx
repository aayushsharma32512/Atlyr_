import { useState } from 'react'
import { AppShellLayout } from '@/layouts/AppShellLayout'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { JobListSidebarV2 } from '@/components/ingestion-v2/JobListSidebarV2'
import { JobDetailPanel } from '@/components/ingestion-v2/JobDetailPanel'
import { SubmitJobForm } from '@/components/ingestion-v2/SubmitJobForm'

export default function IngestionV2Dashboard() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)

  return (
    <AppShellLayout>
      <div className="flex h-full overflow-hidden">

        {/* Left: job list sidebar */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <JobListSidebarV2
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            onSubmitClick={() => setSubmitOpen(true)}
          />
        </div>

        {/* Right: job detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedJobId ? (
            <JobDetailPanel jobId={selectedJobId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <p className="text-sm text-muted-foreground">Select a job from the sidebar</p>
              <button
                onClick={() => setSubmitOpen(true)}
                className="text-xs text-primary underline underline-offset-2"
              >
                or submit a new URL
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Submit drawer */}
      <Drawer open={submitOpen} onOpenChange={setSubmitOpen}>
        <DrawerContent className="max-h-[90vh] flex flex-col">
          <SubmitJobForm
            onSuccess={(jobId) => {
              setSelectedJobId(jobId)
              setSubmitOpen(false)
            }}
          />
        </DrawerContent>
      </Drawer>
    </AppShellLayout>
  )
}
