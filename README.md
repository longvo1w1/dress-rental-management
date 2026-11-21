# Dress Rental Management

Independent dress-rental management application; **not connected to 79 Sports production**.

**Stage:** early MVP; not ready to manage real employees/customers or government IDs. Business-rule test coverage is partial. See [P0 completion work](https://github.com/longvo1w1/dress-rental-management/issues/1).

## Technology
- React 19 / Vite / TypeScript interface
- Express + MongoDB backend
- Cloudinary signed product photo upload
- Vitest business-rule tests / GitHub Actions validation
- Vietnamese mobile-friendly interface

## Local development

Requirements: Node.js 22+, a MongoDB replica set (local or isolated Atlas DEV), and Cloudinary image storage.

1. Copy \`.env.example\` to \`.env\`.
2. Fill \`MONGODB_URI\`, \`MONGODB_DB\`, \`FRONTEND_URL\`, \`ADMIN_USERNAME\`, \`ADMIN_PASSWORD\` (12+ characters), \`COOKIE_SECRET\` (32+ characters), \`CLOUDINARY_CLOUD_NAME\`, \`CLOUDINARY_API_KEY\` and \`CLOUDINARY_API_SECRET\`.
3. Choose a **new, separate database** (e.g. \`dress_rental_dev\`). Never use 79 Sports credentials or its production database.
4. Run \`npm install\` then \`npm run dev\`. Open \`http://localhost:5173\`.
5. Verify \`npm run typecheck && npm test && npm run build\`.

The MongoDB instance must support transactions; standalone MongoDB without a replica set is not supported for booking confirmation.

## Workflow covered by the first code iteration
- Online / walk-in order with wearing day, contact, products and alteration/rewash notes
- Each dress's listed rental price and separate replacement value
- Inventory-date collision protection through uniquely indexed per-product per-calendar-day slots and MongoDB transaction
- Payment method cash / bank transfer
- Under 300k: zero standard deposit and required CCCD two-side **manual confirmation flag** (secure image upload still pending)
- Above 300k: 500k collateral to be collected at pickup, plus upfront rental payment
- Provincial rentals: same listed rental price and deposit equal to replacement value of the **dress**, due before dispatch; South / Central / North calculated -2 / -3 / -4 calendar days
- Tomorrow's handover / dispatch / preparation board, listing dress, shoes, bag and accessories
- Separately tracked rental receipts and refundable collateral receipts/refunds
- Product image upload using Cloudinary signed upload response

**Not yet shipped:** actual secure CCCD file handling; ported employee, permissions, attendance, schedules, payroll and manager/admin approval; full item-by-item return inspection and photo evidence; polished photo gallery management; production deployment. The current temporary admin login is only for initial development.

## Important business rules / no assumptions
- Exact 300,000 VND policy is **undefined** and blocked at order creation.
- Only **one dress per order** until the user approves a multi-dress policy; optional shoes/bags/accessories may be added. Deposit thresholds use the dress's listed price, not the accessory-inclusive total.
- No standard rental duration, overdue fee, cancellation fee or damage-deduction amount has been assumed.
- The user provides wearing day, local handover day and expected return day; provincial handover/dispatch day is computed by region.
- Do not treat refundable deposits as rental revenue.
- Never upload secrets, customer records, ID document images or employee payroll data to GitHub.

## Deployment
No production environment was created, modified or deployed. Use distinct hosting services and database only after HR, privacy and end-to-end acceptance gates pass.

## Repository privacy
The GitHub repository was observed as **Public** on creation. Change its visibility to **Private** before adding internal operational code, private information or business datasets.
