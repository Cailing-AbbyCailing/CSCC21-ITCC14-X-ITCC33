# ACS API server structure

One central Express process listens on `PORT` (default 3000). Start with `npm start` from this `backend` directory.

- `auth-users-api` — authentication, profiles, and staff/user management through `profiles`.
- `services-pricing-api` — public Water/Laundry catalog through `inventory`; Printing is not customer-orderable.
- `orders-fulfillment-api` — Online orders, staff-entered Walk-in transactions, payments, status tracking, per-order scheduling, and customer notifications through `orders`, `payments`, and `audit_logs`.
- `inventory-customer-api` — Water/Laundry catalog stock and staff/admin Printing supplies through `inventory`; customer records/history through `profiles` and `orders`.
- `analytics-audit-api` — dashboard analytics from `orders`, `payments`, `profiles`, `inventory`; audit history from `audit_logs`.

## Five existing public tables only

| Table | Function |
|---|---|
| `profiles` | Customer, staff, admin profiles and roles |
| `inventory` | Water/Laundry catalog and Printing supplies |
| `orders` | Unified Online and Walk-in Water/Laundry transactions |
| `payments` | Payment records linked to `orders.id` |
| `audit_logs` | Audit trail, order status history, stock movements, payment verification and notification events |

The code intentionally uses the supplied original column set. `orders.order_details` and `audit_logs.details` are JSONB fields for structured details that do not have dedicated columns. No new table or column is required by the runtime API.
