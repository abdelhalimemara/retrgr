import { Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, useApi } from '@/lib/api'
import { formatDate, type Partner } from '@/lib/types'

export default function PartnersPage() {
  const { data, reload } = useApi<Partner[]>('/admin/partners')
  // null = closed, 'new' = create, Partner = edit
  const [editing, setEditing] = useState<Partner | 'new' | null>(null)

  return (
    <>
      <PageHeader
        title="Partners"
        description="OOH media owners and brands. Each partner installs one collector snippet in their own GTM."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New partner
          </Button>
        }
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Partner key</TableHead>
              <TableHead>Websites</TableHead>
              <TableHead>Consent</TableHead>
              <TableHead className="text-right">Campaigns</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.contact_email ?? ''}</div>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{p.key}</code>
                </TableCell>
                <TableCell>
                  {p.allowed_origins.length ? (
                    <div className="flex flex-wrap gap-1">
                      {p.allowed_origins.map((o) => (
                        <Badge key={o} variant="secondary">
                          {o.replace(/^https?:\/\//, '')}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="outline">Any website</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{p.analytics_basis === 'notice' ? 'No banner (notice)' : 'Banner consent'}</Badge>
                    <Badge variant="outline">{p.marketing_basis === 'form_notice' ? 'Form notice opt-in' : 'Checkbox opt-in'}</Badge>
                    {p.typed_notice && <Badge variant="outline">Saves as typed</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.campaign_count}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.created_at)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/collector?partner=${p.id}`}>Snippet</Link>
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Edit partner" onClick={() => setEditing(p)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No partners yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {editing && (
        <PartnerDialog
          partner={editing === 'new' ? null : editing}
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

function PartnerDialog({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [noBanner, setNoBanner] = useState(partner?.analytics_basis === 'notice')
  const [formOptIn, setFormOptIn] = useState(partner?.marketing_basis === 'form_notice')
  const [coversAds, setCoversAds] = useState(partner?.notice_covers_ads ?? false)
  const [saveTyped, setSaveTyped] = useState(!!partner?.typed_notice)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body = {
      name: f.get('name'),
      contact_email: f.get('contact_email') || null,
      notes: f.get('notes') || null,
      allowed_origins: String(f.get('allowed_origins') ?? '')
        .split(/[\s,]+/)
        .filter(Boolean),
      analytics_basis: noBanner ? 'notice' : 'consent',
      privacy_notice_url: noBanner ? f.get('privacy_notice_url') || null : null,
      marketing_basis: formOptIn ? 'form_notice' : 'checkbox',
      marketing_notice: formOptIn ? f.get('marketing_notice') || null : null,
      notice_covers_ads: formOptIn && coversAds,
      typed_notice: saveTyped ? f.get('typed_notice') || null : null,
    }
    try {
      if (partner) await api.put(`/admin/partners/${partner.id}`, body)
      else await api.post('/admin/partners', body)
      toast.success(partner ? 'Partner updated' : 'Partner added')
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{partner ? 'Edit partner' : 'New partner'}</DialogTitle>
            <DialogDescription>Campaigns are always attributed to a partner.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required defaultValue={partner?.name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contact_email">Contact email</Label>
            <Input id="contact_email" name="contact_email" type="email" defaultValue={partner?.contact_email ?? ''} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="allowed_origins">Websites running the collector</Label>
            <Textarea
              id="allowed_origins"
              name="allowed_origins"
              placeholder={'brand.sa\nwww.brand.sa\noffers.brand.sa'}
              defaultValue={partner?.allowed_origins.join('\n')}
            />
            <p className="text-xs text-muted-foreground">
              One per line. Data sent with this partner’s key from any other website is ignored. Leave empty while testing.
            </p>
          </div>

          <div className="grid gap-3 rounded-md border p-3">
            <div className="text-sm font-medium">Consent</div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={noBanner} onCheckedChange={(c) => setNoBanner(c === true)} className="mt-0.5" />
              <span>
                Run without a consent banner
                <span className="block text-xs text-muted-foreground">
                  The collector starts on page load, relying on the site’s privacy notice instead of banner consent. Scans are
                  recorded as “privacy notice”, not “consented”. A visitor who declines in a banner is still respected.
                </span>
              </span>
            </label>
            {noBanner && (
              <div className="grid gap-2">
                <Label htmlFor="privacy_notice_url">Privacy notice URL on the client’s site</Label>
                <Input
                  id="privacy_notice_url"
                  name="privacy_notice_url"
                  type="url"
                  required
                  placeholder="https://brand.sa/privacy"
                  defaultValue={partner?.privacy_notice_url ?? ''}
                />
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={formOptIn} onCheckedChange={(c) => setFormOptIn(c === true)} className="mt-0.5" />
              <span>
                Form submission counts as marketing opt-in
                <span className="block text-xs text-muted-foreground">
                  Only when the client’s form shows a marketing notice next to the submit button. The notice text is stored
                  with every consent as evidence. Without this, a ticked consent checkbox is required.
                </span>
              </span>
            </label>
            {formOptIn && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="marketing_notice">Notice text exactly as shown on the form</Label>
                  <Textarea
                    id="marketing_notice"
                    name="marketing_notice"
                    required
                    minLength={20}
                    placeholder="By submitting, you agree to receive offers from Brand by email/SMS and to see personalised ads on social media. Unsubscribe anytime."
                    defaultValue={partner?.marketing_notice ?? ''}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={coversAds} onCheckedChange={(c) => setCoversAds(c === true)} className="mt-0.5" />
                  <span>
                    The notice also covers personalised ads on social media
                    <span className="block text-xs text-muted-foreground">Required for these leads to be used in ad-platform match lists.</span>
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="grid gap-3 rounded-md border p-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={saveTyped} onCheckedChange={(c) => setSaveTyped(c === true)} className="mt-0.5" />
              <span>
                Save entries as typed (partial leads)
                <span className="block text-xs text-muted-foreground">
                  Only when the client discloses it — above the form, or in a privacy notice linked from the page. Name, email, phone and answers are saved once
                  an email or phone is entered — even if the form isn’t submitted. Partial leads are for follow-up only: never
                  exported to ad platforms; removed on opt-out, or replaced by the full lead when the person submits.
                </span>
              </span>
            </label>
            {saveTyped && (
              <div className="grid gap-2">
                <Label htmlFor="typed_notice">Disclosure exactly as published (and where)</Label>
                <Textarea
                  id="typed_notice"
                  name="typed_notice"
                  required
                  minLength={20}
                  placeholder="We save what you enter as you type so our team can follow up, even if you don’t submit."
                  defaultValue={partner?.typed_notice ?? ''}
                />
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" placeholder="Data-sharing agreement reference, terms…" defaultValue={partner?.notes ?? ''} />
          </div>
          <DialogFooter>
            <Button type="submit">{partner ? 'Save' : 'Create partner'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
