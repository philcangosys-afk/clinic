import { supabase } from "@/lib/supabase";

/**
 * تخصيص دفعات المخزون للحركات الصادرة والواردة.
 *
 * **سبب وجود هذا الملف** — خلل حقيقي كان قائمًا: المُحفِّز
 * `app_apply_inventory_movement` (0003) يبدأ جسمه كله بـ
 * `if new.lot_id is not null then`. أي حركة تُدرَج بلا `lot_id` تُسجَّل في
 * سجل الحركات ولا تغيّر `inventory_lots.qty_remaining` إطلاقًا — و
 * `v_inventory_on_hand` (0038) مبنيّ من الدفعات لا من سجل الحركات.
 *
 * النتيجة قبل الإصلاح: تنفيذ مناقلة ١٠ قطع من مستودع لآخر كان يسجّل حركتين
 * ويعرض رسالة "تم تحديث المخزون في المستودعين" — والقطع العشر تبقى في
 * المستودع المصدر إلى الأبد. تحقّقت من ذلك بتنفيذ السيناريو على قاعدة
 * حقيقية: الرصيد قبل ١٠ في W1 وصفر في W2، وبعد "التنفيذ" ١٠ في W1 وصفر في
 * W2 — بلا أي تغيير.
 *
 * ترتيب الصرف FIFO حسب أقرب تاريخ انتهاء ثم الأقدم استلامًا: الصرف من دفعة
 * أحدث يترك دفعة أقرب انتهاءً في الرف حتى تنتهي صلاحيتها فتُتلَف.
 */
export type LotAllocation = {
  lotId: string;
  qty: number;
  unitCost: number;
  expiryDate: string | null;
};

export type SourceLot = {
  id: string;
  qty_remaining: number;
  unit_cost: number;
  expiry_date: string | null;
  received_at: string;
};

/**
 * يوزّع كمية مطلوبة على الدفعات المتاحة بترتيب FIFO.
 * يرمي خطأً واضحًا عند عدم كفاية الرصيد بدل صرف جزئي صامت — الصرف الجزئي
 * يترك المستند يبدو منفَّذًا والمخزون ناقصًا عمّا يظنّه المستخدم.
 */
export function allocateFifo(lots: SourceLot[], requestedQty: number, itemLabel: string): LotAllocation[] {
  const available = lots.reduce((sum, lot) => sum + Number(lot.qty_remaining), 0);
  if (available < requestedQty)
    throw new Error(
      `الرصيد غير كافٍ للصنف "${itemLabel}": المطلوب ${requestedQty} والمتاح ${available}`,
    );

  const allocations: LotAllocation[] = [];
  let remaining = requestedQty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.qty_remaining));
    if (take <= 0) continue;
    allocations.push({
      lotId: lot.id,
      qty: take,
      unitCost: Number(lot.unit_cost),
      expiryDate: lot.expiry_date,
    });
    remaining -= take;
  }
  return allocations;
}

/** يجلب دفعات صنف في مستودع، المتاح منها فقط، مرتّبة FIFO. */
export async function fetchSourceLots(
  organizationId: string,
  warehouseId: string,
  itemId: string,
): Promise<SourceLot[]> {
  const { data, error } = await supabase
    .from("inventory_lots")
    .select("id, qty_remaining, unit_cost, expiry_date, received_at")
    .eq("organization_id", organizationId)
    .eq("warehouse_id", warehouseId)
    .eq("item_id", itemId)
    .gt("qty_remaining", 0)
    // الدفعات بلا تاريخ انتهاء تأتي أخيرًا: صرفها قبل دفعة لها تاريخ يعني
    // ترك القابل للانتهاء في الرف.
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("received_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SourceLot[];
}

/**
 * ينفّذ صرفًا من مستودع: حركة صادرة لكل دفعة مخصَّصة.
 * `qty_remaining` ينقصه المُحفِّز — لا يُحدَّث هنا يدويًا، وإلا نقص مرتين.
 */
export async function writeOutboundMovements(params: {
  organizationId: string;
  warehouseId: string;
  itemId: string;
  movementType: "transfer_out" | "adjustment_out" | "consumption_out" | "sale_out" | "return_out";
  allocations: LotAllocation[];
  relatedStockTransferId?: string | null;
  note?: string | null;
}) {
  const rows = params.allocations.map((allocation) => ({
    organization_id: params.organizationId,
    warehouse_id: params.warehouseId,
    item_id: params.itemId,
    lot_id: allocation.lotId,
    movement_type: params.movementType,
    qty: allocation.qty,
    unit_price: allocation.unitCost,
    total_amount: Number((allocation.qty * allocation.unitCost).toFixed(2)),
    related_stock_transfer_id: params.relatedStockTransferId ?? null,
    note: params.note ?? null,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("inventory_movements").insert(rows);
  if (error) throw error;
}

/**
 * ينشئ دفعات في مستودع الوجهة ويسجّل الحركات الواردة.
 *
 * دفعة مقابلة لكل دفعة مصدر بنفس التكلفة وتاريخ الانتهاء — لا دفعة واحدة
 * مجمَّعة: الدمج يفقد تواريخ الانتهاء المختلفة (فينتهي تتبّع الصلاحية في
 * الوجهة) ويشوّه متوسط التكلفة المرجَّح.
 *
 * `qty_remaining` يبدأ صفرًا عمدًا — المُحفِّز يزيده عند إدراج الحركة
 * الواردة. تعبئته هنا تضاعف الكمية، وهو نفس الخطأ الذي كان في شاشة المشتريات.
 */
export async function writeInboundLotsAndMovements(params: {
  organizationId: string;
  warehouseId: string;
  itemId: string;
  movementType: "transfer_in" | "adjustment_in" | "purchase_in" | "return_in";
  allocations: LotAllocation[];
  relatedStockTransferId?: string | null;
  note?: string | null;
}) {
  for (const allocation of params.allocations) {
    const { data: lot, error: lotError } = await supabase
      .from("inventory_lots")
      .insert({
        organization_id: params.organizationId,
        warehouse_id: params.warehouseId,
        item_id: params.itemId,
        unit_cost: allocation.unitCost,
        qty_received: allocation.qty,
        qty_remaining: 0,
        expiry_date: allocation.expiryDate,
      })
      .select("id")
      .single();
    if (lotError) throw lotError;

    const { error: movementError } = await supabase.from("inventory_movements").insert({
      organization_id: params.organizationId,
      warehouse_id: params.warehouseId,
      item_id: params.itemId,
      lot_id: lot.id,
      movement_type: params.movementType,
      qty: allocation.qty,
      unit_price: allocation.unitCost,
      total_amount: Number((allocation.qty * allocation.unitCost).toFixed(2)),
      related_stock_transfer_id: params.relatedStockTransferId ?? null,
      note: params.note ?? null,
    });
    if (movementError) throw movementError;
  }
}
