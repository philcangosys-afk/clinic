import { useEffect, useRef, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";

/**
 * لوحة توقيع — بالإصبع أو القلم أو الفأرة، وتُرجع صورةً PNG (data URL).
 *
 * الخلفية بيضاء مرسومة (لا شفّافة): الشفّاف يُطبع أسود على بعض الطابعات.
 * و`onChange(null)` حين تُمسح أو قبل أن يُرسم شيء — فلا يُحفظ توقيعٌ فارغ.
 */
export default function SignatureCanvas({
  onChange,
  height = 180,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  const reset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawn.current = false;
    onChange(null);
  };

  useEffect(() => {
    // الدقّة الداخلية بمقاس العرض الفعليّ (×2) — وإلّا تمطّط الخطّ في الصورة المحفوظة
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = Math.max(300, canvas.clientWidth) * 2;
      canvas.height = height * 2;
    }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: "none" }}
        className="w-full cursor-crosshair rounded-md border bg-white"
        onPointerDown={(event) => {
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const { x, y } = point(event);
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const { x, y } = point(event);
          ctx.lineTo(x, y);
          ctx.stroke();
          drawn.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (drawn.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (drawn.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
        }}
      />
      <div>
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          مسح التوقيع
        </Button>
      </div>
    </div>
  );
}
