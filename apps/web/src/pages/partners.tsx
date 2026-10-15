import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, useApi } from '@/lib/api'
import { formatDate, type Partner } from '@/lib/types'

export default function PartnersPage() {
  const { data, reload } = useApi<Partner[]>('/admin/partners')
  const [open, setOpen] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await api.post('/admin/partners', {
        name: f.get('name'),
        contact_email: f.get('contact_email') || null,
        notes: f.get('notes') || null,
      })
      toast.success('Partner added')
      setOpen(false)
      void reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Partners"
        description="OOH media owners and brands you run capture campaigns with."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> New partner
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={onSubmit} className="grid gap-4">
                <DialogHeader>
                  <DialogTitle>New partner</DialogTitle>
                  <DialogDescription>Campaigns are always attributed to a partner.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contact_email">Contact email</Label>
                  <Input id="contact_email" name="contact_email" type="email" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" placeholder="Data-sharing agreement reference, terms…" />
                </div>
                <DialogFooter>
                  <Button type="submit">Create partner</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Campaigns</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-muted-foreground">{p.contact_email ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{p.campaign_count}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.created_at)}</TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No partners yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
