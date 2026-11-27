Base URL for local development: `http://localhost:3000`

All protected routes require:

```http
Authorization: Bearer <supabase\_access\_token>
Content-Type: application/json
```

Never put `SUPABASE\_SERVICE\_ROLE\_KEY` in frontend code. The browser only receives the Supabase access token from login/register.

## Authentication and profile

|Method|Endpoint|Access|
|-|-|-|
|POST|`/api/auth/register`|Public customer registration|
|POST|`/api/auth/login`|Public login|
|POST|`/api/auth/refresh`|Refresh token|
|POST|`/api/auth/logout`|Authenticated|
|GET|`/api/auth/session`|Authenticated|
|GET|`/api/users/me`|Authenticated|
|PUT|`/api/users/me`|Authenticated|
|GET|`/api/users/customers`|Staff/admin|
|GET|`/api/users/staff`|Admin|
|POST|`/api/users/staff`|Admin|

Register/login responses return `access\_token`, `refresh\_token`, and `user`. Store tokens securely according to the frontend's session design; send the access token as the Bearer token on protected requests.

## Client catalog

|Method|Endpoint|Access|
|-|-|-|
|GET|`/api/services?service\_type=Water`|Public|
|GET|`/api/services?service\_type=Laundry`|Public|
|GET|`/api/services/:id`|Public|

The public catalog returns only available Water/Laundry rows from `inventory`. Do not show Printing as a customer order service. Detergent, conditioner, and bleach options should be loaded from Laundry inventory and passed as their inventory IDs.

## Online orders (customer portal)

`POST /api/orders` creates an Online transaction. The API sets `transaction\_source` to `Online` from the authenticated profile; do not send a Walk-in source from the browser.

Example Water order:

```json
{
  "service\_type": "Water",
  "service\_arrangement": "home\_pickup\_delivery",
  "service\_id": "<water-inventory-uuid>",
  "quantity": 2,
  "pickup\_address": "Customer pickup address",
  "delivery\_address": "Delivery address",
  "scheduled\_at": "2026-12-01T09:00:00+08:00",
  "payment\_method": "Cash on Delivery (COD)",
  "notes": "Please call on arrival"
}
```

Example Laundry order:

```json
{
  "service\_type": "Laundry",
  "service\_arrangement": "drop\_off\_home\_delivery",
  "service\_id": "<laundry-service-inventory-uuid>",
  "weight\_kg": 8,
  "delivery\_address": "Delivery address",
  "scheduled\_at": "2026-12-01T10:00:00+08:00",
  "payment\_method": "Cash on Delivery (COD)",
  "detergent\_id": "<laundry-detergent-inventory-uuid>",
  "fabric\_conditioner\_id": "<laundry-conditioner-inventory-uuid>",
  "bleach\_requested": false,
  "notes": "Handle delicate fabrics carefully"
}
```

Laundry is priced by 7 kg loads; 8 kg is charged as two loads. `service\_id` identifies the Laundry service/pricing row. Product choices must reference available Laundry inventory items. Bleach is optional and only accepted when `bleach\_requested` is true.

The four valid Water arrangements are `walk\_in\_refill\_pickup` (staff-only), `walk\_in\_refill\_delivery`, `home\_pickup\_delivery`, and `home\_pickup\_station\_pickup`. The four Laundry arrangements are `drop\_off\_pickup` (staff-only), `drop\_off\_home\_delivery`, `home\_pickup\_return\_delivery`, and `home\_pickup\_station\_pickup`.

## Staff/admin transactions and orders

|Method|Endpoint|Access|
|-|-|-|
|POST|`/api/transactions`|Staff/admin; records Walk-in|
|GET|`/api/transactions`|Staff/admin; unified transaction list|
|GET|`/api/orders`|Customer's own orders; staff/admin can see all|
|GET|`/api/orders/:id`|Owner or staff/admin|
|PATCH/PUT|`/api/orders/:id`|Owner (own notes) or staff/admin (status/schedule)|
|DELETE|`/api/orders/:id`|Owner or staff/admin; cancellable statuses only|
|GET|`/api/delivery-schedules`|Staff/admin; queue derived from `orders.scheduled\_at`|
|PATCH|`/api/delivery-schedules/:orderId`|Staff/admin; body `{ "scheduled\_at": "..." }`|
|DELETE|`/api/delivery-schedules/:orderId`|Staff/admin; clears the order's schedule|

For Walk-in encoding, send the same Water/Laundry fields to `POST /api/transactions`, plus `customer\_name` when there is no linked customer profile. `customer\_id` is optional. The API sets `transaction\_source` to `Walk-in`.

Transaction source and service arrangement are separate properties in the API response. In the database both are stored inside the existing `orders.order\_details` JSONB object to avoid changing the original table columns.

## Payments and notifications

|Method|Endpoint|Access|
|-|-|-|
|POST|`/api/payments`|Owner or staff/admin|
|GET|`/api/payments/:id`|Owner or staff/admin|
|PATCH|`/api/payments/:id/status`|Staff/admin; `verification\_note` required for verified/rejected|
|GET|`/api/notifications`|Authenticated customer|
|PATCH|`/api/notifications/:id/read`|Notification owner|

The `payments` table's existing columns are used as-is. Receipt URLs and verification notes are retained as JSON in `audit\_logs.details`, not as new payment columns. Notification events/read state are represented in `audit\_logs`.

## Inventory, customers, and reports

|Method|Endpoint|Access|
|-|-|-|
|GET/POST|`/api/inventory`|Staff/admin|
|GET/PATCH/PUT|`/api/inventory/:id`|Staff/admin|
|POST|`/api/inventory/:id/stock-movements`|Staff/admin; `{ "direction": "IN"|
|POST|`/api/inventory/:id/restock`|Staff/admin|
|POST|`/api/inventory/:id/stock-out`|Staff/admin|
|DELETE|`/api/inventory/:id`|Admin; archives by setting availability false|
|GET|`/api/customers`|Staff/admin|
|GET|`/api/customers/:id/orders`|Staff/admin|
|GET|`/api/analytics/overview`|Admin|
|GET|`/api/analytics/revenue`|Admin|
|GET|`/api/analytics/services`|Admin|
|GET|`/api/audit-logs`|Admin|

Low-stock status uses `LOW\_STOCK\_THRESHOLD` (default 5) because the original `inventory` table has no reorder-level column. Change the environment variable if the team agrees on another threshold.



1. Pull/use this backend folder and keep the existing frontend branch unchanged.
2. Add the local API base URL `http://localhost:3000` in frontend configuration.
3. On login/register, retain the returned access token and send it as `Authorization: Bearer ...` on protected requests.
4. Load Water/Laundry dropdown choices from `GET /api/services`; load detergent/conditioner/bleach from Laundry inventory choices rather than hardcoded generic values.
5. Submit online customer orders to `POST /api/orders`; staff-entered walk-ins go to `POST /api/transactions`.
6. Read customer tracking from `GET /api/orders` and staff transaction management from `GET /api/transactions`.
7. Use the order `id` returned by create for subsequent status/payment/notification requests.
8. Confirm CORS `CORS\_ORIGINS` includes the frontend's local origin.
9. Do not expose the service-role secret in browser code.

