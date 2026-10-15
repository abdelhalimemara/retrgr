import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { PageHeader } from '@/components/app-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { sar, type Attribution, type Campaign } from '@/lib/types'

const chartConfig = { scans: { label: 'Scans', color: 'var(--chart-2)' } } satisfies ChartConfig

type AttributionModel = 'multi' | 'first' | 'last'
const MODELS: Record<AttributionModel, { label: string; note: string }> = {
  multi: {
    label: 'Every billboard scanned',
    note: 'Each lead counts at every billboard they scanned (shared credit), so billboard leads can add up to more than total leads.',
  },
  first: {
    label: 'First billboard scanned',
    note: 'Each lead counts once, at the first billboard they scanned. Billboard leads add up to the total (minus leads with no billboard code).',
  },
  last: {
    label: 'Last billboard before sign-up',
    note: 'Each lead counts once, at the last billboard they scanned before signing up. Billboard leads add up to the total (minus leads with no billboard code).',
  },
}
const ALL = 'all'

export default function AttributionPage() {
  const { data: campaigns } = useApi<Campaign[]>('/admin/campaigns')
  const [campaignId, setCampaignId] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [model, setModel] = useState<AttributionModel>('multi')

  const qs = new URLSearchParams()
  if (campaignId !== ALL) qs.set('campaign_id', campaignId)
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  qs.set('model', model)
  const { data, loading } = useApi<Attribution>(`/admin/attribution?${qs}`)

  const totals = data?.totals
  const cards = [
    { label: 'Scans', value: totals?.scans },
    { label: 'Unique scanners', value: totals?.unique_scanners },
    { label: 'Leads', value: totals?.leads },
    {
      label: 'Scanner → lead',
      value: totals?.unique_scanners ? `${((100 * totals.leads) / totals.unique_scanners).toFixed(1)}%` : '—',
    },
  ]

  return (
    <>
      <PageHeader
        title="Attribution"
        description="Which billboard drove which scan and lead. Bot traffic is excluded; times are Riyadh local."
      />

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="grid w-64 gap-2">
          <Label>Campaign</Label>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All campaigns</SelectItem>
              {campaigns?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="attr-from">From</Label>
          <Input id="attr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="attr-to">To</Label>
          <Input id="attr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid w-64 gap-2">
          <Label>Credit each lead to</Label>
          <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODELS) as AttributionModel[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODELS[m].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {loading && !data ? <Skeleton className="h-9 w-20" /> : typeof c.value === 'number' ? c.value.toLocaleString() : (c.value ?? 0)}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placement</TableHead>
              <TableHead className="text-right">QR opens</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead className="text-right">Unique</TableHead>
              <TableHead className="text-right">Repeat</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Conv.</TableHead>
              <TableHead className="text-right">Cost / scan</TableHead>
              <TableHead className="text-right">Cost / lead</TableHead>
              <TableHead className="text-right">Mobile</TableHead>
              <TableHead className="text-right">Avg dwell</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.placements.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.code} · {p.campaign_name}
                    {p.district && ` · ${p.district}`}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.qr_opens ? p.qr_opens.toLocaleString() : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{p.scans.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{p.unique_scanners.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{p.repeat_scans.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{p.leads.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{p.scan_to_lead_pct == null ? '—' : `${p.scan_to_lead_pct}%`}</TableCell>
                <TableCell className="text-right tabular-nums">{sar(p.cost_per_scan)}</TableCell>
                <TableCell className="text-right tabular-nums">{sar(p.cost_per_lead)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.mobile_pct == null ? '—' : `${p.mobile_pct}%`}</TableCell>
                <TableCell className="text-right tabular-nums">{p.avg_dwell_seconds == null ? '—' : `${p.avg_dwell_seconds}s`}</TableCell>
              </TableRow>
            ))}
            {data?.placements.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                  No placements yet. Add them from Campaigns → placements.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        {MODELS[model].note} QR opens are counted for redirect links only (before any consent); scans are visitors who
        accepted analytics.
        {!!totals?.unattributed_scans && ` ${totals.unattributed_scans.toLocaleString()} scans had no billboard code.`}
      </p>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Daypart</CardTitle>
          <CardDescription>Scans by hour of day (Asia/Riyadh)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <BarChart data={data?.hourly ?? []}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tickFormatter={(h: number) => `${h}:00`} interval={2} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `${p?.[0]?.payload?.hour}:00`} />} />
              <Bar dataKey="scans" fill="var(--color-scans)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </>
  )
}
