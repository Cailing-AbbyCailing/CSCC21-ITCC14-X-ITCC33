-- Alavanza remaining API modules: Orders & Fulfillment, Payments, Supply Inventory, and Chat.
-- ADDITIVE MIGRATION: creates new tables/functions/policies; it does not drop or rewrite
-- existing profiles, inventory, orders, payments, or audit_logs records.
-- Existing public.inventory.id must be UUID, as assumed by the Services API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Account activation flag used by GET/PUT/DELETE /api/users/:id.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
UPDATE public.profiles SET is_active = true WHERE is_active IS NULL;

-- Staff-published pickup/delivery capacity. Customers can only read active slots with space.
CREATE TABLE IF NOT EXISTS public.delivery_schedule_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_type text NOT NULL CHECK (service_type IN ('Water', 'Laundry')),
    fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('delivery', 'station_pickup')),
    schedule_date date NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    booked_count integer NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT delivery_slot_time_order CHECK (end_time > start_time),
    CONSTRAINT delivery_slot_capacity_check CHECK (booked_count <= capacity),
    CONSTRAINT delivery_slot_unique UNIQUE (service_type, fulfillment_type, schedule_date, start_time)
);

CREATE TABLE IF NOT EXISTS public.water_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    service_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
    service_name text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
    fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('delivery', 'station_pickup')),
    delivery_address text,
    delivery_date date NOT NULL,
    delivery_time time NOT NULL,
    schedule_id uuid NOT NULL REFERENCES public.delivery_schedule_slots(id) ON DELETE RESTRICT,
    payment_method text NOT NULL CHECK (payment_method IN ('Cash on Delivery (COD)', 'GCash Online Payment')),
    status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT water_order_delivery_address_check CHECK (fulfillment_type <> 'delivery' OR length(trim(coalesce(delivery_address, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS public.laundry_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    service_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
    service_name text NOT NULL,
    weight_kg numeric(8,2) NOT NULL CHECK (weight_kg > 0),
    unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
    fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('delivery', 'station_pickup')),
    delivery_address text,
    delivery_date date NOT NULL,
    delivery_time time NOT NULL,
    schedule_id uuid NOT NULL REFERENCES public.delivery_schedule_slots(id) ON DELETE RESTRICT,
    payment_method text NOT NULL CHECK (payment_method IN ('Cash on Delivery (COD)', 'GCash Online Payment')),
    detergent text,
    fabric_conditioner text,
    status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT laundry_booking_delivery_address_check CHECK (fulfillment_type <> 'delivery' OR length(trim(coalesce(delivery_address, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_type text NOT NULL CHECK (order_type IN ('water', 'laundry')),
    order_id uuid NOT NULL,
    old_status text,
    new_status text NOT NULL,
    changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);


-- Persistent customer-facing notifications for approval and fulfillment updates.
CREATE TABLE IF NOT EXISTS public.customer_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_type text NOT NULL CHECK (order_type IN ('water', 'laundry')),
    order_id uuid NOT NULL,
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
    message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 1000),
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);

-- Separate table used by the documented POST /payments and GET /payments/{id} endpoints.
-- The pre-existing public.payments table is left untouched because its full schema may vary.
CREATE TABLE IF NOT EXISTS public.order_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_type text NOT NULL CHECK (order_type IN ('water', 'laundry')),
    order_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    payment_method text NOT NULL CHECK (payment_method IN ('Cash on Delivery (COD)', 'GCash Online Payment')),
    amount numeric(12,2) NOT NULL CHECK (amount >= 0),
    payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'submitted', 'verified', 'rejected')),
    reference_number text,
    receipt_url text,
    verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at timestamptz,
    verification_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT order_payment_once UNIQUE (order_type, order_id)
);

CREATE TABLE IF NOT EXISTS public.supply_inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name text NOT NULL CHECK (length(trim(item_name)) > 0),
    category text,
    unit text NOT NULL DEFAULT 'piece',
    quantity_on_hand numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    reorder_level numeric(12,2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    supplier text,
    notes text,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel text NOT NULL CHECK (channel IN ('support', 'internal')),
    customer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_role text NOT NULL CHECK (sender_role IN ('customer', 'staff', 'admin')),
    message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chat_channel_customer_check CHECK ((channel = 'support' AND customer_id IS NOT NULL) OR (channel = 'internal' AND customer_id IS NULL))
);

-- Message read/edit metadata used by GET/PUT/PATCH/DELETE /api/messages/:id.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS water_orders_user_created_idx ON public.water_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS water_orders_status_idx ON public.water_orders(status, delivery_date);
CREATE INDEX IF NOT EXISTS laundry_bookings_user_created_idx ON public.laundry_bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS laundry_bookings_status_idx ON public.laundry_bookings(status, delivery_date);
CREATE INDEX IF NOT EXISTS delivery_schedule_lookup_idx ON public.delivery_schedule_slots(schedule_date, service_type, fulfillment_type, is_active);
CREATE INDEX IF NOT EXISTS order_payments_user_created_idx ON public.order_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_notifications_user_unread_idx ON public.customer_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS supply_inventory_name_idx ON public.supply_inventory(item_name);
CREATE INDEX IF NOT EXISTS chat_messages_support_idx ON public.chat_messages(channel, customer_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_internal_idx ON public.chat_messages(channel, created_at);

-- Atomic capacity reservation prevents two simultaneous requests taking the final slot.
CREATE OR REPLACE FUNCTION public.reserve_delivery_schedule_slot(p_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_slot public.delivery_schedule_slots;
BEGIN
    UPDATE public.delivery_schedule_slots
       SET booked_count = booked_count + 1
     WHERE id = p_schedule_id
       AND is_active IS TRUE
       AND (
            schedule_date > (now() AT TIME ZONE 'Asia/Manila')::date
            OR (schedule_date = (now() AT TIME ZONE 'Asia/Manila')::date
                AND start_time > (now() AT TIME ZONE 'Asia/Manila')::time)
       )
       AND booked_count < capacity
     RETURNING * INTO v_slot;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The selected pickup/delivery slot is no longer available.' USING ERRCODE = 'P0001';
    END IF;
    RETURN to_jsonb(v_slot);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_delivery_schedule_slot(p_schedule_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    UPDATE public.delivery_schedule_slots
       SET booked_count = GREATEST(0, booked_count - 1)
     WHERE id = p_schedule_id;
$$;

REVOKE ALL ON FUNCTION public.reserve_delivery_schedule_slot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_delivery_schedule_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_delivery_schedule_slot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_delivery_schedule_slot(uuid) TO service_role;


-- Atomic restock prevents lost updates when multiple staff members restock the same item.
CREATE OR REPLACE FUNCTION public.restock_supply_inventory(p_item_id uuid, p_quantity numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_item public.supply_inventory;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Restock quantity must be greater than zero.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.supply_inventory
       SET quantity_on_hand = quantity_on_hand + p_quantity,
           updated_at = now()
     WHERE id = p_item_id
     RETURNING * INTO v_item;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supply item not found.' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(v_item);
END;
$$;
REVOKE ALL ON FUNCTION public.restock_supply_inventory(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restock_supply_inventory(uuid, numeric) TO service_role;

-- Enable RLS on every new table.
ALTER TABLE public.delivery_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laundry_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

-- The new operational tables are accessed only through the Express APIs. The browser
-- never receives the service-role key, and direct anon/authenticated table access is
-- revoked so clients cannot bypass pricing, ownership, audit, validation, or status rules.
REVOKE ALL PRIVILEGES ON TABLE
    public.delivery_schedule_slots,
    public.water_orders,
    public.laundry_bookings,
    public.order_status_history,
    public.order_payments,
    public.supply_inventory,
    public.chat_messages,
    public.customer_notifications
FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE
    public.delivery_schedule_slots,
    public.water_orders,
    public.laundry_bookings,
    public.order_status_history,
    public.order_payments,
    public.supply_inventory,
    public.chat_messages,
    public.customer_notifications
TO service_role;

-- Schedule availability is public; management is staff/admin only.
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_schedule_slots' AND policyname = 'Anyone can view available delivery slots') THEN
        CREATE POLICY "Anyone can view available delivery slots" ON public.delivery_schedule_slots
        FOR SELECT TO anon, authenticated USING (is_active IS TRUE AND booked_count < capacity AND schedule_date >= (now() AT TIME ZONE 'Asia/Manila')::date);
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_schedule_slots' AND policyname = 'Managers can manage delivery slots') THEN
        CREATE POLICY "Managers can manage delivery slots" ON public.delivery_schedule_slots
        FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
        WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;

-- Customer-owned order reads and inserts; staff/admin can read and manage all orders.
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_orders' AND policyname = 'Users can view own water orders or managers all') THEN
        CREATE POLICY "Users can view own water orders or managers all" ON public.water_orders FOR SELECT TO authenticated
        USING (user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_orders' AND policyname = 'Customers can create own water orders') THEN
        CREATE POLICY "Customers can create own water orders" ON public.water_orders FOR INSERT TO authenticated
        WITH CHECK (user_id = (SELECT auth.uid()));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_orders' AND policyname = 'Managers can update water orders') THEN
        CREATE POLICY "Managers can update water orders" ON public.water_orders FOR UPDATE TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
        WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;

DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'laundry_bookings' AND policyname = 'Users can view own laundry bookings or managers all') THEN
        CREATE POLICY "Users can view own laundry bookings or managers all" ON public.laundry_bookings FOR SELECT TO authenticated
        USING (user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'laundry_bookings' AND policyname = 'Customers can create own laundry bookings') THEN
        CREATE POLICY "Customers can create own laundry bookings" ON public.laundry_bookings FOR INSERT TO authenticated
        WITH CHECK (user_id = (SELECT auth.uid()));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'laundry_bookings' AND policyname = 'Managers can update laundry bookings') THEN
        CREATE POLICY "Managers can update laundry bookings" ON public.laundry_bookings FOR UPDATE TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
        WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;

DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_status_history' AND policyname = 'Users can view own order status history or managers all') THEN
        CREATE POLICY "Users can view own order status history or managers all" ON public.order_status_history FOR SELECT TO authenticated
        USING (
          EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin'))
          OR (order_type = 'water' AND EXISTS (SELECT 1 FROM public.water_orders o WHERE o.id = order_id AND o.user_id = (SELECT auth.uid())))
          OR (order_type = 'laundry' AND EXISTS (SELECT 1 FROM public.laundry_bookings o WHERE o.id = order_id AND o.user_id = (SELECT auth.uid())))
        );
    END IF;
END;
$policy$;

DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_payments' AND policyname = 'Users can view own payment records or managers all') THEN
        CREATE POLICY "Users can view own payment records or managers all" ON public.order_payments FOR SELECT TO authenticated
        USING (user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_payments' AND policyname = 'Users can submit own payment records') THEN
        CREATE POLICY "Users can submit own payment records" ON public.order_payments FOR INSERT TO authenticated
        WITH CHECK (user_id = (SELECT auth.uid()));
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_payments' AND policyname = 'Managers can verify payments') THEN
        CREATE POLICY "Managers can verify payments" ON public.order_payments FOR UPDATE TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
        WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;

DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'supply_inventory' AND policyname = 'Managers can manage supply inventory') THEN
        CREATE POLICY "Managers can manage supply inventory" ON public.supply_inventory FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
        WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')));
    END IF;
END;
$policy$;

DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_messages' AND policyname = 'Users can read permitted chat messages') THEN
        CREATE POLICY "Users can read permitted chat messages" ON public.chat_messages FOR SELECT TO authenticated
        USING (
          (channel = 'internal' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
          OR (channel = 'support' AND (customer_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin'))))
        );
    END IF;
END;
$policy$;
DO $policy$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_messages' AND policyname = 'Users can send permitted chat messages') THEN
        CREATE POLICY "Users can send permitted chat messages" ON public.chat_messages FOR INSERT TO authenticated
        WITH CHECK (
          sender_id = (SELECT auth.uid())
          AND sender_role = (SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid()))
          AND (
            (channel = 'support' AND ((sender_role = 'customer' AND customer_id = (SELECT auth.uid())) OR (sender_role IN ('staff','admin') AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))))
            OR (channel = 'internal' AND sender_role IN ('staff','admin') AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role IN ('staff','admin')))
          )
        );
    END IF;
END;
$policy$;

-- Do not create or modify existing audit_logs policies here. API code writes audit entries
-- through the server-only service-role client, after authenticating/authorizing the caller.

-- Laundry billing is per 7 kg machine load, rounded up for partial loads.
-- The booking weight cap remains a separate API setting (MAX_LAUNDRY_KG).
ALTER TABLE public.laundry_bookings
    ADD COLUMN IF NOT EXISTS load_count integer NOT NULL DEFAULT 1;

UPDATE public.laundry_bookings
   SET load_count = CEIL(weight_kg / 7.0)::integer
 WHERE load_count IS NULL OR (load_count = 1 AND weight_kg > 7);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'laundry_booking_load_count_positive'
           AND conrelid = 'public.laundry_bookings'::regclass
    ) THEN
        ALTER TABLE public.laundry_bookings
            ADD CONSTRAINT laundry_booking_load_count_positive CHECK (load_count > 0);
    END IF;
END;
$$;

-- Keep the edited order and its payment amount synchronized in one transaction.
-- The API validates ownership, role, allowed fields, and payment lock before calling this
-- service-role-only function. PostgreSQL still rechecks the verified-payment lock while
-- holding the payment row lock, so concurrent verification cannot race a price edit.
CREATE OR REPLACE FUNCTION public.update_order_and_payment(
    p_order_type text,
    p_order_id uuid,
    p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_order jsonb;
    v_user_id uuid;
    v_payment_method text;
    v_amount numeric(12,2);
    v_payment_status text;
BEGIN
    IF p_order_type IS NULL OR p_order_type NOT IN ('water', 'laundry') THEN
        RAISE EXCEPTION 'order_type must be water or laundry.' USING ERRCODE = '22023';
    END IF;
    IF p_order_id IS NULL OR p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
        RAISE EXCEPTION 'A valid order id and updates object are required.' USING ERRCODE = '22023';
    END IF;

    IF p_order_type = 'laundry' THEN
        UPDATE public.laundry_bookings AS o
           SET weight_kg = CASE WHEN p_updates ? 'weight_kg' THEN (p_updates->>'weight_kg')::numeric ELSE o.weight_kg END,
               load_count = CASE WHEN p_updates ? 'load_count' THEN (p_updates->>'load_count')::integer ELSE o.load_count END,
               total_amount = CASE WHEN p_updates ? 'total_amount' THEN (p_updates->>'total_amount')::numeric ELSE o.total_amount END,
               status = CASE WHEN p_updates ? 'status' THEN p_updates->>'status' ELSE o.status END,
               notes = CASE WHEN p_updates ? 'notes' THEN p_updates->>'notes' ELSE o.notes END,
               delivery_address = CASE WHEN p_updates ? 'delivery_address' THEN p_updates->>'delivery_address' ELSE o.delivery_address END,
               delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE o.delivery_date END,
               delivery_time = CASE WHEN p_updates ? 'delivery_time' THEN (p_updates->>'delivery_time')::time ELSE o.delivery_time END,
               schedule_id = CASE WHEN p_updates ? 'schedule_id' THEN (p_updates->>'schedule_id')::uuid ELSE o.schedule_id END,
               detergent = CASE WHEN p_updates ? 'detergent' THEN p_updates->>'detergent' ELSE o.detergent END,
               fabric_conditioner = CASE WHEN p_updates ? 'fabric_conditioner' THEN p_updates->>'fabric_conditioner' ELSE o.fabric_conditioner END,
               updated_at = CASE WHEN p_updates ? 'updated_at' THEN (p_updates->>'updated_at')::timestamptz ELSE now() END
         WHERE o.id = p_order_id
         RETURNING to_jsonb(o), o.user_id, o.payment_method, o.total_amount
              INTO v_order, v_user_id, v_payment_method, v_amount;
    ELSE
        UPDATE public.water_orders AS o
           SET quantity = CASE WHEN p_updates ? 'quantity' THEN (p_updates->>'quantity')::integer ELSE o.quantity END,
               total_amount = CASE WHEN p_updates ? 'total_amount' THEN (p_updates->>'total_amount')::numeric ELSE o.total_amount END,
               status = CASE WHEN p_updates ? 'status' THEN p_updates->>'status' ELSE o.status END,
               notes = CASE WHEN p_updates ? 'notes' THEN p_updates->>'notes' ELSE o.notes END,
               delivery_address = CASE WHEN p_updates ? 'delivery_address' THEN p_updates->>'delivery_address' ELSE o.delivery_address END,
               delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE o.delivery_date END,
               delivery_time = CASE WHEN p_updates ? 'delivery_time' THEN (p_updates->>'delivery_time')::time ELSE o.delivery_time END,
               schedule_id = CASE WHEN p_updates ? 'schedule_id' THEN (p_updates->>'schedule_id')::uuid ELSE o.schedule_id END,
               updated_at = CASE WHEN p_updates ? 'updated_at' THEN (p_updates->>'updated_at')::timestamptz ELSE now() END
         WHERE o.id = p_order_id
         RETURNING to_jsonb(o), o.user_id, o.payment_method, o.total_amount
              INTO v_order, v_user_id, v_payment_method, v_amount;
    END IF;

    IF v_order IS NULL THEN
        RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_updates ? 'total_amount' THEN
        SELECT payment_status
          INTO v_payment_status
          FROM public.order_payments
         WHERE order_type = p_order_type AND order_id = p_order_id
         FOR UPDATE;

        IF FOUND THEN
            IF v_payment_status = 'verified' THEN
                RAISE EXCEPTION 'This order payment is already verified. Its quantity/weight and total can no longer be changed.'
                    USING ERRCODE = 'P0001';
            END IF;

            UPDATE public.order_payments
               SET amount = v_amount, updated_at = now()
             WHERE order_type = p_order_type AND order_id = p_order_id;
        ELSE
            INSERT INTO public.order_payments (
                order_type, order_id, user_id, payment_method, amount, payment_status
            ) VALUES (
                p_order_type, p_order_id, v_user_id, v_payment_method, v_amount, 'pending'
            );
        END IF;
    END IF;

    RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_and_payment(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_and_payment(text, uuid, jsonb) TO service_role;

-- The original audit_logs table is retained. These additive columns align the shared
-- logger with both the existing required entity_type field and the dashboard fields.
-- Existing audit history is preserved.
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL DEFAULT 'system',
    module text NOT NULL DEFAULT 'system',
    details text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS module text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE public.audit_logs SET action = 'Legacy audit event' WHERE action IS NULL OR length(trim(action)) = 0;
UPDATE public.audit_logs SET entity_type = COALESCE(NULLIF(trim(module), ''), 'legacy')
WHERE entity_type IS NULL OR length(trim(entity_type)) = 0;
UPDATE public.audit_logs SET module = 'legacy' WHERE module IS NULL OR length(trim(module)) = 0;
UPDATE public.audit_logs SET created_at = now() WHERE created_at IS NULL;

ALTER TABLE public.audit_logs ALTER COLUMN action SET DEFAULT 'System event';
ALTER TABLE public.audit_logs ALTER COLUMN action SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN entity_type SET DEFAULT 'system';
ALTER TABLE public.audit_logs ALTER COLUMN entity_type SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN module SET DEFAULT 'system';
ALTER TABLE public.audit_logs ALTER COLUMN module SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.audit_logs ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON public.audit_logs(user_id, created_at DESC);

-- Audit rows are written/read only by server APIs using the service-role client.
-- Existing RLS policies are intentionally left untouched.
