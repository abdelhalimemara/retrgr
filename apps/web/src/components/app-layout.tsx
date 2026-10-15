import { BarChart3, ClipboardList, Code, Download, Filter, Handshake, LayoutDashboard, LogOut, Megaphone, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { useAuth } from '@/lib/auth'

const NAV = [
  {
    label: 'Collect',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
      { to: '/attribution', label: 'Attribution', icon: BarChart3 },
      { to: '/forms', label: 'Forms', icon: ClipboardList },
      { to: '/partners', label: 'Partners', icon: Handshake },
      { to: '/collector', label: 'Collector setup', icon: Code },
    ],
  },
  {
    label: 'Activate',
    items: [
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/segments', label: 'Segments', icon: Filter },
      { to: '/exports', label: 'Match lists', icon: Download },
    ],
  },
]

export function AppLayout() {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              R
            </div>
            <span className="font-semibold tracking-tight">Retrgtr</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)}
                      >
                        <NavLink to={item.to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">Data hosted in GCP me-central1 (Doha)</span>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}
