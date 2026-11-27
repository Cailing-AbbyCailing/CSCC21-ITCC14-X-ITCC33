-- READ-ONLY PREFLIGHT. Run this first in Supabase SQL Editor.
-- It reports row counts for the eight additional tables before consolidation.
SELECT 'water_orders' AS table_name, COUNT(*) AS row_count FROM public.water_orders
UNION ALL SELECT 'laundry_bookings', COUNT(*) FROM public.laundry_bookings
UNION ALL SELECT 'order_payments', COUNT(*) FROM public.order_payments
UNION ALL SELECT 'order_status_history', COUNT(*) FROM public.order_status_history
UNION ALL SELECT 'supply_inventory', COUNT(*) FROM public.supply_inventory
UNION ALL SELECT 'delivery_schedule_slots', COUNT(*) FROM public.delivery_schedule_slots
UNION ALL SELECT 'customer_notifications', COUNT(*) FROM public.customer_notifications
UNION ALL SELECT 'chat_messages', COUNT(*) FROM public.chat_messages
ORDER BY table_name;

-- Confirm the original five tables and their current columns remain present.
SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles','inventory','orders','payments','audit_logs')
ORDER BY table_name, ordinal_position;
