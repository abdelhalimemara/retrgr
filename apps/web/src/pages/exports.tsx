import { Download, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, useApi } from '@/lib/api'
import { PLATFORMS, PLATFORM_LABELS, formatDate, type ExportRecord, type Platform, type Segment } from '@/lib/types'

const SINGLE_ID: Platform[] = ['tiktok', 'snapchat']

export default function ExportsPage() {
  const { data: segments } = useApi<Segment[]>('/admin/segments')
  const { data: history, reload } = useApi<ExportRecord[]>('/admin/exports')
  const [segmentId, setSegmentId] = useState('')
  const [platform, setPlatform] = useState<Platform>('meta')
  const [identifier, setIdentifier] = useState<'email' | 'phone'>('email')
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    try {
      const headers = await api.download('/admin/exports', { segment_id: segmentId, platform, identifier })
      toast.success(`Exported ${headers.get('X-Record-Count') ?? ''} hashed records`)
      void reload()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Match lists" description="Generate Customer Match / Custom Audience files to retarget OOH viewers on social." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>New export</CardTitle>
            <CardDescription>Identifiers are SHA-256 hashed per platform spec.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a segment" />
                </SelectTrigger>
                <SelectContent>
                  {segments?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.size.total.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {SINGLE_ID.includes(platform) && (
              <div className="grid gap-2">
                <Label>Identifier</Label>
                <Select value={identifier} onValueChange={(v) => setIdentifier(v as 'email' | 'phone')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{PLATFORM_LABELS[platform]} takes one identifier type per file.</p>
              </div>
            )}
            <Button onClick={generate} disabled={!segmentId || busy}>
              <Download /> Generate CSV
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:col-span-2">
          <Alert>
            <ShieldCheck />
            <AlertTitle>Only ad-personalisation consent is exported</AlertTitle>
            <AlertDescription>
              Exports include only people who opted in to having their hashed contact details shared with ad platforms, and
              exclude anyone who has withdrawn. Every export is logged for PDPL accountability. Re-export and replace lists
              regularly so withdrawals and erasures propagate.
            </AlertDescription>
          </Alert>

          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Segment</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history?.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.segment_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{PLATFORM_LABELS[e.platform]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.record_count.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{e.created_by}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(e.created_at)}</TableCell>
                  </TableRow>
                ))}
                {history?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No exports yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </>
  )
}
