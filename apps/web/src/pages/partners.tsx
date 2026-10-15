import { Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
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
      <DialogContent>
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
