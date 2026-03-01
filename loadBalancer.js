const express = require("express");
require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const logger = require("./utils/logger");
const helmet = require("helmet");
const healthCheck = require("./middleware/healthCheck");
const servers = require("./config/server");
const cors = require("cors");

const app = express();
const proxy = httpProxy.createProxyServer({
  xfwd: true,
  proxyTimeout: Number(process.env.PROXY_TIMEOUT_MS || 10000),
  timeout: Number(process.env.CLIENT_TIMEOUT_MS || 12000),
});

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "https://freelancerhub-five.vercel.app,https://freelancer-admin.vercel.app"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

const COOKIE_NAME = "LB_Affinity";
const STICKY_COOKIE_TTL_MS = Number(process.env.STICKY_COOKIE_TTL_MS || 60 * 60 * 1000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 150);
const TIME_WINDOW = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const BLOCK_TTL_MS = Number(process.env.BLOCK_TTL_MS || 10 * 60 * 1000);
const HEALTH_CHECK_INTERVAL_MS = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 10000);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 30000);
const STICKY_SECRET = process.env.STICKY_SECRET || process.env.ENCRYPTION_KEY;

if (!STICKY_SECRET) {
  throw new Error("Missing STICKY_SECRET (or ENCRYPTION_KEY fallback)");
}

const requestCounts = new Map();
const blockedIPs = new Map();

app.set("trust proxy", true);
app.use(helmet());
app.use(cookieParser());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.disable("x-powered-by");

const sign = (value) =>
  crypto.createHmac("sha256", STICKY_SECRET).update(value).digest("base64url");

const createStickyToken = (serverId) => {
  const payload = `${serverId}.${Date.now() + STICKY_COOKIE_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
};

const parseStickyToken = (token) => {
  if (!token || typeof token !== "string") return null;
  const [id, exp, signature] = token.split(".");
  if (!id || !exp || !signature) return null;
  const payload = `${id}.${exp}`;
  if (sign(payload) !== signature) return null;
  if (Number(exp) < Date.now()) return null;
  return id;
};

const getClientIp = (req) => req.ip || req.socket.remoteAddress;

for (const server of servers) {
  if (typeof server.connections !== "number") {
    server.connections = 0;
  }
}

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: Number(process.env.MAX_UPSTREAM_SOCKETS || 500),
  maxFreeSockets: Number(process.env.MAX_FREE_SOCKETS || 100),
});

const getLeastLoadedServer = () => {
  const activeServers = servers.filter((server) => server.active);
  if (!activeServers.length) return null;
  return activeServers.reduce((prev, curr) =>
    prev.connections <= curr.connections ? prev : curr
  );
};

app.use((req, res, next) => {
  const ip = getClientIp(req);
  const blockedUntil = blockedIPs.get(ip);

  if (blockedUntil && blockedUntil > Date.now()) {
    return res.status(429).send("Too many requests");
  }

  if (blockedUntil) {
    blockedIPs.delete(ip);
  }

  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now - record.startTime > TIME_WINDOW) {
    requestCounts.set(ip, { count: 1, startTime: now });
    return next();
  }

  record.count += 1;

  if (record.count > RATE_LIMIT) {
    blockedIPs.set(ip, now + BLOCK_TTL_MS);
    logger.warn(`Rate limit block applied for IP=${ip}`);
    return res.status(429).send("Too many requests");
  }

  return next();
});

setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of requestCounts.entries()) {
    if (now - record.startTime > TIME_WINDOW) requestCounts.delete(ip);
  }

  for (const [ip, blockedUntil] of blockedIPs.entries()) {
    if (blockedUntil <= now) blockedIPs.delete(ip);
  }
}, CLEANUP_INTERVAL_MS);

setInterval(() => {
  healthCheck(servers);
}, HEALTH_CHECK_INTERVAL_MS);

proxy.on("proxyReq", (proxyReq) => {
  if (process.env.UPSTREAM_SHARED_SECRET) {
    proxyReq.setHeader("x-lb-auth", process.env.UPSTREAM_SHARED_SECRET);
  }
  proxyReq.setHeader("x-forwarded-proto", "https");
});

proxy.on("error", (err, req, res) => {
  logger.error(`[PROXY ERROR]: ${err.message}`);
  if (!res.headersSent) {
    res.status(502).json({ error: "Bad Gateway" });
  }
});

app.use((req, res) => {
  let assignedServer;
  const stickyId = parseStickyToken(req.cookies[COOKIE_NAME]);

  if (stickyId) {
    assignedServer = servers.find(
      (server) => server.id === stickyId && server.active
    );
  }

  if (!assignedServer) {
    assignedServer = getLeastLoadedServer();
    if (!assignedServer) {
      logger.error("No backend servers available");
      return res.status(503).send("Service Unavailable");
    }

    res.cookie(COOKIE_NAME, createStickyToken(assignedServer.id), {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: STICKY_COOKIE_TTL_MS,
    });
  }

  assignedServer.connections += 1;

  const releaseConnection = () => {
    assignedServer.connections = Math.max(0, assignedServer.connections - 1);
  };

  res.on("close", releaseConnection);
  res.on("finish", releaseConnection);

  proxy.web(req, res, {
    target: assignedServer.url,
    changeOrigin: true,
    agent,
    secure: true,
  });
});

const PORT = Number(process.env.LOAD_BALANCER_PORT || 4000);
app.listen(PORT, () => {
  logger.info(`Load balancer running on port ${PORT}`);
});
