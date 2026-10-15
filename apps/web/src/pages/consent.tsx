import { CheckCircle2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, useApi } from '@/lib/api'
import { analyticsChoice, loadCollector, setAnalyticsChoice } from '@/lib/collector'
import { readCaptureContext } from '@/lib/context'
import { AGE_RANGES } from '@/lib/types'

interface PublicCampaign {
  slug: string
  name: string
  headline: string | null
  consent_version: string
  partner_name: string
}

export function PublicShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">{children}</div>
}

/** Hosted consent landing page — the QR code on the OOH placement points here. */
export default function ConsentPage() {
  const { slug } = useParams()
  const { data: campaign, error, loading } = useApi<PublicCampaign>(`/public/campaigns/${slug}`)
  const context = useMemo(readCaptureContext, [])
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [marketing, setMarketing] = useState(false)
  const [adPersonalization, setAdPersonalization] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [formError, setFormError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState(analyticsChoice)

  // Scan + engagement tracking only starts after analytics consent.
  useEffect(() => {
    if (campaign && analytics === 'granted') loadCollector(campaign.slug, campaign.consent_version).catch(() => {})
  }, [campaign, analytics])

  const chooseAnalytics = (choice: 'granted' | 'denied') => {
    setAnalyticsChoice(choice)
    setAnalytics(choice)
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (!f.get('email') && !f.get('phone')) return setFormError('Please enter your email or mobile number.')
    setStatus('sending')
    setFormError(null)
    const fields = {
      email: (f.get('email') as string) || null,
      phone: (f.get('phone') as string) || null,
      first_name: (f.get('first_name') as string) || null,
      age_range: age || null,
      gender: gender || null,
    }
    try {
      if (window.retrgtr) {
        // Through the collector: links this lead to the scan + billboard, and routes via sGTM when configured.
        await window.retrgtr.capture({ ...fields, campaign: slug, consent_marketing: true, consent_ad_personalization: adPersonalization })
      } else {
        await api.post('/public/capture', {
          ...fields,
          campaign: slug,
          bid: new URLSearchParams(window.location.search).get('bid')?.toLowerCase() || null,
          consent: { marketing: true, ad_personalization: adPersonalization, policy_version: campaign!.consent_version },
          context,
        })
      }
      setStatus('done')
    } catch (err) {
      setFormError((err as Error).message)
      setStatus('idle')
    }
  }

  if (loading) {
    return (
      <PublicShell>
        <Skeleton className="h-96 w-full max-w-md" />
      </PublicShell>
    )
  }

  if (error || !campaign) {
    return (
      <PublicShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>This campaign has ended</CardTitle>
            <CardDescription>Thanks for your interest.</CardDescription>
          </CardHeader>
        </Card>
      </PublicShell>
    )
  }

  if (status === 'done') {
    return (
      <PublicShell>
        <Card className="w-full max-w-md text-center">
          <CardHeader className="items-center">
            <CheckCircle2 className="mx-auto size-10 text-primary" />
            <CardTitle className="text-xl">You’re in!</CardTitle>
            <CardDescription>Thanks for signing up with {campaign.partner_name}.</CardDescription>
          </CardHeader>
        </Card>
      </PublicShell>
    )
  }

  return (
    <PublicShell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardDescription>{campaign.partner_name}</CardDescription>
          <CardTitle className="text-xl">{campaign.headline ?? campaign.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="first_name">First name</Label>
              <Input id="first_name" name="first_name" autoComplete="given-name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Mobile</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="05X XXX XXXX" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Age</Label>
                <Select value={age} onValueChange={setAge}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_RANGES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="undisclosed">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={marketing} onCheckedChange={(c) => setMarketing(c === true)} className="mt-0.5" />
              <span>
                I agree that {campaign.partner_name} may contact me with marketing offers. I am 18 or older and have read the
                privacy notice (version {campaign.consent_version}).
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={adPersonalization} onCheckedChange={(c) => setAdPersonalization(c === true)} className="mt-0.5" />
              <span className="text-muted-foreground">
                Optional: use an encrypted (hashed) version of my email or mobile to show me relevant ads on social media
                platforms such as Instagram, Snapchat, TikTok and YouTube.
              </span>
            </label>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" data-cta disabled={!marketing || status === 'sending'}>
              {status === 'sending' ? 'Submitting…' : 'Sign up'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You can withdraw consent at any time on the{' '}
              <Link to="/optout" className="underline">
                opt-out page
              </Link>
              .
            </p>
          </form>
        </CardContent>
      </Card>

      {analytics === null && (
        <Card className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md gap-3 py-4 shadow-lg">
          <CardContent className="grid gap-3 px-4 text-sm">
            <p>
              We’d like to measure which billboard brought you here (device type, language and how you use this page). No
              tracking across other sites.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => chooseAnalytics('granted')}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => chooseAnalytics('denied')}>
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PublicShell>
  )
}
