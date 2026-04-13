import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/integrations/supabase/client'
import { vtoApi } from '@/utils/vtoApi'

type PoseRow = { id: string; storage_path: string; created_at?: string; is_active?: boolean }

type GenerateCandidatesPayload = {
  uploadBatchId: string
  candidatePaths: string[]
  candidateUrls: string[]
}

type Props = {
  onPoseSelected: (poseId: string) => void
  onGenerateCandidatesStart?: () => void
  onCandidatesGenerated?: (payload: GenerateCandidatesPayload) => void
}

export function NeutralPoseManager({ onPoseSelected, onGenerateCandidatesStart, onCandidatesGenerated }: Props) {
  const [poses, setPoses] = useState<PoseRow[]>([])
  const [posesLoading, setPosesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGenerating, setShowGenerating] = useState(false)
  const [step, setStep] = useState<'list' | 'upload'>('list')
  const [poseUrls, setPoseUrls] = useState<Record<string, string>>({})

  const fullBodyRef = useRef<HTMLInputElement | null>(null)
  const selfieRef = useRef<HTMLInputElement | null>(null)

  async function refreshPoses() {
    setError(null)
    setPosesLoading(true)
    try {
      const { data, error } = await (supabase as any)
        .from('user_neutral_poses')
        .select('id, storage_path, created_at, is_active')
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      setPoses((data as any[]) || [])
    } catch (e) {
      setError((e as Error).message)
      setPoses([])
    } finally {
      setPosesLoading(false)
    }
  }

  useEffect(() => {
    refreshPoses()
  }, [])

  useEffect(() => {
    // Pre-sign pose image URLs when list changes
    (async () => {
      try {
        const entries = await Promise.all(
          poses.map(async (p) => [p.id, await signNeutralPose(p.storage_path)] as const)
        )
        const map: Record<string, string> = {}
        for (const [id, url] of entries) if (url) map[id] = url
        setPoseUrls(map)
      } catch {
        // ignore
      }
    })()
  }, [poses])

  async function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function signTempCandidates(paths: string[]) {
    const results: string[] = []
    for (const p of paths) {
      const { data, error } = await supabase.storage.from('temp-candidates').createSignedUrl(p, 3600)
      if (error) {
        results.push('')
      } else {
        results.push(data?.signedUrl || '')
      }
    }
    return results
  }

  async function signNeutralPose(path: string) {
    try {
      const { data, error } = await supabase.storage.from('neutral-poses').createSignedUrl(path, 3600)
      if (error) return ''
      return data?.signedUrl || ''
    } catch {
      return ''
    }
  }

  const poseCards = useMemo(() => poses, [poses])

  return (
    <div className="space-y-6 max-h-[65vh] overflow-y-auto">
      {step === 'list' && (
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <Button size="lg" onClick={() => setStep('upload')} className="mx-auto">
              Create New Likeness
            </Button>
            <p className="text-xs text-muted-foreground">One-time setup for all future try-ons.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {posesLoading && <p className="col-span-full text-sm text-muted-foreground text-center">Loading likenesses…</p>}
            {!posesLoading && poseCards.length === 0 && (
              <div className="col-span-full text-sm text-muted-foreground text-center">No likenesses yet. Create one to get started.</div>
            )}
            {poseCards.map((pose) => (
              <Card key={pose.id} className={`overflow-hidden ${pose.is_active ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="p-2 space-y-2">
                  <div className="w-full h-56 bg-muted rounded overflow-hidden flex items-center justify-center">
                    <img
                      src={poseUrls[pose.id] || '/placeholder.svg'}
                      alt="neutral pose"
                      className="max-h-full object-contain"
                    />
                  </div>
                  <div className="space-y-2">
                    <Button size="sm" className="w-full" onClick={() => onPoseSelected(pose.id)}>Use</Button>
                    {!pose.is_active && (
                      <Button size="sm" variant="outline" className="w-full" onClick={async () => {
                        await vtoApi.neutralSetActive({ neutralPoseId: pose.id })
                        await refreshPoses()
                      }}>Set Default</Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full"
                      onClick={async () => {
                        try {
                          await vtoApi.neutralDelete({ neutralPoseId: pose.id })
                          await refreshPoses()
                          setError(null)
                        } catch (e) {
                          const message = (e as Error).message || 'Failed to delete pose'
                          setError(message)
                          console.error('Delete failed', message)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {step === 'upload' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Upload Photos</h3>
            <p className="text-sm text-muted-foreground">Both photos help us mirror your look perfectly.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Full-body photo (required)</Label>
              <Input ref={fullBodyRef} type="file" accept="image/*" />
            </div>
            <div className="space-y-2">
              <Label>Selfie (required)</Label>
              <Input ref={selfieRef} type="file" accept="image/*" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('list')}>Cancel</Button>
            <Button onClick={async () => {
              if (!fullBodyRef.current?.files || fullBodyRef.current.files.length === 0) {
                setError('Add a full-body photo to continue')
                return
              }
              if (!selfieRef.current?.files || selfieRef.current.files.length === 0) {
                setError('Add a selfie to continue')
                return
              }
              setShowGenerating(true)
              setError(null)
              try {
                const full = fullBodyRef.current.files[0]
                const selfie = selfieRef.current.files[0]
                const body: any = { fullBodyBase64: await toBase64(full), selfieBase64: await toBase64(selfie) }
                onGenerateCandidatesStart?.()
                const res = await vtoApi.neutralUpload(body)
                const paths = res.candidates.map(c => c.path)
                const urls = await signTempCandidates(paths)
                onCandidatesGenerated?.({
                  uploadBatchId: res.uploadBatchId,
                  candidatePaths: paths,
                  candidateUrls: urls,
                })
                setStep('list')
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setShowGenerating(false)
              }
            }}>Generate Likeness</Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {showGenerating && (
            <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-sm font-medium text-muted-foreground">Generating likeness</span>
              </div>
              <p className="text-xs text-muted-foreground/80 text-center max-w-xs">
                Please wait while we process your images. This may take a moment.
              </p>
              <div className="flex gap-1 mt-4">
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-pulse" style={{animationDelay: '0ms'}} />
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-pulse" style={{animationDelay: '200ms'}} />
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-pulse" style={{animationDelay: '400ms'}} />
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
