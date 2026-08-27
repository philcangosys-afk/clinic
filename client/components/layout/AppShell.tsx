import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useLiveBadgeCounts, formatBadgeNumber } from "@/hooks/use-live-badges";
import {
  filterAccessibleModules,
  groupModules,
  moduleRegistry,
  settingsModule,
  type ModuleRegistryItem,
} from "@/lib/module-registry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function initialsOf(name: string | undefined | null) {
  if (!name) return "؟";
  const trimmed = name.trim();
  return trimmed.length ? trimmed[0] : "؟";
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { canAccess, organization, branch, session } = useOrganizationAccess();
  const location = useLocation();
  const liveBadges = useLiveBadgeCounts(organization?.id, session?.user.id);

  const groups = useMemo(() => {
    const accessible = filterAccessibleModules(moduleRegistry, canAccess);
    const withLiveBadges: ModuleRegistryItem[] = accessible.map((item) => {
      const live = liveBadges.data?.[item.id];
      if (live === null || live === undefined) return item;
      return { ...item, badge: formatBadgeNumber(live) };
    });
    return groupModules(withLiveBadges);
  }, [canAccess, liveBadges.data]);

  const settingsAccessible = canAccess(settingsModule.featureKey, settingsModule.requiredPermission);

  // القسم الذي يحتوي المسار الحالي يبقى مفتوحًا افتراضيًا؛ البقية مطوية لتقليل الطول.
  const activeSection = useMemo(() => {
    const currentId = location.pathname === "/" ? "dashboard" : location.pathname.slice(1).split("/")[0];
    return groups.find((g) => g.items.some((i) => i.id === currentId))?.section;
  }, [groups, location.pathname]);

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (activeSection) {
      setOpenSections((prev) => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)));
    }
  }, [activeSection]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-sm">
          ز
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-bold">{organization?.name ?? "نظام العيادة"}</span>
          <span className="truncate text-xs text-muted-foreground">{branch?.name ?? "المنشأة الرئيسية"}</span>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-2.5 py-3">
        <nav className="flex flex-col gap-1">
          {groups.map((group) => (
            <SidebarGroup
              key={group.section}
              section={group.section}
              items={group.items}
              isOpen={openSections.has(group.section)}
              onToggle={() => toggleSection(group.section)}
              onNavigate={onNavigate}
            />
          ))}
          {settingsAccessible && (
            <SidebarGroup
              section={settingsModule.category}
              items={[settingsModule]}
              isOpen={openSections.has(settingsModule.category)}
              onToggle={() => toggleSection(settingsModule.category)}
              onNavigate={onNavigate}
            />
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}

function SidebarGroup({
  section,
  items,
  isOpen,
  onToggle,
  onNavigate,
}: {
  section: string;
  items: { id: string; label: string; icon: LucideIcon; badge?: string }[];
  isOpen: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const totalBadge = items.reduce((sum, i) => {
    const n = Number(String(i.badge ?? "").replace(/[^0-9]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div className="pb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right transition-colors hover:bg-sidebar-accent"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">
          {section}
        </span>
        {!isOpen && totalBadge > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
            {totalBadge}
          </span>
        )}
      </button>

      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 py-0.5 pe-0.5 ps-4">
            {items.map((item) => (
              <SidebarLink key={item.id} id={item.id} label={item.label} icon={item.icon} badge={item.badge} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({
  id,
  label,
  icon: Icon,
  badge,
  onNavigate,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={id === "dashboard" ? "/" : `/${id}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-lg border-e-2 border-transparent px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "border-e-primary bg-primary text-primary-foreground shadow-sm"
            : "text-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
          {badge}
        </Badge>
      )}
    </NavLink>
  );
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const { organization, membership, signOut } = useOrganizationAccess();

  const handleSignOut = async () => {
    await signOut();
    navigate("/onboarding", { replace: true });
  };

  return (
    <div dir="rtl" className="flex h-screen w-full overflow-hidden bg-muted/30">
      {/* الشريط الجانبي — سطح المكتب */}
      <aside className="hidden w-64 shrink-0 border-l bg-background md:flex">
        <SidebarContent />
      </aside>

      {/* الشريط الجانبي — الهاتف (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-72 p-0">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>

          <div className="hidden flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 sm:flex">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="بحث عن مريض، موعد، فاتورة..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex-1 sm:hidden" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon">
                <Bell className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>التنبيهات</TooltipContent>
          </Tooltip>

          <Link to="/operations-settings">
            <Button variant="ghost" size="icon">
              <Settings2 className="h-5 w-5" />
            </Button>
          </Link>

          <Separator orientation="vertical" className="h-6" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initialsOf(organization?.name)}</AvatarFallback>
                </Avatar>
                <div className="hidden flex-col items-start leading-tight sm:flex">
                  <span className="text-sm font-medium">{organization?.name ?? "حسابي"}</span>
                  <span className="text-xs text-muted-foreground">{membership?.role_key ?? ""}</span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{organization?.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/operations-settings")}>
                <Settings2 className="h-4 w-4" />
                إعدادات التشغيل
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
