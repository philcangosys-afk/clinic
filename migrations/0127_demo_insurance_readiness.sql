begin;

do $$
declare
  v_org uuid;
  v_company uuid;
  v_network uuid;
  v_policy uuid;
  v_contract uuid;
  v_price_list uuid;
begin
  select id into v_org
    from public.organizations
   where name = 'مجمع زين الطبي'
   order by created_at
   limit 1;
  if v_org is null then return; end if;

  select id into v_company
    from public.insurance_companies
   where organization_id = v_org and code = 'DEMO-INS'
   limit 1;
  if v_company is null then
    insert into public.insurance_companies (
      organization_id, code, name_ar, name_en, tax_number, phone,
      email, nphies_payer_id, nphies_enabled, payment_terms_days
    ) values (
      v_org, 'DEMO-INS', 'شركة الأمان للتأمين التجريبية',
      'Demo Aman Insurance', '300000000000003', '0110000000',
      'claims.demo@zaincare.test', 'DEMO-PAYER-001', false, 30
    ) returning id into v_company;
  end if;

  select id into v_network
    from public.insurance_networks
   where organization_id = v_org and company_id = v_company and code = 'DEMO-A'
   limit 1;
  if v_network is null then
    insert into public.insurance_networks (
      organization_id, company_id, code, name_ar, name_en, description_ar
    ) values (
      v_org, v_company, 'DEMO-A', 'شبكة الفئة أ التجريبية',
      'Demo Class A Network', 'شبكة اختبار داخلية — لا ترسل إلى نفيس'
    ) returning id into v_network;
  end if;

  select id into v_policy
    from public.insurance_policies
   where organization_id = v_org and company_id = v_company
     and policy_name = 'بوليصة المركز التجريبية' and policy_class = 'A'
   limit 1;
  if v_policy is null then
    insert into public.insurance_policies (
      organization_id, company_id, network_id, policy_name, policy_number,
      policy_class, default_copay_percent, default_max_amount,
      default_consultation_limit, effective_from, effective_to, annual_limit,
      deductible_amount, notes
    ) values (
      v_org, v_company, v_network, 'بوليصة المركز التجريبية', 'DEMO-POL-001',
      'A', 20, 5000, 500, current_date - 30, current_date + 365,
      50000, 0, 'بيانات اختبار فقط'
    ) returning id into v_policy;
  end if;

  select id into v_price_list
    from public.price_lists
   where organization_id = v_org and list_kind = 'base' and is_active
   order by priority desc, created_at
   limit 1;

  select id into v_contract
    from public.insurance_contracts
   where organization_id = v_org and company_id = v_company
     and contract_number = 'DEMO-CONTRACT-001'
   limit 1;
  if v_contract is null then
    insert into public.insurance_contracts (
      organization_id, company_id, network_id, contract_number, name_ar,
      name_en, price_list_id, discount_percent, default_copay_percent,
      payment_terms_days, claim_submission_days, effective_from, effective_to,
      status, notes
    ) values (
      v_org, v_company, v_network, 'DEMO-CONTRACT-001',
      'عقد التأمين التجريبي', 'Demo Insurance Contract', v_price_list,
      0, 20, 30, 60, current_date - 30, current_date + 365,
      'active', 'عقد اختبار داخلي فقط'
    ) returning id into v_contract;
  end if;

  if not exists (
    select 1 from public.insurance_coverage_rules
     where organization_id = v_org and contract_id = v_contract
       and policy_id = v_policy and scope = 'all' and is_active
  ) then
    insert into public.insurance_coverage_rules (
      organization_id, contract_id, policy_id, scope, coverage,
      copay_percent, max_amount_per_service, waiting_period_days, note_ar
    ) values (
      v_org, v_contract, v_policy, 'all', 'covered', 20, 5000, 0,
      'تغطية شاملة تجريبية'
    );
  end if;

  insert into public.patient_insurance_memberships (
    organization_id, patient_id, policy_id, membership_number, relation,
    expiry_date, eligibility_status, is_active
  )
  select v_org, patient.id, v_policy,
         'DEMO-MEM-' || right(patient.id::text, 8), 'self',
         current_date + 365, 'eligible', true
    from public.patients patient
   where patient.organization_id = v_org
     and (patient.email_1 like '%@zaincare.test' or patient.general_note like '%تجريبي%')
  on conflict (patient_id, policy_id, membership_number) do update set
    expiry_date = excluded.expiry_date,
    eligibility_status = 'eligible',
    is_active = true;

  insert into public.insurance_settings (organization_id)
  values (v_org)
  on conflict (organization_id) do nothing;
end;
$$;

commit;
