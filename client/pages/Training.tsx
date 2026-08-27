import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus, Check } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { EmployeeTrainingSummaryView, TrainingProgramRow } from "@/lib/database.types";
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

function usePrograms(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["training-programs", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_programs")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as TrainingProgramRow[]) ?? [];
    },
  });
}

function useEmployeesList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["employees-simple", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("name_ar");
      if (error) throw error;
      return (data as { id: string; name_ar: string }[]) ?? [];
    },
  });
}

function useEnrollments(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["training-enrollments", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_enrollments")
        .select("*, employees(name_ar), training_programs(name_ar, hours)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useTrainingSummary(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["training-summary", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_employee_training_summary")
        .select("*")
        .eq("organization_id", organizationId)
        .order("total_completed_hours", { ascending: false });
      if (error) throw error;
      return (data as EmployeeTrainingSummaryView[]) ?? [];
    },
  });
}

function ProgramsTab({ organizationId }: { organizationId: string | undefined }) {
  const programs = usePrograms(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hours, setHours] = useState("0");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !name.trim()) throw new Error("اسم البرنامج مطلوب");
      const { error } = await supabase.from("training_programs").insert({
        organization_id: organizationId,
        name_ar: name.trim(),
        hours: Number(hours) || 0,
        description: description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-programs", organizationId] });
      toast({ title: "تم إنشاء البرنامج" });
      setOpen(false);
      setName("");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">برامج التدريب</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> برنامج جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>برنامج تدريب جديد</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>الاسم</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>عدد الساعات</Label>
                <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
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
              <TableHead>الاسم</TableHead>
              <TableHead>الساعات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(programs.data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name_ar}</TableCell>
                <TableCell>{p.hours}</TableCell>
              </TableRow>
            ))}
            {(programs.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد برامج تدريب بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EnrollmentsTab({ organizationId }: { organizationId: string | undefined }) {
  const enrollments = useEnrollments(organizationId);
  const programs = usePrograms(organizationId);
  const employees = useEmployeesList(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["training-enrollments", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["training-summary", organizationId] });
  };

  const enroll = useMutation({
    mutationFn: async () => {
      if (!organizationId || !programId || !employeeId) throw new Error("اختر البرنامج والموظف");
      const { error } = await supabase.from("training_enrollments").insert({
        organization_id: organizationId,
        program_id: programId,
        employee_id: employeeId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تسجيل الموظف في البرنامج" });
      setOpen(false);
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const markCompleted = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("training_enrollments").update({ status: "completed" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تسجيل الإتمام" });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">تسجيلات التدريب</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="ms-1 h-4 w-4" /> تسجيل جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تسجيل موظف في برنامج</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>البرنامج</Label>
                <Select value={programId} onValueChange={setProgramId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر برنامجًا" />
                  </SelectTrigger>
                  <SelectContent>
                    {(programs.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الموظف</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر موظفًا" />
                  </SelectTrigger>
                  <SelectContent>
                    {(employees.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => enroll.mutate()} disabled={enroll.isPending}>
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
              <TableHead>الموظف</TableHead>
              <TableHead>البرنامج</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(enrollments.data ?? []).map((e: any) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.employees?.name_ar ?? "—"}</TableCell>
                <TableCell>{e.training_programs?.name_ar ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={e.status === "completed" ? "success" : e.status === "cancelled" ? "destructive" : "secondary"}>
                    {e.status === "completed" ? "مكتمل" : e.status === "cancelled" ? "ملغى" : "مُسجَّل"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {e.status === "enrolled" && (
                    <Button size="sm" variant="outline" onClick={() => markCompleted.mutate(e.id)}>
                      <Check className="ms-1 h-3.5 w-3.5" /> تسجيل إتمام
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(enrollments.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد تسجيلات تدريب بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SummaryTab({ organizationId }: { organizationId: string | undefined }) {
  const summary = useTrainingSummary(organizationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ملخص التدريب لكل موظف</CardTitle>
        <CardDescription>عرض مباشر — لا حاجة لأي مزامنة</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>برامج مكتملة</TableHead>
              <TableHead>برامج قيد التنفيذ</TableHead>
              <TableHead>إجمالي الساعات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(summary.data ?? []).map((s) => (
              <TableRow key={s.employee_id}>
                <TableCell className="font-medium">{s.employee_name}</TableCell>
                <TableCell>{s.completed_programs}</TableCell>
                <TableCell>{s.in_progress_programs}</TableCell>
                <TableCell>{s.total_completed_hours}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Training() {
  const { organization } = useOrganizationAccess();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <GraduationCap className="h-6 w-6" /> التدريب والتطوير
        </h1>
        <p className="text-sm text-muted-foreground">برامج تدريب وتسجيلات الموظفين بها حتى الإتمام</p>
      </div>
      <Tabs defaultValue="enrollments">
        <TabsList>
          <TabsTrigger value="programs">البرامج</TabsTrigger>
          <TabsTrigger value="enrollments">التسجيلات</TabsTrigger>
          <TabsTrigger value="summary">الملخص</TabsTrigger>
        </TabsList>
        <TabsContent value="programs" className="mt-4">
          <ProgramsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="enrollments" className="mt-4">
          <EnrollmentsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <SummaryTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
