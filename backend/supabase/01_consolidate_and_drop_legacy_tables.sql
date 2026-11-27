-- ACS: consolidate the eight additional tables into the five original tables.
-- IMPORTANT:
-- 1) Take a Supabase backup first.
-- 2) Run 00_preflight_legacy_tables.sql and review the row counts.
-- 3) This script preserves Water/Laundry orders in public.orders, maps legacy
--    order payments to public.payments, maps supply inventory to public.inventory,
--    and archives old histories/schedules/notifications/chat rows in public.audit_logs.
-- 4) It does NOT add, rename, or remove columns from the five original tables.
-- 5) It drops the eight additional tables at the end of the same transaction.
-- 6) Change v_confirm_drop from 'NO' to 'YES' below only after backup/review.

BEGIN;

CREATE TEMP TABLE acs_legacy_order_map (
  source_table text NOT NULL,
  old_id uuid NOT NULL,
  new_id uuid NOT NULL,
  PRIMARY KEY (source_table, old_id)
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.acs_try_uuid(p_value text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  RETURN p_value::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.acs_try_numeric(p_value text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  RETURN p_value::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.acs_try_timestamptz(p_value text)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN others THEN RETURN NULL;
END; $$;


DO $$
DECLARE
  v_confirm_drop text := 'NO'; -- CHANGE TO 'YES' ONLY AFTER BACKUP AND PREFLIGHT REVIEW.
  r record;
  j jsonb;
  v_old_id uuid;
  v_new_id uuid;
  v_user_id uuid;
  v_created_by uuid;
  v_source text;
  v_arrangement text;
  v_fulfillment text;
  v_scheduled_at timestamptz;
  v_total numeric;
  v_status text;
  v_payment_status text;
  v_details jsonb;
  v_slot jsonb;
  v_customer_name text;
  v_customer_phone text;
  v_customer_address text;
  v_instructions text;
  v_order_id uuid;
  v_payment_id uuid;
  v_received_by uuid;
  v_service_type text;
  v_stock integer;
  v_price numeric;
  v_available boolean;
  v_entity_id uuid;
  v_title text;
  v_message text;
BEGIN
  IF v_confirm_drop <> 'YES' THEN
    RAISE EXCEPTION 'Safety stop: set v_confirm_drop to YES in this script only after taking a backup and reviewing preflight counts.';
  END IF;

  -- Verify the five original business tables exist before changing anything.
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.inventory') IS NULL
     OR to_regclass('public.orders') IS NULL OR to_regclass('public.payments') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'One or more original ACS tables are missing. No changes made.';
  END IF;

  -- WATER ORDERS -> ORDERS. Original row is retained in order_details.legacy_record.
  IF to_regclass('public.water_orders') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.water_orders t' LOOP
      j := r.j;
      v_old_id := pg_temp.acs_try_uuid(j->>'id');
      v_new_id := v_old_id;
      IF v_new_id IS NULL OR EXISTS (SELECT 1 FROM public.orders WHERE id = v_new_id) THEN v_new_id := gen_random_uuid(); END IF;
      v_user_id := pg_temp.acs_try_uuid(j->>'user_id');
      IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN v_user_id := NULL; END IF;
      v_created_by := pg_temp.acs_try_uuid(COALESCE(j->>'created_by', j->>'staff_id'));
      IF v_created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_created_by) THEN v_created_by := NULL; END IF;
      v_source := CASE lower(COALESCE(j->>'transaction_source','')) WHEN 'online' THEN 'Online' WHEN 'walk-in' THEN 'Walk-in' WHEN 'walkin' THEN 'Walk-in' ELSE 'Unclassified' END;
      v_arrangement := COALESCE(NULLIF(j->>'service_arrangement',''), NULLIF(j->>'arrangement',''), 'legacy_unspecified');
      v_fulfillment := COALESCE(NULLIF(j->>'fulfillment_mode',''), NULLIF(j->>'fulfillment_type',''));
      IF v_fulfillment NOT IN ('delivery','station_pickup') OR v_fulfillment IS NULL THEN
        v_fulfillment := CASE WHEN v_arrangement ILIKE '%delivery%' THEN 'delivery' ELSE 'station_pickup' END;
      END IF;
      v_scheduled_at := pg_temp.acs_try_timestamptz(COALESCE(j->>'scheduled_at', j->>'delivery_datetime'));
      v_slot := NULL;
      IF v_scheduled_at IS NULL AND j->>'schedule_id' IS NOT NULL AND to_regclass('public.delivery_schedule_slots') IS NOT NULL THEN
        EXECUTE 'SELECT to_jsonb(s) FROM public.delivery_schedule_slots s WHERE s.id=$1' INTO v_slot USING pg_temp.acs_try_uuid(j->>'schedule_id');
        IF v_slot IS NOT NULL THEN
          v_scheduled_at := pg_temp.acs_try_timestamptz(COALESCE(v_slot->>'scheduled_at', v_slot->>'start_at'));
          IF v_scheduled_at IS NULL AND v_slot->>'schedule_date' IS NOT NULL AND v_slot->>'start_time' IS NOT NULL THEN
            v_scheduled_at := pg_temp.acs_try_timestamptz((v_slot->>'schedule_date') || ' ' || (v_slot->>'start_time') || ' Asia/Manila');
          END IF;
        END IF;
      END IF;
      v_total := COALESCE(pg_temp.acs_try_numeric(j->>'total_price'), pg_temp.acs_try_numeric(j->>'total_amount'), pg_temp.acs_try_numeric(j->>'amount'), 0);
      v_status := CASE lower(COALESCE(j->>'status','pending')) WHEN 'pending' THEN 'Pending' WHEN 'in progress' THEN 'In Progress' WHEN 'out for delivery' THEN 'Out for Delivery' WHEN 'ready for station pickup' THEN 'Ready for Station Pickup' WHEN 'completed' THEN 'Completed' WHEN 'cancelled' THEN 'Cancelled' ELSE COALESCE(NULLIF(j->>'status',''),'Pending') END;
      v_payment_status := lower(COALESCE(NULLIF(j->>'payment_status',''), 'pending'));
      v_customer_name := COALESCE(j->>'customer_name', j->>'name');
      v_customer_phone := COALESCE(j->>'customer_phone', j->>'phone');
      v_customer_address := COALESCE(j->>'customer_address', j->>'pickup_address', j->>'delivery_address');
      v_instructions := COALESCE(j->>'special_instructions', j->>'notes', j->>'instructions');
      v_details := jsonb_build_object(
        'legacy_source_table','water_orders', 'legacy_source_id',j->>'id',
        'legacy_record',j, 'transaction_source',v_source,
        'service_arrangement',v_arrangement,
        'delivery_address',j->>'delivery_address', 'pickup_address',j->>'pickup_address',
        'schedule_notes',COALESCE(j->>'schedule_notes',j->>'delivery_notes'),
        'service_id',j->>'service_id', 'service_name',COALESCE(j->>'service_name',j->>'item_name'),
        'quantity',COALESCE(j->'quantity',j->'gallons'), 'unit_price',COALESCE(j->'unit_price',j->'price_per_unit')
      );
      INSERT INTO public.orders (id,user_id,service_type,order_details,fulfillment_mode,scheduled_at,total_price,status,customer_name,customer_phone,customer_address,special_instructions,payment_status,created_by,updated_at,inventory_deducted,inventory_restored)
      VALUES (v_new_id,v_user_id,'Water',v_details,v_fulfillment,v_scheduled_at,v_total,v_status,v_customer_name,v_customer_phone,v_customer_address,v_instructions,v_payment_status,v_created_by,COALESCE(pg_temp.acs_try_timestamptz(j->>'updated_at'),now()),false,false);
      IF v_old_id IS NOT NULL THEN INSERT INTO acs_legacy_order_map VALUES ('water_orders',v_old_id,v_new_id) ON CONFLICT DO NOTHING; END IF;
    END LOOP;
  END IF;

  -- LAUNDRY BOOKINGS -> ORDERS. Preserve weight, load count, products and all source fields in JSONB.
  IF to_regclass('public.laundry_bookings') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.laundry_bookings t' LOOP
      j := r.j;
      v_old_id := pg_temp.acs_try_uuid(j->>'id');
      v_new_id := v_old_id;
      IF v_new_id IS NULL OR EXISTS (SELECT 1 FROM public.orders WHERE id = v_new_id) THEN v_new_id := gen_random_uuid(); END IF;
      v_user_id := pg_temp.acs_try_uuid(j->>'user_id');
      IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN v_user_id := NULL; END IF;
      v_created_by := pg_temp.acs_try_uuid(COALESCE(j->>'created_by', j->>'staff_id'));
      IF v_created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_created_by) THEN v_created_by := NULL; END IF;
      v_source := CASE lower(COALESCE(j->>'transaction_source','')) WHEN 'online' THEN 'Online' WHEN 'walk-in' THEN 'Walk-in' WHEN 'walkin' THEN 'Walk-in' ELSE 'Unclassified' END;
      v_arrangement := COALESCE(NULLIF(j->>'service_arrangement',''), NULLIF(j->>'arrangement',''), 'legacy_unspecified');
      v_fulfillment := COALESCE(NULLIF(j->>'fulfillment_mode',''), NULLIF(j->>'fulfillment_type',''));
      IF v_fulfillment NOT IN ('delivery','station_pickup') OR v_fulfillment IS NULL THEN
        v_fulfillment := CASE WHEN v_arrangement ILIKE '%delivery%' THEN 'delivery' ELSE 'station_pickup' END;
      END IF;
      v_scheduled_at := pg_temp.acs_try_timestamptz(COALESCE(j->>'scheduled_at', j->>'delivery_datetime'));
      v_slot := NULL;
      IF v_scheduled_at IS NULL AND j->>'schedule_id' IS NOT NULL AND to_regclass('public.delivery_schedule_slots') IS NOT NULL THEN
        EXECUTE 'SELECT to_jsonb(s) FROM public.delivery_schedule_slots s WHERE s.id=$1' INTO v_slot USING pg_temp.acs_try_uuid(j->>'schedule_id');
        IF v_slot IS NOT NULL THEN
          v_scheduled_at := pg_temp.acs_try_timestamptz(COALESCE(v_slot->>'scheduled_at', v_slot->>'start_at'));
          IF v_scheduled_at IS NULL AND v_slot->>'schedule_date' IS NOT NULL AND v_slot->>'start_time' IS NOT NULL THEN
            v_scheduled_at := pg_temp.acs_try_timestamptz((v_slot->>'schedule_date') || ' ' || (v_slot->>'start_time') || ' Asia/Manila');
          END IF;
        END IF;
      END IF;
      v_total := COALESCE(pg_temp.acs_try_numeric(j->>'total_price'), pg_temp.acs_try_numeric(j->>'total_amount'), pg_temp.acs_try_numeric(j->>'amount'), 0);
      v_status := CASE lower(COALESCE(j->>'status','pending')) WHEN 'pending' THEN 'Pending' WHEN 'in progress' THEN 'In Progress' WHEN 'out for delivery' THEN 'Out for Delivery' WHEN 'ready for station pickup' THEN 'Ready for Station Pickup' WHEN 'completed' THEN 'Completed' WHEN 'cancelled' THEN 'Cancelled' ELSE COALESCE(NULLIF(j->>'status',''),'Pending') END;
      v_payment_status := lower(COALESCE(NULLIF(j->>'payment_status',''), 'pending'));
      v_customer_name := COALESCE(j->>'customer_name', j->>'name');
      v_customer_phone := COALESCE(j->>'customer_phone', j->>'phone');
      v_customer_address := COALESCE(j->>'customer_address', j->>'pickup_address', j->>'delivery_address');
      v_instructions := COALESCE(j->>'special_instructions', j->>'notes', j->>'instructions');
      v_details := jsonb_build_object(
        'legacy_source_table','laundry_bookings', 'legacy_source_id',j->>'id',
        'legacy_record',j, 'transaction_source',v_source,
        'service_arrangement',v_arrangement,
        'delivery_address',j->>'delivery_address', 'pickup_address',j->>'pickup_address',
        'schedule_notes',COALESCE(j->>'schedule_notes',j->>'delivery_notes'),
        'service_id',j->>'service_id', 'service_name',COALESCE(j->>'service_name',j->>'item_name'),
        'weight_kg',COALESCE(j->'weight_kg',j->'weight'), 'load_count',j->'load_count',
        'detergent',j->'detergent', 'fabric_conditioner',j->'fabric_conditioner', 'bleach',j->'bleach'
      );
      INSERT INTO public.orders (id,user_id,service_type,order_details,fulfillment_mode,scheduled_at,total_price,status,customer_name,customer_phone,customer_address,special_instructions,payment_status,created_by,updated_at,inventory_deducted,inventory_restored)
      VALUES (v_new_id,v_user_id,'Laundry',v_details,v_fulfillment,v_scheduled_at,v_total,v_status,v_customer_name,v_customer_phone,v_customer_address,v_instructions,v_payment_status,v_created_by,COALESCE(pg_temp.acs_try_timestamptz(j->>'updated_at'),now()),false,false);
      IF v_old_id IS NOT NULL THEN INSERT INTO acs_legacy_order_map VALUES ('laundry_bookings',v_old_id,v_new_id) ON CONFLICT DO NOTHING; END IF;
    END LOOP;
  END IF;

  -- SUPPLY INVENTORY -> INVENTORY. The source row is also archived in audit_logs.
  IF to_regclass('public.supply_inventory') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.supply_inventory t' LOOP
      j := r.j;
      v_old_id := pg_temp.acs_try_uuid(j->>'id');
      v_new_id := v_old_id;
      IF v_new_id IS NULL OR EXISTS (SELECT 1 FROM public.inventory WHERE id = v_new_id) THEN v_new_id := gen_random_uuid(); END IF;
      v_service_type := COALESCE(NULLIF(j->>'service_type',''), 'Printing');
      IF v_service_type NOT IN ('Water','Laundry','Printing') THEN v_service_type := 'Printing'; END IF;
      v_stock := GREATEST(0, COALESCE(pg_temp.acs_try_numeric(COALESCE(j->>'stock_quantity',j->>'quantity_on_hand',j->>'quantity'))::integer,0));
      v_price := GREATEST(0, COALESCE(pg_temp.acs_try_numeric(COALESCE(j->>'selling_price',j->>'unit_price',j->>'price')),0));
      v_available := CASE lower(COALESCE(j->>'availability','true')) WHEN 'false' THEN false WHEN '0' THEN false ELSE true END;
      INSERT INTO public.inventory (id,item_name,service_type,category,description,unit,stock_quantity,selling_price,availability,created_at,updated_at)
      VALUES (v_new_id,COALESCE(NULLIF(j->>'item_name',''),NULLIF(j->>'name',''),'Legacy supply item'),v_service_type,j->>'category',COALESCE(j->>'description',j->>'notes'),COALESCE(NULLIF(j->>'unit',''),'item'),v_stock,v_price,v_available,COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()),COALESCE(pg_temp.acs_try_timestamptz(j->>'updated_at'),now()));
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (NULL,'Legacy supply inventory archived','legacy_inventory',v_new_id,jsonb_build_object('source_table','supply_inventory','source_record',j,'new_inventory_id',v_new_id),'migration',now());
    END LOOP;
  END IF;

  -- LEGACY ORDER PAYMENTS -> PAYMENTS; unsupported metadata is retained in audit_logs.
  IF to_regclass('public.order_payments') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.order_payments t' LOOP
      j := r.j;
      v_old_id := pg_temp.acs_try_uuid(j->>'order_id');
      v_order_id := NULL;
      IF v_old_id IS NOT NULL THEN
        IF lower(COALESCE(j->>'order_type','water')) LIKE 'laundry%' THEN
          SELECT new_id INTO v_order_id FROM acs_legacy_order_map WHERE source_table='laundry_bookings' AND old_id=v_old_id;
        ELSE
          SELECT new_id INTO v_order_id FROM acs_legacy_order_map WHERE source_table='water_orders' AND old_id=v_old_id;
        END IF;
        IF v_order_id IS NULL AND EXISTS (SELECT 1 FROM public.orders WHERE id=v_old_id) THEN v_order_id := v_old_id; END IF;
      END IF;
      v_received_by := pg_temp.acs_try_uuid(COALESCE(j->>'received_by',j->>'verified_by'));
      IF v_received_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_received_by) THEN v_received_by := NULL; END IF;
      IF v_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id=v_order_id) THEN
        v_payment_id := pg_temp.acs_try_uuid(j->>'id');
        IF v_payment_id IS NULL OR EXISTS (SELECT 1 FROM public.payments WHERE id=v_payment_id) THEN v_payment_id := gen_random_uuid(); END IF;
        INSERT INTO public.payments (id,order_id,payment_method,amount,payment_status,received_by,reference_number,created_at)
        VALUES (v_payment_id,v_order_id,COALESCE(NULLIF(j->>'payment_method',''),'Cash'),COALESCE(pg_temp.acs_try_numeric(COALESCE(j->>'amount',j->>'total_amount')),0),CASE lower(COALESCE(j->>'payment_status','pending')) WHEN 'paid' THEN 'verified' WHEN 'completed' THEN 'verified' WHEN 'verified' THEN 'verified' WHEN 'rejected' THEN 'rejected' WHEN 'failed' THEN 'rejected' WHEN 'submitted' THEN 'submitted' ELSE 'pending' END,v_received_by,j->>'reference_number',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
      END IF;
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (v_received_by,'Legacy order payment archived','legacy_payment',v_order_id,jsonb_build_object('source_table','order_payments','source_record',j,'mapped_order_id',v_order_id),'migration',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
    END LOOP;
  END IF;

  -- ORDER STATUS HISTORY -> AUDIT LOGS.
  IF to_regclass('public.order_status_history') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.order_status_history t' LOOP
      j := r.j;
      v_old_id := pg_temp.acs_try_uuid(j->>'order_id');
      v_entity_id := NULL;
      IF v_old_id IS NOT NULL THEN
        IF lower(COALESCE(j->>'order_type','water')) LIKE 'laundry%' THEN SELECT new_id INTO v_entity_id FROM acs_legacy_order_map WHERE source_table='laundry_bookings' AND old_id=v_old_id;
        ELSE SELECT new_id INTO v_entity_id FROM acs_legacy_order_map WHERE source_table='water_orders' AND old_id=v_old_id; END IF;
        IF v_entity_id IS NULL AND EXISTS (SELECT 1 FROM public.orders WHERE id=v_old_id) THEN v_entity_id := v_old_id; END IF;
      END IF;
      v_user_id := pg_temp.acs_try_uuid(COALESCE(j->>'changed_by',j->>'user_id'));
      IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN v_user_id := NULL; END IF;
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (v_user_id,COALESCE(j->>'new_status','Legacy order status event'),'order',v_entity_id,jsonb_build_object('event','order_status_changed','source_table','order_status_history','source_record',j,'old_status',j->>'old_status','new_status',j->>'new_status','note',j->>'note'),'migration',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
    END LOOP;
  END IF;

  -- DELIVERY SCHEDULES -> AUDIT LOGS. Actual selected times are retained on migrated orders.scheduled_at.
  IF to_regclass('public.delivery_schedule_slots') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.delivery_schedule_slots t' LOOP
      j := r.j;
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (NULL,'Legacy delivery schedule archived','legacy_schedule',pg_temp.acs_try_uuid(j->>'id'),jsonb_build_object('source_table','delivery_schedule_slots','source_record',j),'migration',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
    END LOOP;
  END IF;

  -- CUSTOMER NOTIFICATIONS -> AUDIT LOGS. Preserve unread/read state and source payload.
  IF to_regclass('public.customer_notifications') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.customer_notifications t' LOOP
      j := r.j;
      v_user_id := pg_temp.acs_try_uuid(j->>'user_id');
      IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN v_user_id := NULL; END IF;
      v_old_id := pg_temp.acs_try_uuid(j->>'order_id');
      v_entity_id := NULL;
      IF v_old_id IS NOT NULL THEN
        IF lower(COALESCE(j->>'order_type','water')) LIKE 'laundry%' THEN SELECT new_id INTO v_entity_id FROM acs_legacy_order_map WHERE source_table='laundry_bookings' AND old_id=v_old_id;
        ELSE SELECT new_id INTO v_entity_id FROM acs_legacy_order_map WHERE source_table='water_orders' AND old_id=v_old_id; END IF;
        IF v_entity_id IS NULL AND EXISTS (SELECT 1 FROM public.orders WHERE id=v_old_id) THEN v_entity_id := v_old_id; END IF;
      END IF;
      v_title := COALESCE(j->>'title','Order update'); v_message := COALESCE(j->>'message','');
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (v_user_id,v_title,'notification',v_entity_id,jsonb_build_object('event','customer_notification','source_table','customer_notifications','order_id',v_entity_id,'title',v_title,'message',v_message,'is_read',COALESCE((j->>'is_read')::boolean,false),'read_at',j->>'read_at','legacy_record',j),'notifications',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
    END LOOP;
  END IF;

  -- CHAT MESSAGES -> AUDIT LOGS. Chat is not mounted in the MasterFile-aligned API.
  IF to_regclass('public.chat_messages') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT to_jsonb(t) AS j FROM public.chat_messages t' LOOP
      j := r.j;
      v_user_id := pg_temp.acs_try_uuid(COALESCE(j->>'sender_id',j->>'customer_id'));
      IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN v_user_id := NULL; END IF;
      INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,details,module,created_at)
      VALUES (v_user_id,'Legacy chat message archived','legacy_chat_message',pg_temp.acs_try_uuid(j->>'id'),jsonb_build_object('source_table','chat_messages','source_record',j),'migration',COALESCE(pg_temp.acs_try_timestamptz(j->>'created_at'),now()));
    END LOOP;
  END IF;

  DROP TABLE IF EXISTS public.water_orders, public.laundry_bookings, public.order_payments,
    public.order_status_history, public.supply_inventory, public.delivery_schedule_slots,
    public.customer_notifications, public.chat_messages;

  -- Retire old table-specific RPC helpers after their dependent legacy tables/triggers are gone.
  <<drop_legacy_helpers>>
  DECLARE v_proc regprocedure;
  BEGIN
    FOR v_proc IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('reserve_delivery_schedule_slot','release_delivery_schedule_slot','restock_supply_inventory','adjust_supply_inventory_stock')
    LOOP EXECUTE format('DROP FUNCTION %s',v_proc); END LOOP;
  END drop_legacy_helpers;
END $$;

-- Atomic stock movement helper. This is a function, not an additional table.
CREATE OR REPLACE FUNCTION public.acs_adjust_inventory_stock(p_item_id uuid, p_direction text, p_quantity integer)
RETURNS public.inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item public.inventory;
BEGIN
  IF p_direction NOT IN ('IN','OUT') OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid stock movement.' USING ERRCODE='22023';
  END IF;
  UPDATE public.inventory
     SET stock_quantity = CASE WHEN p_direction='IN' THEN stock_quantity + p_quantity ELSE stock_quantity - p_quantity END,
         updated_at = now()
   WHERE id = p_item_id
     AND (p_direction='IN' OR stock_quantity >= p_quantity)
   RETURNING * INTO v_item;
  IF FOUND THEN RETURN v_item; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory WHERE id=p_item_id) THEN
    RAISE EXCEPTION 'Insufficient inventory stock.' USING ERRCODE='P0001';
  END IF;
  RAISE EXCEPTION 'Inventory item not found.' USING ERRCODE='P0002';
END;
$$;
GRANT EXECUTE ON FUNCTION public.acs_adjust_inventory_stock(uuid,text,integer) TO service_role;

COMMIT;

-- Final verification: expected business tables are the original five only.
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
ORDER BY table_name;
