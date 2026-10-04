-- ============================================================================
-- 0224_zatca_resolve_ambiguous.sql
-- ============================================================================
-- الحادثة (04/10/2026): إرسال C-10216 إلى ZATCA فشل بـ
--   «error sending request … client error (Connect): tls handshake eof»
-- فعُلِّمت «غير محسومة» وأُوقف تسلسل الجهاز (0179)، فتوقّف إبلاغ كلّ ما بعدها
-- (C-10217…) بلا طريقٍ للحسم من النظام إلّا الدعم الفنّي.
--
-- الحسم الآمن (في الدالّة الطرفية zatca-invoice، action = resolve_ambiguous):
-- يُعاد إرسال **المستند الموقّع نفسه** المحفوظ في سجلّ الإرسال (نفس UUID
-- والبصمة وICV وPIH):
--   • قُبل (أو ردّت ZATCA أنّه وصلها من قبل) ⇒ `finalize_zatca_accepted_submission`
--     القائمة: يتقدّم التسلسل ويُرفع الإيقاف وتُثبَّت الفاتورة.
--   • رُفض برفض صريح (4xx) ⇒ لم تقبله ZATCA: هذه الدالّة تُعلِّم السجلّ والفاتورة
--     «مرفوضة» وتُحرِّر التسلسل وترفع الإيقاف **دون** تقدّم ICV/PIH — فالمستند
--     التالي يأخذ الرقم نفسه، كما يحدث لأيّ رفضٍ عاديّ.
--   • تعذّر الاتصال مرّةً أخرى أو 5xx ⇒ يبقى «غير محسوم» ويُعاد لاحقًا.
--
-- ذرّية: الثلاثة (السجلّ، الفاتورة، التسلسل) في دالّة واحدة. لـ service_role فقط.
-- لا يمسّ أيّ فاتورةٍ أخرى ولا أرقامها.
-- ============================================================================

begin;
set local lock_timeout = '8s';

create or replace function public.resolve_zatca_rejected_submission(
  p_onboarding_id     uuid,
  p_reservation_token uuid,
  p_log_id            uuid,
  p_invoice_id        uuid,
  p_http_status       integer,
  p_response          jsonb,
  p_response_text     text,
  p_error             text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update zatca_device_sequences
     set reservation_token = null,
         reservation_expires_at = null,
         blocked_at = null,
         blocked_reason = null,
         updated_at = now()
   where onboarding_id = p_onboarding_id
     and reservation_token = p_reservation_token
     and blocked_at is not null;
  if not found then raise exception 'INVALID_ZATCA_SEQUENCE_RESERVATION'; end if;

  update zatca_invoice_submission_logs
     set status = 'rejected',
         http_status = p_http_status,
         response = coalesce(p_response, '{}'::jsonb),
         response_text = p_response_text,
         retry_after = null,
         last_error = p_error,
         updated_at = now()
   where id = p_log_id
     and status = 'ambiguous';
  if not found then raise exception 'ZATCA_SUBMISSION_LOG_NOT_AMBIGUOUS'; end if;

  update sales_invoices
     set zatca_status = 'rejected',
         zatca_response = coalesce(p_response, '{}'::jsonb),
         zatca_submitted_at = now()
   where id = p_invoice_id;
  if not found then raise exception 'ZATCA_INVOICE_RECORD_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.resolve_zatca_rejected_submission(uuid, uuid, uuid, uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_zatca_rejected_submission(uuid, uuid, uuid, uuid, integer, jsonb, text, text)
  to service_role;

comment on function public.resolve_zatca_rejected_submission(uuid, uuid, uuid, uuid, integer, jsonb, text, text) is
  'حسم مستندٍ «غير محسوم» رفضته ZATCA صراحةً عند إعادة إرساله: السجلّ والفاتورة «مرفوضة»، ويُحرَّر التسلسل ويُرفع إيقافه دون تقدّم ICV/PIH. service_role فقط. 0224.';

commit;

notify pgrst, 'reload schema';

-- ── النتيجة: حال الأجهزة والمستندات غير المحسومة ────────────────────────────
select s.device_serial as "الجهاز",
       case when q.blocked_at is null then 'يعمل' else 'موقوف منذ ' || to_char(q.blocked_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') end as "الحالة",
       q.next_icv as "ICV التالي",
       (select string_agg(coalesce(i.document_prefix || '-' || i.document_number, i.invoice_number::text), '، ')
          from zatca_invoice_submission_logs l join sales_invoices i on i.id = l.invoice_id
         where l.onboarding_id = s.id and l.status = 'ambiguous') as "غير محسومة"
  from zatca_onboarding_settings s
  join zatca_device_sequences q on q.onboarding_id = s.id
 where not s.is_archived;
