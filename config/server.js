const urls = (
  process.env.BACKEND_URLS ||
  "https://freelancer-hub-backend.onrender.com,https://onsite-backend-com.onrender.com,https://backend-onsite-com-2.onrender.com"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const servers = urls.map((url, index) => ({
  id: `backend-${index + 1}`,
  url,
  active: true,
  connections: 0,
}));

module.exports = servers;
