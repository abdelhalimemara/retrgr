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
import {
  AGE_RANGES,
  CARRIERS,
  DAYPARTS,
  DEVICE_TIERS,
  GENDERS,
  formatDate,
  type Campaign,
  type Placement,
  type Segment,
  type SegmentFilters,
  type SegmentSize,
} from '@/lib/types'

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
      f.minPlacements && `${f.minPlacements}+ billboards`,
      f.minIntent && `intent ${f.minIntent}+`,
      f.dayparts?.length && f.dayparts.join('/'),
      f.languages?.length && f.languages.join('/'),
      f.deviceTiers?.length && f.deviceTiers.join('/').replace(/_/g, ' '),
      f.emailTypes?.length && `${f.emailTypes.join('/')} email`,
      f.carriers?.length && f.carriers.join('/'),
      f.commerce && f.commerce.replace('_', ' '),
      f.minPurchaseValue && `spent ${f.minPurchaseValue}+ SAR`,
      f.purchasedWithinDays && `bought in last ${f.purchasedWithinDays}d`,
      f.validContactsOnly && 'valid contacts',
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
          <InsightFilters filters={filters} setFilters={setFilters} />
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

const ANY = 'any'

/** First-party insight filters: intent, exposure, habits, device/network, shopping, contact quality. */
function InsightFilters({ filters, setFilters }: { filters: SegmentFilters; setFilters: (f: SegmentFilters) => void }) {
  const num = (v: string) => (v === ANY || v === '' ? undefined : Number(v))
  const pick = (label: string, value: number | string | undefined, options: [string, string][], onChange: (v: string) => void) => (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value == null ? ANY : String(value)} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  return (
    <div className="grid gap-5 rounded-md border p-3">
      <div className="text-sm font-medium">Insights</div>
      <div className="grid grid-cols-2 gap-4">
        {pick('Intent score', filters.minIntent, [[ANY, 'Any'], ['30', '30+'], ['50', '50+'], ['70', '70+']], (v) =>
          setFilters({ ...filters, minIntent: num(v) }),
        )}
        {pick('Different billboards seen', filters.minPlacements, [[ANY, 'Any'], ['2', '2+'], ['3', '3+'], ['5', '5+']], (v) =>
          setFilters({ ...filters, minPlacements: num(v) }),
        )}
        {pick(
          'Shopping',
          filters.commerce,
          [[ANY, 'Any'], ['buyers', 'Bought'], ['cart_abandoners', 'Added to cart, didn’t buy'], ['non_buyers', 'Never bought']],
          (v) => setFilters({ ...filters, commerce: v === ANY ? undefined : (v as SegmentFilters['commerce']) }),
        )}
        {pick('Bought within', filters.purchasedWithinDays, [[ANY, 'Any time'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']], (v) =>
          setFilters({ ...filters, purchasedWithinDays: num(v) }),
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="seg-spend">Spent at least (SAR)</Label>
        <Input
          id="seg-spend"
          type="number"
          min="0"
          value={filters.minPurchaseValue ?? ''}
          onChange={(e) => setFilters({ ...filters, minPurchaseValue: num(e.target.value) })}
        />
      </div>
      <CheckGroup
        label="Usually scans in the"
        options={DAYPARTS.map((d) => ({ value: d, label: d }))}
        value={filters.dayparts}
        onChange={(v) => setFilters({ ...filters, dayparts: v })}
      />
      <CheckGroup
        label="Language"
        options={[{ value: 'ar', label: 'Arabic' }, { value: 'en', label: 'English' }]}
        value={filters.languages}
        onChange={(v) => setFilters({ ...filters, languages: v })}
      />
      <CheckGroup label="Device" options={DEVICE_TIERS} value={filters.deviceTiers} onChange={(v) => setFilters({ ...filters, deviceTiers: v })} />
      <CheckGroup
        label="Mobile network"
        options={CARRIERS.map((c) => ({ value: c, label: c }))}
        value={filters.carriers}
        onChange={(v) => setFilters({ ...filters, carriers: v })}
      />
      <CheckGroup
        label="Email type"
        options={[{ value: 'work', label: 'Work' }, { value: 'personal', label: 'Personal' }]}
        value={filters.emailTypes}
        onChange={(v) => setFilters({ ...filters, emailTypes: v })}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={!!filters.validContactsOnly} onCheckedChange={(c) => setFilters({ ...filters, validContactsOnly: c === true || undefined })} />
        Only people with a valid email or phone
      </label>
    </div>
  )
}
