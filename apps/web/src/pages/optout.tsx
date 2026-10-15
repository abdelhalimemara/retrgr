import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { PublicShell } from '@/pages/consent'

export default function OptOutPage() {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (!f.get('email') && !f.get('phone')) return
    setBusy(true)
    try {
      await api.post('/public/withdraw', { email: f.get('email') || undefined, phone: f.get('phone') || undefined })
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicShell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Withdraw consent</CardTitle>
          <CardDescription>
            {done
              ? 'Done. If we hold your details, you will no longer receive marketing or be included in advertising audiences.'
              : 'Enter the email or mobile number you signed up with.'}
          </CardDescription>
        </CardHeader>
        {!done && (
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Mobile</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
              <Button type="submit" disabled={busy}>
                Withdraw my consent
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </PublicShell>
  )
}
