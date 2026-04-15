const express    = require(“express”);
const cors       = require(“cors”);
const fetch      = require(“node-fetch”);
const nodemailer = require(“nodemailer”);

const app = express();
app.use(cors());
app.use(express.json());

// ── env vars (set these in Railway) ─────────────────────────────────────────
const SM_API_KEY   = process.env.SM_API_KEY;
const SM_BASE      = “https://api.shopmonkey.cloud/v3”;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const SMTP_HOST    = process.env.SMTP_HOST;
const SMTP_PORT    = process.env.SMTP_PORT || 587;
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const PORT         = process.env.PORT || 3000;

// ── helper: call Shopmonkey ──────────────────────────────────────────────────
async function smPost(path, body) {
const res = await fetch(`${SM_BASE}${path}`, {
method: “POST”,
headers: {
“Authorization”: `Bearer ${SM_API_KEY}`,
“Content-Type”:  “application/json”,
},
body: JSON.stringify(body),
});
const json = await res.json();
if (!res.ok) throw new Error(`Shopmonkey ${path} failed: ${JSON.stringify(json)}`);
return json;
}

// ── helper: send advisor email ───────────────────────────────────────────────
async function notifyAdvisor(customer, vehicle, orderId) {
if (!SMTP_HOST || !NOTIFY_EMAIL) return;
const transporter = nodemailer.createTransport({
host: SMTP_HOST,
port: Number(SMTP_PORT),
secure: false,
auth: { user: SMTP_USER, pass: SMTP_PASS },
});
await transporter.sendMail({
from:    SMTP_USER,
to:      NOTIFY_EMAIL,
subject: `New customer check-in: ${customer.firstName} ${customer.lastName}`,
html: `<h2>New Customer Check-In</h2> <p><strong>Name:</strong> ${customer.firstName} ${customer.lastName}</p> <p><strong>Phone:</strong> ${customer.phone}</p> <p><strong>Email:</strong> ${customer.email}</p> <p><strong>Vehicle:</strong> ${vehicle.year} ${vehicle.make} ${vehicle.model}</p> <p><strong>Heard about us via:</strong> ${customer.referralSource}</p> <hr/> <p>A repair order has been created in Shopmonkey.</p> <p><a href="https://app.shopmonkey.io/orders/${orderId}">View Order in Shopmonkey &rarr;</a></p>`,
});
}

// ── main route ───────────────────────────────────────────────────────────────
app.post(”/checkin”, async (req, res) => {
const { firstName, lastName, address, city, postcode,
phone, email, year, make, model, source } = req.body;

if (!firstName || !lastName || !phone || !email || !year || !make || !model) {
return res.status(400).json({ error: “Missing required fields” });
}

try {
// 1. Create customer
const customerData = await smPost(”/customer”, {
firstName,
lastName,
email,
phone,
address: { street: address, city, postalCode: postcode },
referralSource: source || “other”,
});
const customerId = customerData.data && customerData.data.id;

```
// 2. Create vehicle
const vehicleData = await smPost("/vehicle", {
  customerId,
  year: Number(year),
  make,
  model,
});
const vehicleId = vehicleData.data && vehicleData.data.id;

// 3. Create repair order
const orderData = await smPost("/order", {
  customerId,
  vehicleId,
  name: `${year} ${make} ${model} — ${firstName} ${lastName}`,
  statusLabel: "Estimate",
});
const orderId = orderData.data && orderData.data.id;

// 4. Email advisor
await notifyAdvisor(
  { firstName, lastName, phone, email, referralSource: source },
  { year, make, model },
  orderId
);

return res.json({ success: true, customerId, vehicleId, orderId });
```

} catch (err) {
console.error(err);
return res.status(500).json({ error: err.message });
}
});

// ── health check ─────────────────────────────────────────────────────────────
app.get(”/health”, function(_req, res) { res.json({ status: “ok” }); });

app.listen(PORT, function() {
console.log(“Server running on port “ + PORT);
});
