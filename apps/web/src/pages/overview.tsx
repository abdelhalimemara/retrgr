import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { PageHeader } from '@/components/app-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { AGE_RANGES, type Stats } from '@/lib/types'

const chartConfig = { captures: { label: 'Captures', color: 'var(--chart-1)' } } satisfies ChartConfig

export default function OverviewPage() {
  const { data, loading } = useApi<Stats>('/admin/stats')

  const cards = [
    { label: 'Customer records', value: data?.totals.customers },
    { label: 'Active marketing consent', value: data?.totals.consented },
    { label: 'Live campaigns', value: data?.totals.active_campaigns },
    { label: 'Match lists exported', value: data?.totals.exports },
  ]

  const demo = (age: string, gender: string) =>
    data?.demographics.find((d) => d.age_range === age && d.gender === gender)?.count ?? 0

  return (
    <>
      <PageHeader title="Overview" description="Consented captures from OOH campaigns, consolidated into clean records." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {loading ? <Skeleton className="h-9 w-20" /> : (c.value ?? 0).toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Captures</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={data?.daily ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  minTickGap={24}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="captures" fill="var(--color-captures)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top campaigns</CardTitle>
            <CardDescription>By total captures</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data?.byCampaign.length ? (
              data.byCampaign.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className="tabular-nums text-muted-foreground">{c.captures.toLocaleString()}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No campaigns yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Audience profile</CardTitle>
          <CardDescription>Self-declared age and gender from consent forms</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Female</TableHead>
                <TableHead className="text-right">Male</TableHead>
                <TableHead className="text-right">Undisclosed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...AGE_RANGES, 'unknown'].map((age) => (
                <TableRow key={age}>
                  <TableCell className="font-medium">{age}</TableCell>
                  <TableCell className="text-right tabular-nums">{demo(age, 'female')}</TableCell>
                  <TableCell className="text-right tabular-nums">{demo(age, 'male')}</TableCell>
                  <TableCell className="text-right tabular-nums">{demo(age, 'undisclosed')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
