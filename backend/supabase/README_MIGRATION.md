# Supabase five-table consolidation

## What this does

- Keeps the existing columns of `profiles`, `inventory`, `orders`, `payments`, and `audit_logs` unchanged.
- Copies `water_orders` and `laundry_bookings` into `orders` (full original JSON row retained in `orders.order_details.legacy_record`).
- Copies `order_payments` into `payments` where an associated order can be resolved; full source row and unsupported metadata are retained in `audit_logs`.
- Copies `supply_inventory` into `inventory`; source row is archived in `audit_logs`.
- Archives `order_status_history`, `delivery_schedule_slots`, `customer_notifications`, and `chat_messages` in `audit_logs`.
- Drops the eight additional tables after the copy/archive steps succeed, in the same transaction.
- Creates one Postgres function, `acs_adjust_inventory_stock`, for atomic stock-in/stock-out. It creates no table and adds no column.

## Run order

1. Take a Supabase backup.
2. Run `00_preflight_legacy_tables.sql`. Review all eight row counts.
3. Open `01_consolidate_and_drop_legacy_tables.sql` and change `v_confirm_drop text := 'NO'` to `v_confirm_drop text := 'YES'` only when you approve the consolidation and table removal.
4. Run the full script. If any insert, mapping, foreign-key, or drop operation fails, PostgreSQL rolls the transaction back.
5. Run `02_verify_five_table_state.sql`.
6. Run `npm run check` and `npm test` in the backend folder, then start the API and run the integration checklist.

## Important data mapping notes

- Legacy order records are normalized into the existing `orders` columns. Their complete original source row is kept in `order_details.legacy_record` so fields that do not have dedicated columns are not discarded.
- When a legacy order UUID collides with an existing `orders.id`, a new UUID is assigned to the migrated row and an internal temporary mapping is used for related legacy payment/history/notification references.
- Legacy payment rows are copied to `payments` only when the associated order can be mapped. All legacy payment source rows are also archived in `audit_logs`.
- `supply_inventory` rows are copied into `inventory`. A source `service_type` of Water/Laundry/Printing is preserved; otherwise the row is classified as Printing.
- Chat is outside the final MasterFile operating flow. Existing chat rows are archived as legacy audit records, not exposed as a chat API.
- The SQL script does not alter or add columns to the five original tables. It does create the stock-adjustment function used by the inventory API.

## Verification

`02_verify_five_table_state.sql` checks that only the five target business tables remain, that no API source references the retired tables, and that the stock-adjustment function exists. The SQL cleanup has not been run against your live Supabase project from this environment.
