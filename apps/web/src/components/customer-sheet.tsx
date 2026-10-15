import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { api, useApi } from '@/lib/api'
import { formatDate, fullName, type CustomerDetail } from '@/lib/types'

export function CustomerSheet({ id, onClose, onErased }: { id: string | null; onClose: () => void; onErased: () => void }) {
  const { data } = useApi<CustomerDetail>(id ? `/admin/customers/${id}` : null)
  const [confirming, setConfirming] = useState(false)
  const detail = data?.customer.id === id ? data : null

  const erase = async () => {
    try {
      await api.delete(`/admin/customers/${id}`)
      toast.success('Customer record permanently erased')
      setConfirming(false)
      onErased()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const rows: [string, string | null | undefined][] = detail
    ? [
        ['Email', detail.customer.email],
        ['Phone', detail.customer.phone],
        ['Age range', detail.customer.age_range],
        ['Gender', detail.customer.gender],
        ['City', detail.customer.city],
        ['Country', detail.customer.country],
        ['First seen', formatDate(detail.customer.first_seen_at)],
      ]
    : []

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{detail ? fullName(detail.customer) : 'Customer'}</SheetTitle>
          <SheetDescription>Consolidated record, consent history and touchpoints.</SheetDescription>
        </SheetHeader>

        {!detail ? (
          <div className="grid gap-2 px-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <div className="grid gap-6 px-4 pb-6">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all">{v || '—'}</dd>
                </div>
              ))}
            </dl>

            <Separator />
            <section className="grid gap-3">
              <h3 className="text-sm font-medium">Consent log</h3>
              {detail.consents.map((k) => (
                <div key={k.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{k.campaign_name ?? 'Unknown campaign'}</span>
                    <Badge variant={k.withdrawn_at ? 'outline' : 'default'}>{k.withdrawn_at ? 'Withdrawn' : 'Active'}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {k.purposes.join(', ')} · policy {k.policy_version} · {formatDate(k.granted_at)}
                  </div>
                </div>
              ))}
            </section>

            <Separator />
            <section className="grid gap-3">
              <h3 className="text-sm font-medium">Touchpoints</h3>
              {detail.touchpoints.map((t) => (
                <div key={t.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span>
                      {t.campaign_name ?? 'Unknown campaign'}
                      {t.placement_name && <span className="font-normal text-muted-foreground"> · {t.placement_name}</span>}
                    </span>
                    <Badge variant="outline">{t.source === 'auto' ? `Partner form${t.form_id ? ` · ${t.form_id}` : ''}` : 'Hosted page'}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {[t.utm_source, t.utm_medium, t.device_type, t.language].filter(Boolean).join(' · ') || 'No context'} ·{' '}
                    {formatDate(t.created_at)}
                  </div>
                  {t.form_data && (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {Object.entries(t.form_data).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {(t.fbclid || t.gclid || t.ttclid || t.sccid) && (
                    <div className="mt-2 flex gap-1">
                      {t.fbclid && <Badge variant="secondary">fbclid</Badge>}
                      {t.gclid && <Badge variant="secondary">gclid</Badge>}
                      {t.ttclid && <Badge variant="secondary">ttclid</Badge>}
                      {t.sccid && <Badge variant="secondary">sccid</Badge>}
                    </div>
                  )}
                </div>
              ))}
            </section>

            <Separator />
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2 /> Erase record (PDPL request)
            </Button>
          </div>
        )}
      </SheetContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently erase this person?</DialogTitle>
            <DialogDescription>
              Deletes the customer, their consent records and touchpoints. This cannot be undone. Lists already uploaded to ad
              platforms must be refreshed separately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={erase}>
              Erase permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
