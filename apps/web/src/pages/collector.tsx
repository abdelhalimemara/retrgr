import { Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { API_URL, useApi } from '@/lib/api'
import type { Campaign } from '@/lib/types'

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
  const { data: campaigns } = useApi<Campaign[]>('/admin/campaigns')
  const [slug, setSlug] = useState('')
  const campaign = slug || campaigns?.[0]?.slug || 'your-campaign-slug'
  const sgtm = import.meta.env.VITE_COLLECT_URL as string | undefined
  const endpoint = sgtm ? sgtm.replace(/\/retrgtr\/?$/, '') : API_URL || window.location.origin
  const path = sgtm ? '/retrgtr' : '/api/public'

  const tag = `<script src="${window.location.origin}/retrgtr.js"
        data-endpoint="${endpoint}"
        data-path="${path}"
        data-campaign="${campaign}"
        data-policy-version="v1" async></script>`

  const form = `<form data-retrgtr-form="${campaign}">
  <input name="first_name" placeholder="First name">
  <input name="email" type="email" placeholder="Email">
  <input name="phone" type="tel" placeholder="Mobile">
  <select name="age_range">
    <option value="18-24">18–24</option><option value="25-34">25–34</option>
    <option value="35-44">35–44</option><option value="45-54">45–54</option>
    <option value="55-64">55–64</option><option value="65+">65+</option>
  </select>
  <select name="gender">
    <option value="female">Female</option><option value="male">Male</option>
    <option value="undisclosed">Prefer not to say</option>
  </select>
  <label><input type="checkbox" name="consent_marketing" required>
    I agree to receive marketing from [Brand] (Privacy Policy v1)</label>
  <label><input type="checkbox" name="consent_ad_personalization">
    Use my hashed email/phone to show me relevant ads on social media</label>
  <button>Submit</button>
</form>
<script>
  document.querySelector('[data-retrgtr-form]')
    .addEventListener('retrgtr:success', () => { /* show thank-you */ })
</script>`

  return (
    <>
      <PageHeader
        title="Collector setup"
        description="Install the Retrgtr collector through Google Tag Manager on partner landing pages."
      />

      <div className="mb-6 grid max-w-xs gap-2">
        <Label>Campaign</Label>
        <Select value={campaign} onValueChange={setSlug}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a campaign" />
          </SelectTrigger>
          <SelectContent>
            {campaigns?.map((c) => (
              <SelectItem key={c.id} value={c.slug}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. GTM Custom HTML tag</CardTitle>
            <CardDescription>
              In GTM: Tags → New → Custom HTML, trigger on the landing page (Page View). Under Advanced Settings → Consent
              Settings, require <code>analytics_storage</code> so the collector only loads after your Consent Mode v2 banner
              grants it. {sgtm ? 'Events go through your server-side GTM container.' : 'Set VITE_COLLECT_URL to route events through sGTM.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={tag} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Consent form markup</CardTitle>
            <CardDescription>
              Add <code>data-retrgtr-form</code> to the partner’s form and use these field names. Or skip this entirely and send
              QR traffic to the hosted page at <code>/c/{campaign}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={form} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>What gets collected</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="font-medium">Declared by the person</div>
              <p className="text-muted-foreground">Email, mobile, name, age range, gender, city — plus explicit consent per purpose.</p>
            </div>
            <div>
              <div className="font-medium">Read by the collector (after analytics consent)</div>
              <p className="text-muted-foreground">
                Billboard code (bid), offer variant, UTMs and click IDs, device model / OS / screen, language, time zone,
                connection type, repeat-scan count, dwell, scroll depth, CTA clicks and form drop-off field.
              </p>
            </div>
            <div>
              <div className="font-medium">Never collected</div>
              <p className="text-muted-foreground">
                No third-party cookies, fingerprinting, cross-site tracking, GPS or national IDs. Form fields outside the allowlist
                are ignored. Age and gender are always self-declared.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
