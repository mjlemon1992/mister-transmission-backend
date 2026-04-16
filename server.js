var express = require("express");
var cors = require("cors");
var https = require("https");

var app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

var SM_API_KEY = (process.env.SM_API_KEY || "").trim();
var SM_BASE = "api.shopmonkey.cloud";
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

app.post("/checkin", function(req, res) {
  var b = req.body;
  var missing = !b.firstName || !b.lastName || !b.phone;
  missing = missing || !b.email || !b.year || !b.make || !b.model;
  if (missing) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  var customerPayload = {
    customerType: "Customer",
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
      model: b.model,
      size: "LightDuty"
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
        res.json({
          success: true,
          customerId: customerId,
          vehicleId: vehicleId,
          orderId: orderId
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
