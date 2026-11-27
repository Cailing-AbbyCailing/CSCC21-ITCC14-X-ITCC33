# yo





## Database contract

The runtime API reads/writes only these existing `public` tables:

* `profiles`
* `inventory`
* `orders`
* `payments`
* `audit\_logs`



## Setup

1. Copy the project's private `.env` beside this README. Do not commit or send it.
2. Ensure it contains `SUPABASE\_URL`, `SUPABASE\_ANON\_KEY`, and `SUPABASE\_SERVICE\_ROLE\_KEY`.
3. From `backend/`, run `npm install`, `npm run check`, and `npm test`.
4. Follow `backend/supabase/README\_MIGRATION.md` before running the SQL cleanup.
5. Start the single API process with `npm start` (default `http://localhost:3000`).



Client-facing service catalog exposes Water and Laundry only.

* Printing is staff/admin inventory management only.
* Online customers submit Water/Laundry orders; staff/admin encode Walk-in transactions.
* `transaction\_source` (`Online` / `Walk-in`) is stored separately from `service\_arrangement` inside `orders.order\_details`.
* The four Water and four Laundry arrangements are validated; staff-only Walk-in Refill \& Pickup and Drop-off \& Pickup cannot be submitted by customers online.
* Water pricing is read from `inventory.selling\_price`. Bulk Water Refill is Walk-in only and requires at least 10 gallons. Configure catalog rows to the MasterFile's ₱15 regular refill, ₱10 bulk refill, and usual ₱30 delivered rate; no distance formula is invented.
* Laundry pricing is calculated by 7 kg loads, rounding partial loads up. There is no invented overall booking limit.
* Detergent, conditioner, and optional bleach selections are validated against Laundry inventory.
* Per-order pickup/delivery date and time is stored in `orders.scheduled\_at`; no separate capacity-slot table is required by the MasterFile.
* Laundry-ready notifications start the seven-day pickup period. The MasterFile does not specify the storage-fee amount, so the API does not invent one.



check `backend/INTEGRATION\_GUIDE.md` for route list, request examples, authentication headers, and  frontend connection checklist

