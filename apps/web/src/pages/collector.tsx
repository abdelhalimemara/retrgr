import { Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSearchParams } from 'react-router-dom'
import { API_URL, useApi } from '@/lib/api'
import type { Partner } from '@/lib/types'

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-4 pr-12 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(code)
          toast.success('Copied')
        }}
      >
        <Copy />
      </Button>
    </div>
  )
}

export default function CollectorPage() {
  const { data: partners } = useApi<Partner[]>('/admin/partners')
  const [params] = useSearchParams()
  const [picked, setPicked] = useState(params.get('partner') ?? '')
  const partner = partners?.find((p) => p.id === picked) ?? partners?.[0]
  const sgtm = import.meta.env.VITE_COLLECT_URL as string | undefined
  const endpoint = sgtm ? sgtm.replace(/\/retrgtr\/?$/, '') : API_URL || window.location.origin
  const path = sgtm ? '/retrgtr' : '/api/public'

  const tag = `<script src="${window.location.origin}/retrgtr.js"
        data-endpoint="${endpoint}"
        data-path="${path}"
        data-partner="${partner?.key ?? 'PARTNER-KEY'}"
        data-policy-version="v1"
        data-marketing-consent="checkbox" async></script>`

  const options = `<!-- Optional: exclude a form (e.g. a footer newsletter) from capture -->
<form data-retrgtr-ignore> … </form>

<!-- Optional: react to a captured lead -->
<script>
  document.addEventListener('retrgtr:success', (e) => { /* e.target = the form */ }, true)
</script>`

  return (
    <>
      <PageHeader
        title="Collector setup"
        description="Each partner adds one snippet to their own GTM. All partners share the central Retrgtr server container."
      />

      <div className="mb-6 grid max-w-xs gap-2">
        <Label>Partner</Label>
        <Select value={partner?.id ?? ''} onValueChange={setPicked}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a partner" />
          </SelectTrigger>
          <SelectContent>
            {partners?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>1. GTM Custom HTML tag</CardTitle>
            <CardDescription>
              The partner adds this in their own GTM: Tags → New → Custom HTML, trigger All Pages (or the landing pages).
              Under Advanced Settings → Consent Settings, require <code>analytics_storage</code> so it only loads after their
              Consent Mode v2 banner grants it. The campaign comes from the billboard code (<code>bid</code>) in the QR link,
              otherwise the partner’s active campaign. Data is only accepted from the partner’s registered websites
              {partner && !partner.allowed_origins.length ? ' (none registered yet — add them on the Partners page)' : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={tag} />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>2. Forms and dataLayer are captured automatically</CardTitle>
            <CardDescription>
              No changes to the partner’s page. Any form submitted with an email or mobile number is read and sent to
              Retrgtr; fields are recognised by type, autocomplete, name and label (English and Arabic). Every dataLayer push
              is mirrored to BigQuery with personal values redacted.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm">
            <div>
              <div className="font-medium">Marketing consent</div>
              <p className="text-muted-foreground">
                <code>data-marketing-consent="checkbox"</code> (default): a lead counts as opted in only when a ticked
                checkbox on the form mentions marketing, offers or newsletters; one mentioning ads or personalisation also
                grants ad personalisation. Use <code>"submit"</code> only when the form’s own wording is the opt-in. Leads
                without an opt-in are stored but never exported or sent to ad platforms.
              </p>
            </div>
            <CodeBlock code={options} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>What gets collected</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="font-medium">Declared by the person</div>
              <p className="text-muted-foreground">
                Email, mobile, name, age, gender and city are mapped onto the customer record; other answers on the form are
                kept on the touchpoint. Consent comes from the form’s own checkboxes.
              </p>
            </div>
            <div>
              <div className="font-medium">Read by the collector (after analytics consent)</div>
              <p className="text-muted-foreground">
                Billboard code (bid), offer variant, UTMs and click IDs, device model / OS / screen, language, time zone,
                connection type, repeat-scan count, dwell, scroll depth, CTA clicks, form drop-off field, and every dataLayer
                push (ecommerce, page and custom events) with personal values redacted.
              </p>
            </div>
            <div>
              <div className="font-medium">Never collected</div>
              <p className="text-muted-foreground">
                No third-party cookies, fingerprinting, cross-site tracking or GPS. Passwords, hidden fields, card numbers and
                national ID / Iqama numbers are never read, login forms are skipped, and nothing personal is pushed to the
                dataLayer. Age and gender are always self-declared.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
