const urls = (
  process.env.BACKEND_URLS ||
  "https://freelancer-hub-backend.onrender.com,https://onsite-backend-com.onrender.com,https://backend-onsite-com-2.onrender.com"
)
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const validUrls = urls.filter(isValidHttpUrl);

if (!validUrls.length) {
  throw new Error("No valid BACKEND_URLS configured");
}

const servers = validUrls.map((url, index) => ({
  id: `backend-${index + 1}`,
  url,
  active: true,
  connections: 0,
}));

module.exports = servers;
