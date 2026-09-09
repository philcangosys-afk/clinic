import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings2,
  Globe2,
  LockKeyhole,
  UserRound,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import NotificationBell from "./NotificationBell";
import SectionGuideButton from "./SectionGuideButton";
import { guideKeyForPath } from "@/lib/section-guides";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { PatientSearchScopeChips } from "@/components/shared/PatientSearchInput";
import {
  buildPatientSearchOr,
  patientSearchPlaceholder,
  PATIENT_DIRECTORY_SEARCH_COLUMNS,
  type PatientSearchScope,
} from "@/lib/patient-search";
import { useLiveBadgeCounts, formatBadgeNumber } from "@/hooks/use-live-badges";
import { demoRoleAllowsModule, demoRoleLabel } from "@/lib/demo-role";
import { useDemoRole } from "@/contexts/DemoRoleContext";
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

function initialsOf(name: string | undefined | null) {
  if (!name) return "؟";
  const trimmed = name.trim();
  return trimmed.length ? trimmed[0] : "؟";
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { canAccess, organization, branch, session } = useOrganizationAccess();
  const location = useLocation();
  const liveBadges = useLiveBadgeCounts(organization?.id, session?.user.id);

  const { role } = useDemoRole();

  const groups = useMemo(() => {
    // الصفة تُخفي ما لا يخصّها من القائمة. هذا ترشيح عرضٍ لا حماية: المنع
    // الحقيقي في RLS وفي فحوص الدوالّ، وهو قائم بصرف النظر عن هذا السطر.
    const accessible = filterAccessibleModules(moduleRegistry, canAccess).filter((item) =>
      demoRoleAllowsModule(role, item.id),
    );
    const withLiveBadges: ModuleRegistryItem[] = accessible.map((item) => {
      const live = liveBadges.data?.[item.id];
      if (live === null || live === undefined) return item;
      return { ...item, badge: formatBadgeNumber(live) };
    });
    return groupModules(withLiveBadges);
  }, [canAccess, liveBadges.data, role]);

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
    <div dir="rtl" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-4 py-4.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground text-base font-extrabold shadow-sm shadow-primary/20">
          ز
        </div>
        <div className="flex min-w-0 flex-col text-start leading-tight">
          <span className="truncate text-[15px] font-bold">{organization?.name ?? "المركز الطبي"}</span>
          <span className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{branch?.name ?? "المنشأة الرئيسية"}</span>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-3 py-3">
        <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-1.5">
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
      <div className="border-t border-sidebar-border p-3">
        <Link
          to="/booking/asnan-premium"
          target="_blank"
          rel="noreferrer"
          onClick={onNavigate}
          className="flex min-h-12 flex-row-reverse items-center gap-3 rounded-md border border-emerald-700 bg-emerald-600 px-3 py-2.5 font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-end">الموقع الإلكتروني</span>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-white/15">
            <Globe2 className="h-4 w-4" />
          </span>
        </Link>
      </div>
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
        className={cn(
          "group flex w-full flex-row-reverse items-center gap-2.5 rounded-md border px-3 py-2.5 text-start transition-all duration-200",
          isOpen
            ? "border-blue-700 bg-blue-600 text-white"
            : "border-blue-600/70 bg-blue-500 text-white hover:bg-blue-600",
        )}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            !isOpen && "rotate-90",
          )}
        />
        <span className="flex-1 truncate text-end text-[13px] font-bold">
          {section}
        </span>
        {!isOpen && totalBadge > 0 && (
          <span className="rounded-md bg-white/25 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
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
          <div className="flex flex-col gap-1.5 py-2 pe-2 ps-2">
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
          "relative flex min-h-11 flex-row-reverse items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-[14px] font-semibold transition-all duration-200",
          isActive
            ? "border-accent/60 bg-accent/15 text-accent-foreground shadow-sm"
            : "border-border/70 text-foreground/80 hover:border-accent/40 hover:bg-accent/10 hover:text-foreground",
        )
      }
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-current">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate text-end">{label}</span>
      {badge && (
        <Badge variant="secondary" className="min-w-6 justify-center rounded-md px-1.5 py-0.5 text-[11px] tabular-nums">
          {badge}
        </Badge>
      )}
    </NavLink>
  );
}

/**
 * بوّابة الشاشة: هل يجوز لهذا العضو فتح المسار الحالي؟
 *
 * ترشيح القائمة الجانبية يُخفي الشاشة ولا يمنعها: من يكتب `/payroll` في شريط
 * العنوان تُفتح له الشاشة كاملة. القاعدة تحمي البيانات (سياسات الصفوف وفحوص
 * الدوالّ قائمة بصرف النظر عن الواجهة)، لكن شاشةً تُفتح لمن لا يخصّه إمّا تعرض
 * جداول فارغة فيظنّ النظام معطوبًا، وإمّا تكشف تسميات وأعمدة لا شأن له بها.
 * فالمنع يُقال صريحًا هنا.
 *
 * ملفّ المريض يُقاس بصلاحية شاشة المرضى، والشاشة الرئيسية لا تُحجب أبدًا حتى
 * لا يبقى العضو بلا وجهة.
 */
function useCurrentModuleAccess() {
  const location = useLocation();
  const { canAccess } = useOrganizationAccess();
  const { role } = useDemoRole();

  return useMemo(() => {
    const key = guideKeyForPath(location.pathname);
    if (!key || key === "dashboard") return { allowed: true, label: null as string | null };
    const moduleId = key === "patient-profile" ? "patients" : key;
    const item =
      moduleId === settingsModule.id
        ? settingsModule
        : moduleRegistry.find((entry) => entry.id === moduleId);
    // مسار لا يقابله موديول (مثل شاشة غير مسجَّلة) لا يُحجب من هنا.
    if (!item) return { allowed: true, label: null };
    const allowed = canAccess(item.featureKey, item.requiredPermission) && demoRoleAllowsModule(role, item.id);
    return { allowed, label: item.label };
  }, [canAccess, location.pathname, role]);
}

/**
 * بحث الترويسة — موصول ببحث ملفات المرضى.
 *
 * كان المربّع بلا `value` ولا `onChange` ولا `onSubmit`: عنصر واجهة كامل في
 * أعلى كل شاشة لا يفعل شيئًا، ونصّه يوعد ببحث المواعيد والفواتير أيضًا. الآن
 * يبحث فعلًا — في ملفات المرضى وحدها، ونصّه يقول ذلك بدل أن يوعد بما لا يقع.
 *
 * القراءة من `v_patient_directory` لا من `patients`: المنظور يُخفي الهوية
 * والجوال في القاعدة لمن لا يملك `patients.view_identity`، فالإخفاء لا يكون
 * شكليًّا في الواجهة. والمربّع نفسه لا يظهر لمن لا يملك صلاحية شاشة المرضى.
 */
type HeaderSearchResult = {
  id: string;
  name_ar: string;
  file_number: number | null;
  phone_1: string | null;
  mobile_number: string | null;
  id_number: string | null;
};

function HeaderSearch() {
  const navigate = useNavigate();
  const { organization, canAccess } = useOrganizationAccess();
  const allowed = canAccess("patients", "patients.view");
  const [term, setTerm] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [results, setResults] = useState<HeaderSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!allowed || !organization?.id || term.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      const query = supabase
        .from("v_patient_directory")
        .select("id, name_ar, file_number, phone_1, mobile_number, id_number")
        // التقييد بالمنشأة النشطة: RLS يسمح بكل منشأة ينتمي إليها المستخدم.
        .eq("organization_id", organization.id)
        .limit(8);
      // البحث الموحَّد: الاسم والجوال والهوية — والمنظور يُقنِّع ما لا يُصرَّح برؤيته
      const searchFilter = buildPatientSearchOr(term, searchScopes, PATIENT_DIRECTORY_SEARCH_COLUMNS);
      const { data, error: queryError } = await (searchFilter ? query.or(searchFilter) : query);
      // نفيُ وجود المريض عند فشل الاستعلام أخطر من رسالة خطأ: يدفع الموظّف إلى
      // فتح ملفّ ثانٍ لمريض موجود.
      setError(queryError ? queryError.message : null);
      setResults(queryError ? [] : ((data as HeaderSearchResult[]) ?? []));
      setLoading(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [term, searchScopes, organization?.id, allowed]);

  if (!allowed) return <div className="hidden flex-1 sm:block" />;

  const goTo = (id: string) => {
    setTerm("");
    setResults([]);
    setOpen(false);
    navigate(`/patients/${id}`);
  };

  return (
    <div className="relative hidden flex-1 sm:block">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          dir="rtl"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            // Enter يفتح أول نتيجة: الضغط عليه كان بلا أثر إطلاقًا.
            if (event.key === "Enter" && results[0]) goTo(results[0].id);
          }}
          placeholder={patientSearchPlaceholder(searchScopes)}
          className="flex-1 bg-transparent text-start text-sm outline-none placeholder:text-muted-foreground"
        />
        <PatientSearchScopeChips scopes={searchScopes} onScopesChange={setSearchScopes} />
      </div>

      {open && term.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-1 shadow-lg">
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">جارٍ البحث...</p>}
          {error && <p className="px-3 py-2 text-xs text-destructive">تعذّر البحث: {error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">لا مريض مطابق.</p>
          )}
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => goTo(row.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <span className="truncate">{row.name_ar}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                #{row.file_number ?? "—"} · {row.phone_1 ?? "—"}
              </span>
            </button>
          ))}
          <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            البحث يغطّي ملفات المرضى فقط في هذه المرحلة — المواعيد والفواتير من شاشتيهما.
          </p>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const { organization, membership, signOut } = useOrganizationAccess();
  const { role, name, clear } = useDemoRole();
  const moduleAccess = useCurrentModuleAccess();

  const handleSignOut = async () => {
    await signOut();
    navigate("/onboarding", { replace: true });
  };

  // «تسجيل الخروج» في وضع المعاينة يعني العودة لاختيار الصفة، لا إنهاء
  // الجلسة: الجلسة واحدة، والصفة هي ما يتبدّل.
  const handleExitRole = () => {
    clear();
    navigate("/", { replace: true });
  };

  return (
    <div dir="rtl" className="flex h-screen w-full overflow-hidden bg-muted/30 text-start">
      {/* الشريط الجانبي — سطح المكتب */}
      <aside className="hidden w-72 shrink-0 border-s border-sidebar-border bg-background shadow-sm md:flex">
        <SidebarContent />
      </aside>

      {/* الشريط الجانبي — الهاتف (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-72 p-0">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header dir="rtl" className="flex items-center gap-3 border-b bg-background px-4 py-3 shadow-sm">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>

          <HeaderSearch />
          <div className="flex-1 sm:hidden" />

          {role && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5">
              <UserRound className="h-4 w-4 shrink-0 text-primary" />
              <span className="hidden text-sm font-semibold sm:inline">{demoRoleLabel(role)}</span>
              {name && <span className="hidden text-xs text-muted-foreground sm:inline">· {name}</span>}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleExitRole}
              >
                <LogOut className="h-3.5 w-3.5" />
                خروج
              </Button>
            </div>
          )}

          <NotificationBell />

          <Link to="/operations-settings">
            <Button variant="ghost" size="icon">
              <Settings2 className="h-5 w-5" />
            </Button>
          </Link>

          <Separator orientation="vertical" className="h-6" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-1.5 text-start transition-colors hover:border-border hover:bg-muted">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initialsOf(organization?.name)}</AvatarFallback>
                </Avatar>
                <div className="hidden flex-col items-start text-start leading-tight sm:flex">
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
              {role && (
                <DropdownMenuItem onSelect={handleExitRole}>
                  <UserRound className="h-4 w-4" />
                  تبديل الصفة
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main dir="rtl" className="flex-1 overflow-y-auto text-start">
          {moduleAccess.allowed ? (
            <Outlet />
          ) : (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
              <LockKeyhole className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-bold">لا تملك صلاحية فتح هذه الشاشة</h2>
              <p className="text-sm text-muted-foreground">
                {moduleAccess.label
                  ? `شاشة «${moduleAccess.label}» غير متاحة لصفتك الحالية.`
                  : "هذه الشاشة غير متاحة لصفتك الحالية."}{" "}
                راجع مدير المنشأة إن كنت تحتاجها في عملك.
              </p>
              <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
                العودة إلى الرئيسية
              </Button>
            </div>
          )}
        </main>
      </div>

      {/* زرّ «شرح القسم» — مرّة واحدة هنا فيظهر في كل الشاشات، ويقرأ نصّه من
          المسار الحالي. لو وُضع في كل صفحة على حدة لنُسي في الصفحات الجديدة. */}
      <SectionGuideButton />
    </div>
  );
}
