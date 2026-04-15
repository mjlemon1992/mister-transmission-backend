“use strict”;

var express    = require(“express”);
var cors       = require(“cors”);
var https      = require(“https”);
var nodemailer = require(“nodemailer”);

var app = express();
app.use(cors());
app.use(express.json());

var SM_API_KEY   = process.env.SM_API_KEY   || “”;
var SM_BASE      = “api.shopmonkey.cloud”;
var NOTIFY_EMAIL = process.env.NOTIFY_EMAIL  || “”;
var SMTP_HOST    = process.env.SMTP_HOST     || “”;
var SMTP_PORT    = process.env.SMTP_PORT     || “587”;
var SMTP_USER    = process.env.SMTP_USER     || “”;
var SMTP_PASS    = process.env.SMTP_PASS     || “”;
var PORT         = process.env.PORT          || 3000;

// Plain HTTPS helper — no node-fetch needed at all
function smPost(path, body) {
return new Promise(function(resolve, reject) {
var data = JSON.stringify(body);
var options = {
hostname: SM_BASE,
port: 443,
path: “/v3” + path,
method: “POST”,
headers: {
“Authorization”: “Bearer “ + SM_API_KEY,
“Content-Type”: “application/json”,
“Content-Length”: Buffer.byteLength(data)
}
};
var req = https.request(options, function(res) {
var chunks = [];
res.on(“data”, function(c) { chunks.push(c); });
res.on(“end”, function() {
try {
var json = JSON.parse(Buffer.concat(chunks).toString());
if (res.statusCode >= 400) {
reject(new Error(“Shopmonkey “ + path + “ failed: “ + JSON.stringify(json)));
} else {
resolve(json);
}
} catch(e) { reject(e); }
});
});
req.on(“error”, reject);
req.write(data);
req.end();
});
}

function notifyAdvisor(customer, vehicle, orderId) {
if (!SMTP_HOST || !NOTIFY_EMAIL) return Promise.resolve();
var transporter = nodemailer.createTransport({
host: SMTP_HOST,
port: Number(SMTP_PORT),
secure: false,
auth: { user: SMTP_USER, pass: SMTP_PASS }
});
return transporter.sendMail({
from:    SMTP_USER,
to:      NOTIFY_EMAIL,
subject: “New check-in: “ + customer.firstName + “ “ + customer.lastName,
html: “<h2>New Customer Check-In</h2>” +
“<p><strong>Name:</strong> “ + customer.firstName + “ “ + customer.lastName + “</p>” +
“<p><strong>Phone:</strong> “ + customer.phone + “</p>” +
“<p><strong>Email:</strong> “ + customer.email + “</p>” +
“<p><strong>Vehicle:</strong> “ + vehicle.year + “ “ + vehicle.make + “ “ + vehicle.model + “</p>” +
“<p><strong>Source:</strong> “ + customer.referralSource + “</p>” +
“<hr/><p><a href='https://app.shopmonkey.io/orders/" + orderId + "'>View Order in Shopmonkey</a></p>”
});
}

app.post(”/checkin”, function(req, res) {
var b = req.body;
if (!b.firstName || !b.lastName || !b.phone || !b.email || !b.year || !b.make || !b.model) {
return res.status(400).json({ error: “Missing required fields” });
}

smPost(”/customer”, {
firstName: b.firstName,
lastName:  b.lastName,
email:     b.email,
phone:     b.phone,
address:   { street: b.address, city: b.city, postalCode: b.postcode },
referralSource: b.source || “other”
})
.then(function(cd) {
var customerId = cd.data && cd.data.id;
return smPost(”/vehicle”, {
customerId: customerId,
year:  Number(b.year),
make:  b.make,
model: b.model
}).then(function(vd) {
var vehicleId = vd.data && vd.data.id;
return smPost(”/order”, {
customerId:  customerId,
vehicleId:   vehicleId,
name:        b.year + “ “ + b.make + “ “ + b.model + “ - “ + b.firstName + “ “ + b.lastName,
statusLabel: “Estimate”
}).then(function(od) {
var orderId = od.data && od.data.id;
return notifyAdvisor(
{ firstName: b.firstName, lastName: b.lastName, phone: b.phone, email: b.email, referralSource: b.source },
{ year: b.year, make: b.make, model: b.model },
orderId
).then(function() {
res.json({ success: true, customerId: customerId, vehicleId: vehicleId, orderId: orderId });
});
});
});
})
.catch(function(err) {
console.error(err);
res.status(500).json({ error: err.message });
});
});

app.get(”/health”, function(req, res) {
res.json({ status: “ok” });
});

app.listen(PORT, function() {
console.log(“Server running on port “ + PORT);
});
