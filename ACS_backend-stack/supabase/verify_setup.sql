-- Read-only verification for the ACS paper-aligned API migration.
-- Run this AFTER supabase/remaining_apis_schema.sql in the same existing project.

-- 1) Required base and API-owned tables.
SELECT table_name,
       CASE WHEN to_regclass(format('public.%I', table_name)) IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
    ('profiles'),
    ('inventory'),
    ('orders'),
    ('payments'),
    ('audit_logs'),
    ('delivery_schedule_slots'),
    ('water_orders'),
    ('laundry_bookings'),
    ('order_status_history'),
    ('order_payments'),
    ('customer_notifications'),
    ('supply_inventory'),
    ('chat_messages')
) AS required(table_name)
ORDER BY table_name;

-- 2) Columns required by the APIs.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'profiles' AND column_name = 'is_active')
      OR (table_name = 'chat_messages' AND column_name IN ('is_read', 'read_at', 'edited_at', 'updated_at'))
      OR (table_name = 'water_orders' AND column_name IN ('service_id', 'schedule_id', 'user_id', 'total_amount', 'status'))
      OR (table_name = 'laundry_bookings' AND column_name IN ('service_id', 'schedule_id', 'user_id', 'total_amount', 'weight_kg', 'load_count', 'status'))
      OR (table_name = 'audit_logs' AND column_name IN ('user_id', 'action', 'entity_type', 'module', 'details', 'created_at'))
      OR (table_name = 'order_payments' AND column_name IN ('order_type', 'order_id', 'user_id', 'payment_status', 'amount'))
      OR (table_name = 'supply_inventory' AND column_name IN ('item_name', 'quantity_on_hand', 'reorder_level'))
  )
ORDER BY table_name, column_name;

-- 3) Required database functions.
SELECT routine_name,
       CASE WHEN routine_name IN (
          'reserve_delivery_schedule_slot',
          'release_delivery_schedule_slot',
          'restock_supply_inventory',
          'update_order_and_payment'
       ) THEN 'REQUIRED' ELSE 'OTHER' END AS function_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
      'reserve_delivery_schedule_slot',
      'release_delivery_schedule_slot',
      'restock_supply_inventory',
      'update_order_and_payment'
  )
ORDER BY routine_name;

-- 4) RLS state for API-owned tables.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'delivery_schedule_slots', 'water_orders', 'laundry_bookings',
      'order_status_history', 'order_payments', 'customer_notifications',
      'supply_inventory', 'chat_messages'
  )
ORDER BY c.relname;
