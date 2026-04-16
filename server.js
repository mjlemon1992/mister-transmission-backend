var express = require("express");
var cors = require("cors");
var https = require("https");
var nodemailer = require("nodemailer");

var app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

var SM_API_KEY = (process.env.SM_API_KEY || "").trim();
var SM_BASE = "api.shopmonkey.cloud";
var NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";
var SMTP_HOST = process.env.SMTP_HOST || "";
var SMTP_PORT = process.env.SMTP_PORT || "587";
var SMTP_USER = process.env.SMTP_USER || "";
var SMTP_PASS = process.env.SMTP_PASS || "";
var PORT = process.env.PORT || 3000;

function smPost(path, body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var options = {
      hostname: SM_BASE,
      port: 443,
      path: "/v3" + path,
      method: "POST",
      headers: {
        "Authorization": "Bearer " + SM_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    };
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on("data", function(c) {
        chunks.push(c);
      });
      res.on("end", function() {
        try {
          var json = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode >= 400) {
            reject(new Error("Shopmonkey error: " + JSON.stringify(json)));
          } else {
            resolve(json);
          }
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function buildEmail(c, v, orderId) {
  var name = c.firstName + " " + c.lastName;
  var vehicle = v.year + " " + v.make + " " + v.model;
  var link = "https://app.shopmonkey.io/orders/" + orderId;
  var html = "<h2>New Customer Check-In</h2>";
  html += "<p><strong>Name:</strong> " + name + "</p>";
  html += "<p><strong>Phone:</strong> " + c.phone + "</p>";
  html += "<p><strong>Email:</strong> " + c.email + "</p>";
  html += "<p><strong>Vehicle:</strong> " + vehicle + "</p>";
  html += "<p><strong>Source:</strong> " + c.referralSource + "</p>";
  html += "<hr/>";
  html += "<p><a href=" + link + ">View Order in Shopmonkey</a></p>";
  return html;
}

function notifyAdvisor(customer, vehicle, orderId) {
  if (!SMTP_HOST || !NOTIFY_EMAIL) {
    return Promise.resolve();
  }
  var transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
  var subject = "New check-in: " + customer.firstName + " " + customer.lastName;
  return transporter.sendMail({
    from: SMTP_USER,
    to: NOTIFY_EMAIL,
    subject: subject,
    html: buildEmail(customer, vehicle, orderId)
  });
}

app.post("/checkin", function(req, res) {
  var b = req.body;
  var missing = !b.firstName || !b.lastName || !b.phone;
  missing = missing || !b.email || !b.year || !b.make || !b.model;
  if (missing) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  var customerPayload = {
    customerType: "customer",
    firstName: b.firstName,
    lastName: b.lastName,
    email: b.email,
    phone: b.phone,
    address: {
      street: b.address,
      city: b.city,
      postalCode: b.postcode
    },
    referralSource: b.source || "other"
  };
  smPost("/customer", customerPayload)
  .then(function(cd) {
    var customerId = cd.data && cd.data.id;
    var vehiclePayload = {
      customerId: customerId,
      year: Number(b.year),
      make: b.make,
      model: b.model
    };
    return smPost("/vehicle", vehiclePayload)
    .then(function(vd) {
      var vehicleId = vd.data && vd.data.id;
      var orderName = b.year + " " + b.make + " " + b.model;
      orderName += " - " + b.firstName + " " + b.lastName;
      var orderPayload = {
        customerId: customerId,
        vehicleId: vehicleId,
        name: orderName,
        statusLabel: "Estimate"
      };
      return smPost("/order", orderPayload)
      .then(function(od) {
        var orderId = od.data && od.data.id;
        var cust = {
          firstName: b.firstName,
          lastName: b.lastName,
          phone: b.phone,
          email: b.email,
          referralSource: b.source
        };
        var veh = {
          year: b.year,
          make: b.make,
          model: b.model
        };
        return notifyAdvisor(cust, veh, orderId)
        .then(function() {
          res.json({
            success: true,
            customerId: customerId,
            vehicleId: vehicleId,
            orderId: orderId
          });
        });
      });
    });
  })
  .catch(function(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
});

app.get("/health", function(req, res) {
  res.json({ status: "ok" });
});

app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
});
