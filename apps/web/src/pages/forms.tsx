import { useState } from 'react'
import { PageHeader } from '@/components/app-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, fullName, type Campaign, type FormReport, type PartialLead } from '@/lib/types'

const ALL = 'all'

export default function FormsPage() {
  const { data: campaigns } = useApi<Campaign[]>('/admin/campaigns')
  const [campaignId, setCampaignId] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const qs = new URLSearchParams()
  if (campaignId !== ALL) qs.set('campaign_id', campaignId)
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, loading } = useApi<FormReport[]>(`/admin/forms?${qs}`)

  return (
    <>
      <PageHeader
        title="Forms"
        description="How far visitors get in each form and where they stop. Typed entries of unsubmitted forms are only kept for partners whose form discloses it (partial leads below)."
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
          <Label htmlFor="forms-from">From</Label>
          <Input id="forms-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="forms-to">To</Label>
          <Input id="forms-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {loading && !data && <Skeleton className="h-48 w-full" />}
      {data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No form activity yet. Forms appear here once visitors start filling them in.</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {data?.map((f) => (
          <Card key={`${f.campaign_id}|${f.form_id}`} className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="truncate">{f.form_id}</span>
                <Badge variant={f.completion_pct >= 50 ? 'default' : 'secondary'}>{f.completion_pct}% complete</Badge>
              </CardTitle>
              <CardDescription>{f.campaign_name}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ['Started', f.starts],
                  ['Submitted', f.submits],
                  ['Abandoned', f.abandons],
                ].map(([label, n]) => (
                  <div key={label} className="rounded-md bg-muted p-2">
                    <div className="text-2xl font-semibold tabular-nums">{Number(n).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-2">
                <div className="text-sm font-medium">How far people get</div>
                {f.fields.length === 0 && <p className="text-xs text-muted-foreground">No fields filled yet.</p>}
                {f.fields.map((x) => (
                  <div key={x.field} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
                    <span className="truncate text-muted-foreground" title={x.field}>
                      {x.field}
                    </span>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${x.pct}%` }} />
                    </div>
                    <span className="text-right tabular-nums">{x.pct}%</span>
                  </div>
                ))}
              </div>

              {f.dropoffs.length > 0 && (
                <div className="grid gap-1">
                  <div className="text-sm font-medium">Where abandoners stopped</div>
                  {f.dropoffs.map((d) => (
                    <div key={d.field} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{d.field}</span>
                      <span className="tabular-nums">
                        {d.abandons.toLocaleString()} ({f.abandons ? Math.round((100 * d.abandons) / f.abandons) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <PartialLeads qs={qs.toString()} />

      <p className="mt-4 text-xs text-muted-foreground">
        Abandoners can be retargeted by cookie/pixel through the <code>ooh_form_abandon</code> dataLayer event (partner GTM) or
        the <code>form_abandon</code> sGTM event — only where the visitor accepted ad cookies. Their form entries are not stored.
      </p>
    </>
  )
}

/** Entries saved as typed on forms that disclose it — follow-up only, kept until submit or opt-out. */
function PartialLeads({ qs }: { qs: string }) {
  const { data } = useApi<PartialLead[]>(`/admin/partial-leads?${qs}`)
  if (!data?.length) return null
  return (
    <Card className="mt-6 py-0">
      <CardHeader className="pt-6">
        <CardTitle>Partial leads</CardTitle>
        <CardDescription>
          Entries saved as typed on forms that show the partner’s disclosure, from people who didn’t submit. For follow-up
          only — never in segments or ad exports. Removed on opt-out, or replaced by the full lead when the person submits.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Form</TableHead>
            <TableHead>Partner · campaign</TableHead>
            <TableHead>Saved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((p) => (
            <TableRow key={`${p.scan_id}|${p.form_id}`}>
              <TableCell className="font-medium">{fullName({ first_name: p.data.first_name, last_name: p.data.last_name })}</TableCell>
              <TableCell>
                <div>{p.email ?? '—'}</div>
                <div className="text-xs text-muted-foreground">{p.phone}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{p.form_id}</TableCell>
              <TableCell className="text-muted-foreground">
                {p.partner_name} · {p.campaign_name}
                {p.placement_name && ` · ${p.placement_name}`}
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(p.updated_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
