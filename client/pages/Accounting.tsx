import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  AccountBalanceView,
  AccountType,
  ChartOfAccountRow,
  JournalEntryRow,
  TrialBalanceView,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

export default function Accounting() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المحاسبة ودليل الحسابات</h1>
        <p className="text-sm text-muted-foreground">دفتر أستاذ عام بقيود مزدوجة مصاحب — لا يُعدِّل الفوترة أو السندات الموجودة</p>
      </div>

      <Tabs defaultValue="chart">
        <TabsList>
          <TabsTrigger value="chart">دليل الحسابات</TabsTrigger>
          <TabsTrigger value="entries">القيود اليومية</TabsTrigger>
          <TabsTrigger value="trial-balance">ميزان المراجعة</TabsTrigger>
        </TabsList>
        <TabsContent value="chart" className="mt-4">
          <ChartOfAccountsTab />
        </TabsContent>
        <TabsContent value="entries" className="mt-4">
          <JournalEntriesTab />
        </TabsContent>
        <TabsContent value="trial-balance" className="mt-4">
          <TrialBalanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// دليل الحسابات
// ---------------------------------------------------------------------------
function useChartOfAccounts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["chart-of-accounts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name_ar, account_type, is_active")
        .eq("organization_id", organizationId)
        .order("code");
      if (error) throw error;
      return (data ?? []) as ChartOfAccountRow[];
    },
  });
}

function ChartOfAccountsTab() {
  const { organization } = useOrganizationAccess();
  const accounts = useChartOfAccounts(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const seedDefaults = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.rpc("app_seed_default_chart_of_accounts", {
        target_organization_id: organization.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts", organization?.id] });
      toast({ title: "تم زرع دليل الحسابات الافتراضي" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الزرع",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>دليل الحسابات</CardTitle>
          <CardDescription>شجرة الحسابات المستخدمة في القيود اليومية — أصول، خصوم، حقوق ملكية، إيرادات، مصروفات</CardDescription>
        </div>
        <div className="flex gap-2">
          {(accounts.data ?? []).length === 0 && !accounts.isLoading && (
            <Button size="sm" variant="outline" disabled={seedDefaults.isPending} onClick={() => seedDefaults.mutate()}>
              <Sparkles className="h-4 w-4" />
              زرع دليل حسابات افتراضي
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            حساب جديد
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {accounts.isLoading && <Skeleton className="h-40 w-full" />}
        {!accounts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(accounts.data ?? []).map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-mono text-xs">{account.code}</TableCell>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    {account.name_ar}
                  </TableCell>
                  <TableCell>{ACCOUNT_TYPE_LABELS[account.account_type]}</TableCell>
                  <TableCell>
                    <Badge variant={account.is_active ? "success" : "secondary"}>{account.is_active ? "نشط" : "معطّل"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(accounts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد حسابات بعد — استخدم "زرع دليل حسابات افتراضي" للبدء بسرعة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewAccountDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewAccountDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");

  const createAccount = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("chart_of_accounts").insert({
        organization_id: organizationId,
        code: code.trim(),
        name_ar: nameAr.trim(),
        account_type: accountType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts", organizationId] });
      toast({ title: "تم حفظ الحساب" });
      setCode("");
      setNameAr("");
      setAccountType("asset");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حساب جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الكود *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1400" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!code.trim() || !nameAr.trim() || createAccount.isPending} onClick={() => createAccount.mutate()}>
            {createAccount.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// القيود اليومية
// ---------------------------------------------------------------------------
function useJournalEntries(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["journal-entries", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, entry_number, entry_date, description, status, reference_type")
        .eq("organization_id", organizationId)
        .order("entry_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as JournalEntryRow[];
    },
  });
}

function JournalEntriesTab() {
  const { organization } = useOrganizationAccess();
  const entries = useJournalEntries(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const postEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.from("journal_entries").update({ status: "posted" }).eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["account-balances", organization?.id] });
      toast({ title: "تم ترحيل القيد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الترحيل",
        description: error instanceof Error ? error.message : "القيد غير متوازن — تحقّق من إجمالي المدين والدائن",
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>القيود اليومية</CardTitle>
          <CardDescription>الترحيل (Post) يرفضه النظام تلقائيًا إن لم يتساوَ إجمالي المدين والدائن</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          قيد جديد
        </Button>
      </CardHeader>
      <CardContent>
        {entries.isLoading && <Skeleton className="h-40 w-full" />}
        {!entries.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries.data ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">#{entry.entry_number}</TableCell>
                  <TableCell>{entry.entry_date}</TableCell>
                  <TableCell>{entry.description ?? "—"}</TableCell>
                  <TableCell>
                    {entry.reference_type === "manual" ? (
                      <span className="text-xs text-muted-foreground">يدوي</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        تلقائي —{" "}
                        {entry.reference_type === "sales_invoice"
                          ? "فاتورة مبيعات"
                          : entry.reference_type === "purchase_invoice"
                            ? "فاتورة شراء"
                            : entry.reference_type === "financial_voucher"
                              ? "سند"
                              : entry.reference_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.status === "posted" ? "success" : entry.status === "void" ? "destructive" : "secondary"}>
                      {entry.status === "posted" ? "مُرحَّل" : entry.status === "void" ? "ملغي" : "مسودة"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.status === "draft" && (
                      <Button size="sm" variant="outline" disabled={postEntry.isPending} onClick={() => postEntry.mutate(entry.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        ترحيل
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(entries.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد قيود يومية بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewJournalEntryDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewJournalEntryDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const accounts = useChartOfAccounts(organizationId);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);

  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = totalDebit > 0 && totalDebit === totalCredit;

  const createEntry = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const validLines = lines.filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0));
      if (validLines.length < 2) throw new Error("القيد يحتاج سطرين على الأقل");

      const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .insert({ organization_id: organizationId, description: description.trim() || null })
        .select("id")
        .single();
      if (entryError) throw entryError;

      const { error: linesError } = await supabase.from("journal_entry_lines").insert(
        validLines.map((line) => ({
          journal_entry_id: entry.id,
          account_id: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        })),
      );
      if (linesError) throw linesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries", organizationId] });
      toast({ title: "تم حفظ القيد كمسودة — رحّله بعد التأكد من توازنه" });
      setDescription("");
      setLines([
        { accountId: "", debit: "", credit: "" },
        { accountId: "", debit: "", credit: "" },
      ]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>قيد يومية جديد</DialogTitle>
          <DialogDescription>يُحفَظ كمسودة قابلة للتعديل، ولن يُقبَل ترحيله لاحقًا إلا إذا تساوى إجمالي المدين والدائن</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الوصف</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={line.accountId}
                onValueChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, accountId: v } : l)))}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="اختر حسابًا" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} — {account.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                className="w-28"
                placeholder="مدين"
                value={line.debit}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, debit: e.target.value, credit: "" } : l)))}
              />
              <Input
                type="number"
                min={0}
                className="w-28"
                placeholder="دائن"
                value={line.credit}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, credit: e.target.value, debit: "" } : l)))}
              />
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }])}>
            <Plus className="h-4 w-4" />
            إضافة سطر
          </Button>

          <div className={`flex items-center justify-between rounded-md border p-2 text-sm ${isBalanced ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            <span>إجمالي المدين: {totalDebit.toLocaleString("ar-SA")}</span>
            <span>إجمالي الدائن: {totalCredit.toLocaleString("ar-SA")}</span>
            <Badge variant={isBalanced ? "success" : "warning"}>{isBalanced ? "متوازن" : "غير متوازن"}</Badge>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={createEntry.isPending} onClick={() => createEntry.mutate()}>
            {createEntry.isPending ? "جارٍ الحفظ..." : "حفظ كمسودة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------------------
function useAccountBalances(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["account-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances").select("*").eq("organization_id", organizationId).order("code");
      if (error) throw error;
      return (data ?? []) as AccountBalanceView[];
    },
  });
}

function useTrialBalance(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["trial-balance", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_trial_balance").select("*").eq("organization_id", organizationId).maybeSingle();
      if (error) throw error;
      return data as TrialBalanceView | null;
    },
  });
}

function TrialBalanceTab() {
  const { organization } = useOrganizationAccess();
  const balances = useAccountBalances(organization?.id);
  const trialBalance = useTrialBalance(organization?.id);
  const isBalanced =
    trialBalance.data && Number(trialBalance.data.grand_total_debit) === Number(trialBalance.data.grand_total_credit);

  return (
    <div className="flex flex-col gap-4">
      {trialBalance.data && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <span className="text-sm text-muted-foreground">إجمالي المدين: {Number(trialBalance.data.grand_total_debit).toLocaleString("ar-SA")}</span>
            <span className="text-sm text-muted-foreground">إجمالي الدائن: {Number(trialBalance.data.grand_total_credit).toLocaleString("ar-SA")}</span>
            <Badge variant={isBalanced ? "success" : "destructive"}>{isBalanced ? "الميزان متوازن" : "الميزان غير متوازن!"}</Badge>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>أرصدة الحسابات</CardTitle>
          <CardDescription>من القيود المُرحَّلة (posted) فقط — القيود بحالة مسودة لا تُحسَب</CardDescription>
        </CardHeader>
        <CardContent>
          {balances.isLoading && <Skeleton className="h-40 w-full" />}
          {!balances.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الرصيد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(balances.data ?? []).map((account) => (
                  <TableRow key={account.account_id}>
                    <TableCell className="font-mono text-xs">{account.code}</TableCell>
                    <TableCell>{account.name_ar}</TableCell>
                    <TableCell>{ACCOUNT_TYPE_LABELS[account.account_type]}</TableCell>
                    <TableCell className={Number(account.balance) < 0 ? "text-destructive" : ""}>
                      {Number(account.balance).toLocaleString("ar-SA")} ر.س
                    </TableCell>
                  </TableRow>
                ))}
                {(balances.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد حسابات بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
