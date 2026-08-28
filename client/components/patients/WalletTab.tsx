import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Plus, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  PatientWalletRow,
  PatientWalletTransactionRow,
  WalletTransactionType,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * محفظة المريض (لقطة 131).
 *
 * الجدولان `patient_wallets` و `patient_wallet_transactions` موجودان منذ
 * 0001/0003 ومعهما مُحفِّز يحدّث الرصيد تلقائيًا عند كل حركة — لكن لم توجد
 * أي واجهة تستدعيهما، فبقيت الميزة معطّلة بالكامل.
 *
 * الرصيد هنا للعرض فقط ولا يُكتب مباشرة: كل تغيير يمرّ عبر حركة مسجَّلة
 * في سجل الحركات، والمُحفِّز في قاعدة البيانات هو من يحدّث الرصيد. هذا
 * يضمن أن الرصيد دائمًا مطابق لمجموع حركاته ولا يمكن تعديله بلا أثر.
 */
const TX_LABELS: Record<WalletTransactionType, string> = {
  top_up: "إيداع",
  deduction: "خصم",
  refund: "استرجاع",
  adjustment: "تسوية",
};

const TX_BADGE: Record<WalletTransactionType, "success" | "destructive" | "default" | "secondary"> = {
  top_up: "success",
  deduction: "destructive",
  refund: "default",
  adjustment: "secondary",
};

/**
 * الحركات التي تزيد الرصيد. هذه القائمة تطابق حرفيًا منطق المُحفِّز
 * `app_apply_wallet_transaction` في 0003: top_up و refund تُضاف، وأي نوع آخر
 * (deduction و adjustment) يُطرح.
 *
 * مهم: المبلغ يُخزَّن **موجبًا دائمًا** — المُحفِّز هو من يضع الإشارة. تخزين
 * قيمة سالبة لحركة خصم يجعل المُحفِّز يحسب ‎-(-x) = +x‎ فيزيد الرصيد بدل أن
 * ينقصه.
 */
const CREDIT_TYPES: WalletTransactionType[] = ["top_up", "refund"];

function isCreditType(type: WalletTransactionType) {
  return CREDIT_TYPES.includes(type);
}

function useWallet(patientId: string) {
  return useQuery({
    queryKey: ["patient-wallet", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_wallets")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PatientWalletRow | null;
    },
  });
}

function useWalletTransactions(patientId: string) {
  return useQuery({
    queryKey: ["patient-wallet-tx", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_wallet_transactions")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PatientWalletTransactionRow[];
    },
  });
}

function NewTransactionDialog({
  open,
  onOpenChange,
  patientId,
  currentBalance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  currentBalance: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization, session } = useOrganizationAccess();
  const [type, setType] = useState<WalletTransactionType>("top_up");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const isCredit = isCreditType(type);
  const numericAmount = Number(amount);
  const willOverdraw = !isCredit && numericAmount > currentBalance;

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!amount.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0)
        throw new Error("أدخل مبلغًا صحيحًا أكبر من صفر");
      if (willOverdraw)
        throw new Error(`الرصيد الحالي ${currentBalance.toFixed(2)} لا يكفي لخصم ${numericAmount.toFixed(2)}`);
      // المبلغ موجب دائمًا — المُحفِّز في قاعدة البيانات هو من يطبّق الإشارة
      // حسب نوع الحركة (انظر التعليق أعلى CREDIT_TYPES).
      const { error } = await supabase.from("patient_wallet_transactions").insert({
        organization_id: organization.id,
        patient_id: patientId,
        transaction_type: type,
        amount: numericAmount,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-wallet", patientId] });
      queryClient.invalidateQueries({ queryKey: ["patient-wallet-tx", patientId] });
      toast({ title: "تم تسجيل الحركة" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل الحركة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>حركة محفظة جديدة</DialogTitle>
          <DialogDescription>
            الرصيد الحالي: <strong>{currentBalance.toFixed(2)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع الحركة</Label>
            <Select value={type} onValueChange={(value) => setType(value as WalletTransactionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TX_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {willOverdraw && (
              <p className="text-xs text-destructive">المبلغ يتجاوز الرصيد المتاح</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || willOverdraw}>
            {save.isPending ? "جارٍ الحفظ..." : "تسجيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WalletTab({ patientId }: { patientId: string }) {
  const wallet = useWallet(patientId);
  const transactions = useWalletTransactions(patientId);
  const [dialogOpen, setDialogOpen] = useState(false);

  const balance = Number(wallet.data?.balance ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              رصيد المحفظة
            </CardTitle>
            <CardDescription>الرصيد محسوب من مجموع الحركات المسجَّلة أدناه</CardDescription>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            حركة جديدة
          </Button>
        </CardHeader>
        <CardContent>
          {wallet.isLoading ? (
            <Skeleton className="h-12 w-40" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span
                className={
                  balance < 0
                    ? "text-3xl font-bold text-destructive tabular-nums"
                    : "text-3xl font-bold text-primary tabular-nums"
                }
              >
                {balance.toFixed(2)}
              </span>
              <span className="text-sm text-muted-foreground">ريال</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الحركات</CardTitle>
          <CardDescription>آخر 100 حركة — الأحدث أولًا</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.isLoading && <Skeleton className="h-32 w-full" />}
          {!transactions.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>ملاحظة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transactions.data ?? []).map((row) => {
                  // الاتجاه يُشتق من نوع الحركة لا من إشارة المبلغ، لأن المبلغ
                  // مخزَّن موجبًا دائمًا (المُحفِّز يطبّق الإشارة).
                  const credit = isCreditType(row.transaction_type);
                  const value = Math.abs(Number(row.amount));
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("ar-SA")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TX_BADGE[row.transaction_type]}>
                          {TX_LABELS[row.transaction_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            credit
                              ? "flex items-center gap-1 font-medium text-emerald-700 tabular-nums"
                              : "flex items-center gap-1 font-medium text-destructive tabular-nums"
                          }
                        >
                          {credit ? (
                            <ArrowUpCircle className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownCircle className="h-3.5 w-3.5" />
                          )}
                          {credit ? "+" : "−"}
                          {value.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {row.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(transactions.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد حركات على المحفظة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialogOpen && (
        <NewTransactionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          patientId={patientId}
          currentBalance={balance}
        />
      )}
    </div>
  );
}
