import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, useApi } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AGE_RANGES, GENDERS, formatDate, type Campaign, type Placement, type Segment, type SegmentFilters, type SegmentSize } from '@/lib/types'

export default function SegmentsPage() {
  const { data, reload } = useApi<Segment[]>('/admin/segments')
  const { data: campaigns } = useApi<Campaign[]>('/admin/campaigns')
  const { data: placements } = useApi<Placement[]>('/admin/placements')
  const [creating, setCreating] = useState(false)

  const describe = (f: SegmentFilters) =>
    [
      f.campaignIds?.length && `${f.campaignIds.length} campaign(s)`,
      f.placementIds?.length && `${f.placementIds.length} billboard(s)`,
      f.minScans && `${f.minScans}+ scans`,
      f.ageRanges?.length && f.ageRanges.join(', '),
      f.genders?.length && f.genders.join(', '),
      f.cities?.length && f.cities.join(', '),
      (f.capturedFrom || f.capturedTo) && `${f.capturedFrom ?? '…'} → ${f.capturedTo ?? '…'}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Everyone with active consent'

  const remove = async (id: string) => {
    await api.delete(`/admin/segments/${id}`)
    void reload()
  }

  return (
    <>
      <PageHeader
        title="Segments"
        description="Saved audience definitions. Only people with active marketing consent are ever included."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New segment
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle>{s.name}</CardTitle>
              <CardDescription>{describe(s.filters)}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-semibold tabular-nums">{s.size.total.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  {s.size.with_email.toLocaleString()} emails · {s.size.with_phone.toLocaleString()} phones · {formatDate(s.created_at)}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(s.id)} aria-label="Delete segment">
                <Trash2 />
              </Button>
            </CardContent>
          </Card>
        ))}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No segments yet.</p>}
      </div>

      {creating && (
        <SegmentDialog
          campaigns={campaigns ?? []}
          placements={placements ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void reload()
          }}
        />
      )}
    </>
  )
}

function toggle(list: string[] | undefined, value: string, on: boolean) {
  const next = new Set(list)
  if (on) next.add(value)
  else next.delete(value)
  return [...next]
}

function CheckGroup({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string }[]
  value?: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <Checkbox checked={value?.includes(o.value) ?? false} onCheckedChange={(c) => onChange(toggle(value, o.value, c === true))} />
            <span className="capitalize">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function SegmentDialog({
  campaigns,
  placements,
  onClose,
  onSaved,
}: {
  campaigns: Campaign[]
  placements: Placement[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [filters, setFilters] = useState<SegmentFilters>({})
  const [cities, setCities] = useState('')
  const [preview, setPreview] = useState<{ size: SegmentSize; minimums: Record<string, number> } | null>(null)

  const effective: SegmentFilters = {
    ...filters,
    cities: cities ? cities.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
    capturedFrom: filters.capturedFrom || undefined,
    capturedTo: filters.capturedTo || undefined,
  }
  const key = JSON.stringify(effective)

  useEffect(() => {
    const t = setTimeout(() => {
      api.post<typeof preview>('/admin/segments/preview', JSON.parse(key)).then(setPreview, () => setPreview(null))
    }, 300)
    return () => clearTimeout(t)
  }, [key])

  const save = async () => {
    try {
      await api.post('/admin/segments', { name, filters: effective })
      toast.success('Segment saved')
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const tooSmall = preview && preview.size.total < Math.min(...Object.values(preview.minimums))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>Combine filters; the audience size updates as you go.</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="seg-name">Name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riyadh women 25–34" />
          </div>
          <CheckGroup
            label="Campaigns (any)"
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            value={filters.campaignIds}
            onChange={(v) => setFilters({ ...filters, campaignIds: v })}
          />
          {placements.length > 0 && (
            <CheckGroup
              label="Billboards scanned (any)"
              options={placements.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
              value={filters.placementIds}
              onChange={(v) => setFilters({ ...filters, placementIds: v })}
            />
          )}
          <div className="grid gap-2">
            <Label>Repeat exposure</Label>
            <Select
              value={String(filters.minScans ?? 1)}
              onValueChange={(v) => setFilters({ ...filters, minScans: v === '1' ? undefined : Number(v) })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Any number of scans</SelectItem>
                <SelectItem value="2">Scanned 2+ times</SelectItem>
                <SelectItem value="3">Scanned 3+ times</SelectItem>
                <SelectItem value="5">Scanned 5+ times</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CheckGroup
            label="Age range"
            options={AGE_RANGES.map((a) => ({ value: a, label: a }))}
            value={filters.ageRanges}
            onChange={(v) => setFilters({ ...filters, ageRanges: v })}
          />
          <CheckGroup
            label="Gender"
            options={GENDERS.map((g) => ({ value: g, label: g }))}
            value={filters.genders}
            onChange={(v) => setFilters({ ...filters, genders: v })}
          />
          <div className="grid gap-2">
            <Label htmlFor="seg-cities">Cities (comma separated)</Label>
            <Input id="seg-cities" value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Riyadh, Jeddah" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="seg-from">Captured from</Label>
              <Input id="seg-from" type="date" onChange={(e) => setFilters({ ...filters, capturedFrom: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seg-to">Captured to</Label>
              <Input id="seg-to" type="date" onChange={(e) => setFilters({ ...filters, capturedTo: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted p-3">
          <span className="text-sm text-muted-foreground">Matching consented customers</span>
          <Badge variant="secondary" className="text-base tabular-nums">
            {preview?.size.total.toLocaleString() ?? '…'}
          </Badge>
        </div>
        {tooSmall && (
          <Alert>
            <AlertDescription>
              Ad platforms won’t serve to very small lists (Meta ≥ 100, Google/TikTok/Snapchat ≥ 1,000 matched users).
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button onClick={save} disabled={!name.trim()}>
            Save segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
