/**
 * تحميل شيفرة الشاشات قبل الضغط عليها.
 *
 * كلّ شاشةٍ حزمةُ شيفرةٍ مستقلّة تُنزَّل أوّل مرّةٍ تُفتح فيها. والتنقّل يجري
 * داخل `startTransition`، فتبقى الشاشة السابقة ظاهرةً إلى أن تصل حزمة الجديدة
 * — فيبدو الضغط على القسم كأنّه لم يفعل شيئًا لحظاتٍ.
 *
 * هنا يُسجَّل لكلّ قسمٍ محمِّلُ حزمته (App.tsx)، ويُستدعى:
 *   * حين يمرّ المؤشّر على رابط القسم أو يُلمس — قبل الضغط بعُشر ثانيةٍ أو أكثر؛
 *   * وفي أوقات فراغ المتصفّح بعد فتح النظام، للأقسام الظاهرة للمستخدم واحدًا
 *     واحدًا، فتُفتح كلّها بعد دقيقةٍ تقريبًا بلا انتظار.
 *
 * الحزمة تُنزَّل مرّةً واحدة: `import()` نفسه يعيد الوعد ذاته لما نُزِّل.
 */

type Loader = () => Promise<unknown>;

const loaders = new Map<string, Loader>();
const started = new Set<string>();

export function registerScreenLoader(moduleId: string, loader: Loader) {
  if (!loaders.has(moduleId)) loaders.set(moduleId, loader);
}

function moduleIdOf(pathOrId: string): string {
  if (pathOrId === "/" || pathOrId === "") return "dashboard";
  return pathOrId.replace(/^\//, "").split(/[/?#]/)[0];
}

/** يُنزّل حزمة القسم إن لم تُنزَّل. الفشل (انقطاع الشبكة) يُعاد عند الضغط. */
export function preloadScreen(pathOrId: string): Promise<void> {
  const id = moduleIdOf(pathOrId);
  const loader = loaders.get(id);
  if (!loader || started.has(id)) return Promise.resolve();
  started.add(id);
  return loader().then(
    () => undefined,
    () => {
      started.delete(id);
    },
  );
}

function slowConnection(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || /(^|-)2g$|^3g$/.test(connection.effectiveType ?? "");
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * تنزيل حزم الأقسام المعطاة في أوقات الفراغ، واحدةً بعد واحدة.
 * يعيد دالّة إيقاف (عند تغيّر القائمة أو الخروج).
 */
export function preloadScreensWhenIdle(moduleIds: string[]): () => void {
  if (typeof window === "undefined" || slowConnection()) return () => undefined;
  const w = window as IdleWindow;
  const queue = moduleIds.filter((id) => loaders.has(id) && !started.has(id));
  let cancelled = false;
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;

  const schedule = (fn: () => void) => {
    if (w.requestIdleCallback) idleHandle = w.requestIdleCallback(fn, { timeout: 4000 });
    else timerHandle = window.setTimeout(fn, 400);
  };

  const step = () => {
    if (cancelled) return;
    const next = queue.shift();
    if (!next) return;
    void preloadScreen(next).then(() => {
      if (!cancelled) schedule(step);
    });
  };

  // مهلةٌ بعد الفتح: الشاشة الحالية وبياناتها أوّلًا
  const startTimer = window.setTimeout(() => schedule(step), 2500);

  return () => {
    cancelled = true;
    window.clearTimeout(startTimer);
    if (idleHandle !== null) w.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== null) window.clearTimeout(timerHandle);
  };
}
