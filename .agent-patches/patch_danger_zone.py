# -*- coding: utf-8 -*-
"""تبويب «منطقة الخطر» في إعدادات المنشأة.

**لماذا هنا لا في شاشتَي المرضى والخدمات؟** زرُّ حذفٍ جماعيّ في شريط أدوات
شاشةٍ تُفتح كل يوم يُضغط خطأً يومًا ما — وهذا الخطأ لا يُشبه غيره: لا تراجع
عنه إلّا من نسخةٍ احتياطية. وموضعه الصحيح صفحةُ إعداداتٍ لا يدخلها إلّا صاحب
المنشأة، تحت عنوانٍ يقول ما هو قبل أن يُفتح.
"""
import sys

PATH = "client/pages/OrganizationSettings.tsx"

raw = open(PATH, "rb").read()
NL = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")


def must(old, new, label):
    global src
    if src.count(old) != 1:
        sys.exit("ANCHOR %s: count=%d" % (label, src.count(old)))
    src = src.replace(old, new, 1)


must(
    'import { errorMessage } from "@/lib/error-message";',
    'import { errorMessage } from "@/lib/error-message";\n'
    'import DangerZoneTab from "@/components/settings/DangerZoneTab";',
    "import",
)

must(
    """          <TabsTrigger value="branches">الفروع</TabsTrigger>
        </TabsList>""",
    """          <TabsTrigger value="branches">الفروع</TabsTrigger>
          {/* لصاحب المنشأة ومسؤولها وحدهما — والقاعدة تفرض ذلك أيضًا، فإخفاء
              التبويب راحةٌ للعين لا حراسة. */}
          {isAdmin && (
            <TabsTrigger value="danger" className="text-destructive">
              منطقة الخطر
            </TabsTrigger>
          )}
        </TabsList>""",
    "trigger",
)

must(
    """        <TabsContent value="branches">
          <BranchesTab readOnly={!isAdmin} />
        </TabsContent>""",
    """        <TabsContent value="branches">
          <BranchesTab readOnly={!isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="danger">
            <DangerZoneTab />
          </TabsContent>
        )}""",
    "content",
)

open(PATH, "wb").write(src.replace("\n", NL).encode("utf-8"))
print("OrganizationSettings.tsx: 3 edits applied, NL=%r" % NL)
