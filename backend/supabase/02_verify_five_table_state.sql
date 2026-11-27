-- Expected business tables: profiles, inventory, orders, payments, audit_logs.
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
ORDER BY table_name;

-- Expected result: exactly these five names for the ACS business schema.
SELECT COUNT(*) AS remaining_legacy_tables
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
  AND table_name IN (
    'water_orders','laundry_bookings','order_payments','order_status_history',
    'supply_inventory','delivery_schedule_slots','customer_notifications','chat_messages'
  );

-- Expected result: 1 row.
SELECT to_regprocedure('public.acs_adjust_inventory_stock(uuid,text,integer)') AS stock_function;

-- Verify required existing columns used by the revised APIs.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND (
    (table_name='profiles' AND column_name IN ('id','full_name','email','phone','default_address','role','is_active','created_at')) OR
    (table_name='inventory' AND column_name IN ('id','item_name','service_type','category','description','unit','stock_quantity','selling_price','availability','created_at','updated_at')) OR
    (table_name='orders' AND column_name IN ('id','user_id','service_type','order_details','fulfillment_mode','scheduled_at','total_price','status','created_at','customer_name','customer_phone','customer_address','special_instructions','payment_status','created_by','updated_at','inventory_deducted','inventory_restored')) OR
    (table_name='payments' AND column_name IN ('id','order_id','payment_method','amount','payment_status','received_by','reference_number','created_at')) OR
    (table_name='audit_logs' AND column_name IN ('id','user_id','action','entity_type','entity_id','details','created_at','module'))
  )
ORDER BY table_name, column_name;
