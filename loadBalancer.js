const express = require("express");
require("dotenv").config();
const httpProxy = require("http-proxy");
const http = require("http");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const logger = require("./utils/logger");
const helmet = require("helmet");
const healthCheck = require("./middleware/healthCheck");
const servers = require("./config/server");

const app = express();
const proxy = httpProxy.createProxyServer();

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

let currentServerIndex = 0;
app.use(helmet());

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

// Middleware for parsing cookies
app.use(cookieParser());
app.disable("x-powered-by"); // Removes "X-Powered-By" header
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  res.setHeader("X-Frame-Options", "DENY");
  res.removeHeader("host");
  next();
});

// Middleware to check if an IP is blocked
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

// Periodic unblocking of IPs
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now - data.startTime > TIME_WINDOW) {
      requestCounts.delete(ip);
      blockedIPs.delete(ip);
      logger.info(`Unblocked IP: ${ip}`);
    }
  }
}, TIME_WINDOW);

// Periodic health checks
setInterval(() => healthCheck(servers), 10000);

const agent = new http.Agent({
  keepAlive: true, // Keep the connection open for reuse
  maxSockets: 100, // Maximum concurrent connections per backend server
  maxFreeSockets: 10, // Allow idle connections
});

// Proxy Load Balancer
app.use((req, res) => {
  let assignedServer;

  // Check for sticky session
  const stickyServerEncrypted = req.cookies[COOKIE_NAME];
  if (stickyServerEncrypted) {
    const stickyServer = decrypt(stickyServerEncrypted);
    assignedServer = servers.find(
      (server) => server.url === stickyServer && server.active
    );
  }

  // Assign a new server if needed
  if (!assignedServer) {
    const activeServers = servers.filter((server) => server.active);
    if (activeServers.length === 0) {
      logger.error("No backend servers available");
      return res.status(503).send("Service Unavailable");
    }

    assignedServer = activeServers[currentServerIndex];
    currentServerIndex = (currentServerIndex + 1) % activeServers.length;

    // Encrypt and set sticky session
    const encryptedServer = encrypt(assignedServer.url);
    res.cookie(COOKIE_NAME, encryptedServer, { httpOnly: true });
    logger.info(`Assigned new sticky server: ${assignedServer.url}`);
  } else {
    logger.info(`Sticky session for ${assignedServer.url}`);
  }

  console.log(`[STICKY SERVER]: Forwarding to server: ${assignedServer.url}`);

  // Forward request
  proxy.web(
    req,
    res,
    {
      target: assignedServer.url,
      changeOrigin: true,
      agent,
    },
    (err) => {
      logger.error(
        `[PROXY ERROR]: Failed to forward to ${assignedServer.url}. Error: ${err.message}`
      );
      res.status(500).send("Error forwarding the request.");
    }
  );
});

// Handle proxy errors properly
proxy.on("error", (err, req, res) => {
  logger.error(`[PROXY ERROR]: ${err.message}`);
  res.status(500).send("Internal Proxy Error");
});

// Start the Load Balancer
const PORT = process.env.LOAD_BALANCER_PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Load balancer running on port ${PORT}`);
});
