# Web ADI (Excel) → Oracle EBS — workflow for Everde preliminary orders

**Web ADI** (Web Applications Desktop Integrator / BNE) is configured **inside Oracle E-Business Suite**, not in this Next.js app. This doc describes how to **combine** Everde exports with a standard ADI process.

## What we provide from Everde

On **Preliminary Order Checkout**, use **Download CSV (Excel / Web ADI)** — or:

`GET /api/orders/<orderNumber>/export?format=webadi`

That file:

- Opens cleanly in **Microsoft Excel** (UTF-8 with BOM).
- Has **one row per line item**, with order header fields repeated on each row (good for copy/paste).

Column names today (adjust in `src/lib/webAdiOrderCsv.ts` if your integrator expects different labels/order):

| Column | Purpose |
|--------|--------|
| Prelim_Order_Number | Internal preliminary # |
| Customer_Name, Contact, Ship_To | Header |
| PO_Number, Request_Ship_Date | Header |
| Sales_Rep_Name, Sales_Rep_Email | Header |
| Line_Number, SKU, Item_Description | Line |
| Quantity, Unit_Price, Line_Total, Currency | Line |
| Order_Status | e.g. PRELIMINARY |

## What your Oracle team sets up (one-time)

Exact menus vary by **EBS 12.2** patch and customizations. Typical building blocks:

1. **Responsibility** with access to **Desktop Integration** / **Web ADI** (or **BNE**) and the right **Order Management** functions.
2. An **integrator** (and **layout**) that maps Excel columns → the interface/API your site uses for **sales orders** or **order import** (often interface tables or API wrappers).
3. A **document** users launch from EBS that downloads the **Excel template** with the Oracle menu add-in and **validations** tied to your org.

Your functional/technical Oracle resource should confirm:

- Which **integrator** name to use (or create a new one for “preliminary / staged” orders).
- Required columns (customer id, org id, order type, line type, item id vs SKU, etc.).

## Suggested user steps (after Oracle template exists)

1. In **EBS**, open the **Web ADI** document for order entry / import (as per your procedure). Excel opens with the **Oracle** toolbar/menu.
2. In Everde checkout, **Download CSV (Excel / Web ADI)**.
3. Open that CSV in Excel (second workbook is fine).
4. **Copy** the columns from our sheet and **paste** into the **ADI template** columns that your integrator mapped (column order may differ — match by header or mapping sheet).
5. Use **Oracle → Upload** (wording varies) in Excel to send rows to EBS.
6. In EBS, run any follow-up **import / process** or review **errors** in the standard Web ADI / interface error forms.

**Tip:** Once you know the **exact column order** of the ADI layout, we can change `webAdiOrderCsv.ts` to output columns in that order (or add a second preset) so paste is one block without rearranging.

## Security note

Export URLs are **not authenticated** today (anyone who can guess an order number could download). If this app is exposed beyond a trusted network, add auth or signed tokens before relying on exports for sensitive data.

## Related downloads

| `format=` | File |
|-----------|------|
| `webadi` | Excel-friendly CSV (default) |
| `csv` | Oracle-style column names (same as email attachment) |
| `dat` | ECE PPOI-style flat file |

Example: `/api/orders/42/export?format=webadi`
