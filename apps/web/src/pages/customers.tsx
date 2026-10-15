import { ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/app-layout'
import { CustomerSheet } from '@/components/customer-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, useApi } from '@/lib/api'
import { formatDate, fullName, type Customer } from '@/lib/types'

export default function CustomersPage() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, reload } = useApi<{ rows: Customer[]; total: number; pageSize: number }>(
    `/admin/customers?page=${page}&q=${encodeURIComponent(q)}`,
  )
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const [validating, setValidating] = useState(false)
  // Also runs hourly in the maintenance job; this checks up to 200 unchecked contacts now.
  const validate = async () => {
    setValidating(true)
    try {
      const r = await api.post<{ checked: number; invalid_emails: number; invalid_phones: number }>('/admin/customers/validate', {})
      toast.success(`Checked ${r.checked} contacts · ${r.invalid_emails} invalid emails · ${r.invalid_phones} invalid phones`)
      void reload()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setValidating(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="One consolidated record per person, deduplicated on hashed email and phone."
        actions={
          <Button variant="outline" disabled={validating} onClick={validate}>
            <ShieldCheck /> {validating ? 'Validating…' : 'Validate contacts'}
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search name, email, phone, city…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Consent</TableHead>
              <TableHead className="text-right">Intent</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                <TableCell className="font-medium">{fullName(c)}</TableCell>
                <TableCell>
                  <div className={c.email_status === 'invalid' ? 'text-muted-foreground line-through' : undefined}>{c.email ?? '—'}</div>
                  <div className={`text-xs text-muted-foreground ${c.phone_status === 'invalid' ? 'line-through' : ''}`}>{c.phone}</div>
                </TableCell>
                <TableCell>{c.age_range ?? '—'}</TableCell>
                <TableCell className="capitalize">{c.gender ?? '—'}</TableCell>
                <TableCell>{c.city ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={c.consent_active ? 'default' : 'outline'}>{c.consent_active ? 'Active' : 'Withdrawn'}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.intent_score ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.max(c.scan_count, c.touchpoint_count)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(c.last_seen_at)}</TableCell>
              </TableRow>
            ))}
            {data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  No customers found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.total.toLocaleString() ?? 0} records</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>

      <CustomerSheet
        id={selected}
        onClose={() => setSelected(null)}
        onErased={() => {
          setSelected(null)
          void reload()
        }}
      />
    </>
  )
}
