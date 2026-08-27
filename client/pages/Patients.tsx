import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search, UserRound } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { PatientRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import NewPatientDialog from "@/components/patients/NewPatientDialog";

function usePatientsList(organizationId: string | undefined, search: string) {
  return useQuery({
    queryKey: ["patients-list", organizationId, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("patients")
        .select("id, file_number, name_ar, name_en, mobile_number, gender, block_appointments, block_invoices, insurance_company_name")
        .order("created_at", { ascending: false })
        .limit(50);
      const term = search.trim();
      if (term) {
        const isNumeric = /^\d+$/.test(term);
        query = isNumeric
          ? query.or(`mobile_number.ilike.%${term}%,file_number.eq.${term}`)
          : query.ilike("name_ar", `%${term}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Pick<
        PatientRow,
        "id" | "file_number" | "name_ar" | "name_en" | "mobile_number" | "gender" | "block_appointments" | "block_invoices" | "insurance_company_name"
      >[];
    },
  });
}

export default function Patients() {
  const { organization } = useOrganizationAccess();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const patients = usePatientsList(organization?.id, search);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المرضى</h1>
          <p className="text-sm text-muted-foreground">بحث وفتح ملفات المرضى</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          مريض جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالاسم أو رقم الجوال أو رقم الملف..."
              className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <CardDescription>آخر 50 ملف مطابق — اكتب للبحث في القاعدة كاملة</CardDescription>
        </CardHeader>
        <CardContent>
          {patients.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!patients.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>الجنس</TableHead>
                  <TableHead>التأمين</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(patients.data ?? []).map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell className="font-mono text-xs">#{patient.file_number}</TableCell>
                    <TableCell className="font-medium">{patient.name_ar}</TableCell>
                    <TableCell>{patient.mobile_number ?? "—"}</TableCell>
                    <TableCell>{patient.gender === "male" ? "ذكر" : patient.gender === "female" ? "أنثى" : "—"}</TableCell>
                    <TableCell>{patient.insurance_company_name ?? "نقدي"}</TableCell>
                    <TableCell>
                      {(patient.block_appointments || patient.block_invoices) ? (
                        <Badge variant="destructive">محجوب جزئيًا</Badge>
                      ) : (
                        <Badge variant="success">نشط</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/patients/${patient.id}`}>
                          <UserRound className="h-3.5 w-3.5" />
                          فتح الملف
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(patients.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد نتائج مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewPatientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
