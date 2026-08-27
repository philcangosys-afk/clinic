import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { CandidateRow, CandidateStatus, JobPostingRow, RecruitmentPipelineView } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_LABELS: Record<CandidateStatus, string> = {
  applied: "تقديم",
  screening: "فحص أولي",
  interview: "مقابلة",
  offer: "عرض",
  hired: "تم التوظيف",
  rejected: "مرفوض",
};
const STATUS_ORDER: CandidateStatus[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

function useJobPostings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["job-postings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_postings")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as JobPostingRow[]) ?? [];
    },
  });
}

function useCandidates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["candidates", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("*, job_postings(title_ar)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function usePipeline(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["recruitment-pipeline", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recruitment_pipeline")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data as RecruitmentPipelineView[]) ?? [];
    },
  });
}

function JobPostingsTab({ organizationId }: { organizationId: string | undefined }) {
  const postings = useJobPostings(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !title.trim()) throw new Error("عنوان الوظيفة مطلوب");
      const { error } = await supabase.from("job_postings").insert({
        organization_id: organizationId,
        title_ar: title.trim(),
        description: description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-postings", organizationId] });
      toast({ title: "تم إنشاء الوظيفة الشاغرة" });
      setOpen(false);
      setTitle("");
      setDescription("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("job_postings").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-postings", organizationId] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">الوظائف الشاغرة</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> وظيفة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>وظيفة شاغرة جديدة</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>العنوان</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ممرض / استقبال..." />
              </div>
              <div>
                <Label>الوصف (اختياري)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>العنوان</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(postings.data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.title_ar}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "open" ? "success" : p.status === "closed" ? "destructive" : "secondary"}>
                    {p.status === "open" ? "مفتوحة" : p.status === "closed" ? "مغلقة" : "معلَّقة"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Select value={p.status} onValueChange={(v) => toggleStatus.mutate({ id: p.id, status: v })}>
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">مفتوحة</SelectItem>
                      <SelectItem value="on_hold">معلَّقة</SelectItem>
                      <SelectItem value="closed">مغلقة</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
            {(postings.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد وظائف شاغرة بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CandidatesTab({ organizationId }: { organizationId: string | undefined }) {
  const candidates = useCandidates(organizationId);
  const postings = useJobPostings(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [jobPostingId, setJobPostingId] = useState("");
  const [interviewsFor, setInterviewsFor] = useState<{ id: string; name_ar: string } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !name.trim()) throw new Error("اسم المرشح مطلوب");
      const { error } = await supabase.from("candidates").insert({
        organization_id: organizationId,
        name_ar: name.trim(),
        mobile: mobile.trim() || null,
        email: email.trim() || null,
        source: source.trim() || null,
        job_posting_id: jobPostingId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates", organizationId] });
      toast({ title: "تم إضافة المرشح" });
      setOpen(false);
      setName("");
      setMobile("");
      setEmail("");
      setSource("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const moveStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CandidateStatus }) => {
      const { error } = await supabase.from("candidates").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["candidates", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["recruitment-pipeline", organizationId] });
      if (vars.status === "hired") {
        queryClient.invalidateQueries({ queryKey: ["employees-simple", organizationId] });
        toast({ title: "تم التوظيف — أُنشئ سجل موظف تلقائيًا" });
      } else {
        toast({ title: "تم تحديث حالة المرشح" });
      }
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">المرشحون</CardTitle>
          <CardDescription>تحويل مرشح لحالة "تم التوظيف" يُنشئ سجل موظف جديد تلقائيًا مرتبطًا به — بلا إعادة كتابة بياناته</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> مرشح جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>مرشح جديد</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>الاسم</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>الجوال</Label>
                <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div>
                <Label>البريد الإلكتروني</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>مصدر الترشيح</Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="توصية، موقع توظيف، ..." />
              </div>
              <div>
                <Label>الوظيفة المتقدَّم لها (اختياري)</Label>
                <Select value={jobPostingId} onValueChange={setJobPostingId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر وظيفة" />
                  </SelectTrigger>
                  <SelectContent>
                    {(postings.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الوظيفة</TableHead>
              <TableHead>الجوال</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(candidates.data ?? []).map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name_ar}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.job_postings?.title_ar ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.mobile ?? "—"}</TableCell>
                <TableCell>
                  <Select
                    value={c.status}
                    onValueChange={(v) => moveStatus.mutate({ id: c.id, status: v as CandidateStatus })}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setInterviewsFor({ id: c.id, name_ar: c.name_ar })}>
                    المقابلات
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(candidates.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  لا يوجد مرشحون بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <CandidateInterviewsDialog
        candidate={interviewsFor}
        onOpenChange={() => setInterviewsFor(null)}
        organizationId={organizationId}
      />
    </Card>
  );
}

const INTERVIEW_STAGE_LABELS: Record<string, string> = { phone_screen: "فحص هاتفي", technical: "فنية", final: "نهائية" };
const INTERVIEW_OUTCOME_LABELS: Record<string, string> = { pending: "قيد الانتظار", passed: "نجح", failed: "لم ينجح" };

function CandidateInterviewsDialog({
  candidate,
  onOpenChange,
  organizationId,
}: {
  candidate: { id: string; name_ar: string } | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [stage, setStage] = useState("phone_screen");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [notes, setNotes] = useState("");

  const interviews = useQuery({
    queryKey: ["candidate-interviews", candidate?.id],
    enabled: Boolean(candidate?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_interviews")
        .select("*")
        .eq("candidate_id", candidate!.id)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["candidate-interviews", candidate?.id] });

  const createInterview = useMutation({
    mutationFn: async () => {
      if (!organizationId || !candidate) throw new Error("بيانات غير مكتملة");
      const { error } = await supabase.from("candidate_interviews").insert({
        organization_id: organizationId,
        candidate_id: candidate.id,
        stage,
        scheduled_at: scheduledAt || null,
        interviewer_name: interviewerName.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم جدولة المقابلة" });
      setScheduledAt("");
      setInterviewerName("");
      setNotes("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const setOutcome = useMutation({
    mutationFn: async ({ id, outcome }: { id: string; outcome: string }) => {
      const { error } = await supabase.from("candidate_interviews").update({ outcome }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return (
    <Dialog open={Boolean(candidate)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>مقابلات — {candidate?.name_ar}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {(interviews.data ?? []).map((iv: any) => (
            <div key={iv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {INTERVIEW_STAGE_LABELS[iv.stage] ?? iv.stage}
                  {iv.interviewer_name && ` · ${iv.interviewer_name}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString("ar-SA") : "بلا موعد محدد"}
                  {iv.notes && ` · ${iv.notes}`}
                </p>
              </div>
              <Select value={iv.outcome} onValueChange={(v) => setOutcome.mutate({ id: iv.id, outcome: v })}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVIEW_OUTCOME_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {(interviews.data ?? []).length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">لا توجد مقابلات مجدولة بعد.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <div className="flex flex-col gap-1.5">
            <Label>المرحلة</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INTERVIEW_STAGE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الموعد</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم المُقابِل</Label>
            <Input value={interviewerName} onChange={(e) => setInterviewerName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={createInterview.isPending} onClick={() => createInterview.mutate()}>
            {createInterview.isPending ? "جارٍ الحفظ..." : "جدولة مقابلة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PipelineTab({ organizationId }: { organizationId: string | undefined }) {
  const pipeline = usePipeline(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">مسار التوظيف</CardTitle>
        <CardDescription>عدد المرشحين في كل مرحلة لكل وظيفة شاغرة</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الوظيفة</TableHead>
              <TableHead>تقديم</TableHead>
              <TableHead>فحص أولي</TableHead>
              <TableHead>مقابلة</TableHead>
              <TableHead>عرض</TableHead>
              <TableHead>تم التوظيف</TableHead>
              <TableHead>مرفوض</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(pipeline.data ?? []).map((row) => (
              <TableRow key={row.job_posting_id}>
                <TableCell className="font-medium">{row.job_title}</TableCell>
                <TableCell>{row.applied_count}</TableCell>
                <TableCell>{row.screening_count}</TableCell>
                <TableCell>{row.interview_count}</TableCell>
                <TableCell>{row.offer_count}</TableCell>
                <TableCell className="text-emerald-600">{row.hired_count}</TableCell>
                <TableCell className="text-destructive">{row.rejected_count}</TableCell>
              </TableRow>
            ))}
            {(pipeline.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد بيانات بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Recruitment() {
  const { organization } = useOrganizationAccess();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UserPlus className="h-6 w-6" /> التوظيف
        </h1>
        <p className="text-sm text-muted-foreground">وظائف شاغرة ← مرشحون ← مراحل اختيار حتى قرار التوظيف النهائي</p>
      </div>
      <Tabs defaultValue="candidates">
        <TabsList>
          <TabsTrigger value="postings">الوظائف الشاغرة</TabsTrigger>
          <TabsTrigger value="candidates">المرشحون</TabsTrigger>
          <TabsTrigger value="pipeline">مسار التوظيف</TabsTrigger>
        </TabsList>
        <TabsContent value="postings" className="mt-4">
          <JobPostingsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="candidates" className="mt-4">
          <CandidatesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4">
          <PipelineTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
