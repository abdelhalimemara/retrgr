import { Copy, MapPin, Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { PlacementsSheet } from '@/components/placements-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, useApi } from '@/lib/api'
import { formatDate, type Campaign, type Partner } from '@/lib/types'

const STATUS_VARIANT = { active: 'default', draft: 'secondary', ended: 'outline' } as const

export const landingUrl = (slug: string) => `${window.location.origin}/c/${slug}`

export default function CampaignsPage() {
  const { data, reload } = useApi<Campaign[]>('/admin/campaigns')
  const { data: partners } = useApi<Partner[]>('/admin/partners')
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)
  const [placementsFor, setPlacementsFor] = useState<Campaign | null>(null)

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(landingUrl(slug))
    toast.success('Landing URL copied. Use per-placement QR codes for billboard attribution.')
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each OOH placement gets a consent landing page reachable by QR code or short link."
        actions={
          <Button onClick={() => setEditing('new')} disabled={!partners?.length}>
            <Plus /> New campaign
          </Button>
        }
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Flight</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    /c/{c.slug}
                    {c.location && ` · ${c.location}`}
                  </div>
                </TableCell>
                <TableCell>{c.partner_name}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]} className="capitalize">
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(c.starts_on)} – {formatDate(c.ends_on)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.customer_count.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setPlacementsFor(c)} aria-label="Placements & QR codes">
                    <MapPin />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => copy(c.slug)} aria-label="Copy landing URL">
                    <Copy />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(c)} aria-label="Edit">
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {partners?.length ? 'No campaigns yet.' : 'Add a partner first, then create a campaign.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <PlacementsSheet campaign={placementsFor} onClose={() => setPlacementsFor(null)} />

      {editing && (
        <CampaignDialog
          campaign={editing === 'new' ? null : editing}
          partners={partners ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
    </>
  )
}

function CampaignDialog({
  campaign,
  partners,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null
  partners: Partner[]
  onClose: () => void
  onSaved: () => void
}) {
  const [partnerId, setPartnerId] = useState(campaign?.partner_id ?? partners[0]?.id ?? '')
  const [status, setStatus] = useState<string>(campaign?.status ?? 'draft')

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body = {
      partner_id: partnerId,
      status,
      name: f.get('name'),
      slug: f.get('slug'),
      headline: f.get('headline') || null,
      location: f.get('location') || null,
      city: f.get('city') || null,
      starts_on: f.get('starts_on') || null,
      ends_on: f.get('ends_on') || null,
      consent_version: f.get('consent_version') || 'v1',
    }
    try {
      if (campaign) await api.put(`/admin/campaigns/${campaign.id}`, body)
      else await api.post('/admin/campaigns', body)
      toast.success(campaign ? 'Campaign updated' : 'Campaign created')
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{campaign ? 'Edit campaign' : 'New campaign'}</DialogTitle>
            <DialogDescription>Only active campaigns accept submissions.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={campaign?.name} />
            </div>
            <div className="grid gap-2">
              <Label>Partner</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">URL slug</Label>
              <Input id="slug" name="slug" required pattern="[a-z0-9-]{3,64}" placeholder="riyadh-blvd-q4" defaultValue={campaign?.slug} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="consent_version">Consent policy version</Label>
              <Input id="consent_version" name="consent_version" defaultValue={campaign?.consent_version ?? 'v1'} />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="headline">Landing page headline</Label>
              <Input id="headline" name="headline" placeholder="Scan, sign up and win VIP tickets" defaultValue={campaign?.headline ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="location">Placement</Label>
              <Input id="location" name="location" placeholder="King Fahd Rd digital board" defaultValue={campaign?.location ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="Riyadh" defaultValue={campaign?.city ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="starts_on">Starts</Label>
              <Input id="starts_on" name="starts_on" type="date" defaultValue={campaign?.starts_on?.slice(0, 10)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ends_on">Ends</Label>
              <Input id="ends_on" name="ends_on" type="date" defaultValue={campaign?.ends_on?.slice(0, 10)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!partnerId}>
              {campaign ? 'Save changes' : 'Create campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
