import { cn } from "@/lib/utils";

/**
 * تخطيط الشجرة والشبكة — لوحان: شجرة الفئات على اليمين، والمحتوى على اليسار.
 *
 * **لماذا شجرة لا قائمة منسدلة:** الكتالوج عند المالك بمئات الأصناف موزّعة على
 * فئات رئيسية وفرعية. القائمة المنسدلة تُظهر فئةً واحدة في كل لحظة وتُخفي
 * البنية، فلا يعرف الموظّف أنّ للفئة فروعًا ولا كم صنفًا فيها. الشجرة تُبقي
 * البنية كلّها معروضة، والانتقال بين فئتين ضغطةٌ واحدة لا ثلاث.
 *
 * اللوحان مستقلّان في التمرير: تصفّح مئة صنف لا يُخفي الشجرة، وتصفّح الفئات
 * لا يُحرّك الشبكة.
 */
export function TreeGridLayout({
  tree,
  treeTitle,
  children,
  className,
  treeClassName,
}: {
  /** لوح الشجرة — يُعرض على اليمين في RTL */
  tree: React.ReactNode;
  treeTitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  treeClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row-reverse lg:items-start", className)}>
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col rounded-md border bg-card lg:sticky lg:top-2 lg:max-h-[calc(100vh-8rem)] lg:w-64",
          treeClassName,
        )}
      >
        {treeTitle && (
          <div className="shrink-0 border-b px-3 py-2 text-sm font-semibold">{treeTitle}</div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{tree}</div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
