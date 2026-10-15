import { Download, FileArchive, FileDown, Plus, Trash2, Upload } from 'lucide-react'
import QRCode from 'qrcode'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, ApiError, useApi } from '@/lib/api'
import { PLACEMENT_CSV_TEMPLATE, placementsFromCsv } from '@/lib/csv'
import { zipFiles } from '@/lib/zip'
import { sar, type Campaign, type Placement } from '@/lib/types'

/** QR target for one billboard. `bid` drives placement attribution; UTMs keep GA4 consistent. */
export function placementUrl(campaignSlug: string, code: string) {
  const qs = new URLSearchParams({ bid: code, utm_source: 'ooh', utm_medium: 'qr', utm_campaign: campaignSlug })
  return `${window.location.origin}/c/${campaignSlug}?${qs}`
}

// High error correction + generous size so the code survives print scaling and partial occlusion.
const qrSvg = (campaignSlug: string, code: string) =>
  QRCode.toString(placementUrl(campaignSlug, code), { type: 'svg', errorCorrectionLevel: 'H', margin: 2, width: 1200 })

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
  URL.revokeObjectURL(url)
}

async function downloadQr(campaignSlug: string, code: string) {
  save(new Blob([await qrSvg(campaignSlug, code)], { type: 'image/svg+xml' }), `qr-${campaignSlug}-${code}.svg`)
}

const csvCell = (v: unknown) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))

/** Every placement's QR as SVG, plus a manifest the print vendor can match files to sites with. */
async function downloadAllQr(campaignSlug: string, placements: Placement[]) {
  const enc = new TextEncoder()
  const files = await Promise.all(
    placements.map(async (p) => ({ name: `qr-${campaignSlug}-${p.code}.svg`, data: enc.encode(await qrSvg(campaignSlug, p.code)) })),
  )
  const manifest = [
    'file,code,name,city,district,url',
    ...placements.map((p) =>
      [`qr-${campaignSlug}-${p.code}.svg`, p.code, p.name, p.city, p.district, placementUrl(campaignSlug, p.code)].map(csvCell).join(','),
    ),
  ].join('\n')
  files.push({ name: 'manifest.csv', data: enc.encode('\uFEFF' + manifest) })
  save(zipFiles(files), `qr-codes-${campaignSlug}.zip`)
}

export function PlacementsSheet({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { data, reload } = useApi<Placement[]>(campaign ? `/admin/placements?campaign_id=${campaign.id}` : null)
  const [formKey, setFormKey] = useState(0)
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file after fixing it
    if (!file || !campaign) return
    setImportErrors(null)
    const { rows, unknownColumns } = placementsFromCsv(await file.text())
    if (!rows.length) return toast.error('No rows found in the file')
    if (unknownColumns.length) toast.warning(`Ignored columns: ${unknownColumns.join(', ')}`)
    setBusy(true)
    try {
      const cityDefault = campaign.city
      const res = await api.post<{ imported: number }>('/admin/placements/bulk', {
        campaign_id: campaign.id,
        rows: rows.map((r) => ({ ...r, city: r.city ?? cityDefault })),
      })
      toast.success(`Imported ${res.imported} placements`)
      void reload()
    } catch (err) {
      const errors = err instanceof ApiError ? (err.body as { errors?: { row: number; message: string }[] })?.errors : undefined
      if (errors?.length) setImportErrors(errors)
      else toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    try {
      await api.post('/admin/placements', {
        campaign_id: campaign!.id,
        code: String(f.get('code')).toLowerCase(),
        name: f.get('name'),
        format: f.get('format') || null,
        city: f.get('city') || campaign!.city,
        district: f.get('district') || null,
        cost_sar: num('cost_sar'),
        latitude: num('latitude'),
        longitude: num('longitude'),
      })
      toast.success('Placement added')
      setFormKey((k) => k + 1)
      void reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const remove = async (id: string) => {
    await api.delete(`/admin/placements/${id}`)
    void reload()
  }

  return (
    <Sheet open={!!campaign} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Placements · {campaign?.name}</SheetTitle>
          <SheetDescription>Each billboard gets its own QR code so scans, leads and cost are attributed per placement.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 px-4">
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={onImport} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload /> Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => save(new Blob(['\uFEFF' + PLACEMENT_CSV_TEMPLATE], { type: 'text/csv' }), 'placements-template.csv')}
          >
            <FileDown /> CSV template
          </Button>
          <Button variant="outline" size="sm" disabled={!data?.length} onClick={() => downloadAllQr(campaign!.slug, data ?? [])}>
            <FileArchive /> All QR codes (.zip)
          </Button>
        </div>

        {importErrors && (
          <div className="px-4">
            <Alert variant="destructive">
              <AlertTitle>Nothing was imported — fix these rows and upload again</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-4">
                  {importErrors.slice(0, 20).map((er, i) => (
                    <li key={i}>
                      Row {er.row}: {er.message}
                    </li>
                  ))}
                  {importErrors.length > 20 && <li>…and {importErrors.length - 20} more</li>}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <div className="grid gap-3 px-4">
          {data?.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  bid={p.code}
                  {p.district && ` · ${p.district}`}
                  {p.cost_sar && ` · ${sar(Number(p.cost_sar))}`}
                </div>
              </div>
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label="Download QR code" onClick={() => downloadQr(campaign!.slug, p.code)}>
                  <Download />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Delete placement" onClick={() => remove(p.id)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
          {data?.length === 0 && <p className="text-sm text-muted-foreground">No placements yet.</p>}
        </div>

        <Separator className="my-2" />

        <form key={formKey} onSubmit={onSubmit} className="grid grid-cols-2 gap-4 px-4 pb-6">
          <div className="col-span-2 text-sm font-medium">Add placement</div>
          <div className="grid gap-2">
            <Label htmlFor="pl-name">Name</Label>
            <Input id="pl-name" name="name" required placeholder="King Fahd Rd unipole" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-code">Code (bid)</Label>
            <Input id="pl-code" name="code" required pattern="[a-z0-9\-]{2,40}" placeholder="kfr-01" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-format">Format</Label>
            <Input id="pl-format" name="format" placeholder="Digital screen" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-cost">Flight cost (SAR)</Label>
            <Input id="pl-cost" name="cost_sar" type="number" min="0" step="0.01" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-city">City</Label>
            <Input id="pl-city" name="city" placeholder={campaign?.city ?? 'Riyadh'} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-district">District</Label>
            <Input id="pl-district" name="district" placeholder="Al Olaya" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-lat">Latitude</Label>
            <Input id="pl-lat" name="latitude" type="number" step="any" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pl-lng">Longitude</Label>
            <Input id="pl-lng" name="longitude" type="number" step="any" />
          </div>
          <Button type="submit" className="col-span-2">
            <Plus /> Add placement
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
