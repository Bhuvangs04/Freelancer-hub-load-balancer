const express = require("express");
require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https"); // Use for HTTPS requests
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const logger = require("./utils/logger");
const helmet = require("helmet");
const healthCheck = require("./middleware/healthCheck");
const servers = require("./config/server");

const app = express();
const proxy = httpProxy.createProxyServer();
const cors = require("cors");

// Define allowed origins
const allowedOrigins = [
  "https://freelancerhub-five.vercel.app/",
  "https://freelancer-admin.vercel.app/",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true, // Allow cookies and authentication headers
};

// Use CORS middleware
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const COOKIE_NAME = "Server_Id";
const SECRET_KEY = crypto
  .createHash("sha256")
  .update(process.env.ENCRYPTION_KEY)
  .digest();
const ALGORITHM = "aes-256-cbc";
const IV = crypto.randomBytes(16);
const RATE_LIMIT = 100;
const TIME_WINDOW = 60 * 1000;
const requestCounts = new Map();
const blockedIPs = new Set();

app.use(helmet());
app.use(cookieParser());
app.disable("x-powered-by");

// Encryption function
const encrypt = (text) => {
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY), IV);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

// Decryption function
const decrypt = (text) => {
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(SECRET_KEY),
      IV
    );
    let decrypted = decipher.update(text, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    logger.error("[DECRYPT ERROR]: Invalid cookie data");
    return null;
  }
};

// Middleware to block IPs exceeding rate limit
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (blockedIPs.has(ip)) {
    logger.warn(`Blocked IP attempted access: ${ip}`);
    return res
      .status(403)
      .send("Your IP has been blocked due to excessive requests.");
  }

  next();
});

// Rate Limiting Middleware
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, startTime: now });
  } else {
    const data = requestCounts.get(ip);
    data.count++;

    if (now - data.startTime > TIME_WINDOW) {
      requestCounts.set(ip, { count: 1, startTime: now });
    } else if (data.count > RATE_LIMIT) {
      blockedIPs.add(ip);
      logger.warn(`Blocked IP: ${ip} due to excessive requests`);
      return res
        .status(403)
        .send("Your IP has been blocked due to excessive requests.");
    }
  }
  next();
});

// Periodic health checks
setInterval(() => healthCheck(servers), 10000);

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
});

// Function to get the least loaded server
const getLeastLoadedServer = () => {
  const activeServers = servers.filter((server) => server.active);
  if (activeServers.length === 0) return null;
  return activeServers.reduce((prev, curr) =>
    prev.connections < curr.connections ? prev : curr
  );
};

// Proxy Load Balancer with Least Connections Algorithm
app.use((req, res) => {
  let assignedServer;
  const stickyServerEncrypted = req.cookies[COOKIE_NAME];

  if (stickyServerEncrypted) {
    const stickyServer = decrypt(stickyServerEncrypted);
    assignedServer = servers.find(
      (server) => server.url === stickyServer && server.active
    );
  }

  if (!assignedServer) {
    assignedServer = getLeastLoadedServer();
    if (!assignedServer) {
      logger.error("No backend servers available");
      return res.status(503).send("Service Unavailable");
    }
    const encryptedServer = encrypt(assignedServer.url);
    res.cookie(COOKIE_NAME, encryptedServer, {
      httpOnly: true, // Prevents client-side access to the cookie
      secure: true, // Ensures cookies are only sent over HTTPS
      sameSite: "None", // Required for cross-origin requests
    });
    logger.info(`Assigned new sticky server: ${assignedServer.url}`);
  } else {
    logger.info(`Sticky session for ${assignedServer.url}`);
  }

  console.log(
    `[LEAST CONNECTIONS]: Forwarding to server: ${assignedServer.url}`
  );

  assignedServer.connections++;

  proxy.web(
    req,
    res,
    { target: assignedServer.url, changeOrigin: true, agent, secure: true },
    (err) => {
      assignedServer.connections--;
      logger.error(
        `[PROXY ERROR]: Failed to forward to ${assignedServer.url}. Error: ${err.message}`
      );
      if (!res.headersSent) {
        res.status(502).json({ error: "Bad Gateway", message: err.message });
      }
    }
  );
});

// Handle proxy errors
proxy.on("error", (err, req, res) => {
  logger.error(`[PROXY ERROR]: ${err.message}`);
  res.status(500).send("Internal Proxy Error");
});

// Start the Load Balancer
const PORT = process.env.LOAD_BALANCER_PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Load balancer running on port ${PORT}`);
});
