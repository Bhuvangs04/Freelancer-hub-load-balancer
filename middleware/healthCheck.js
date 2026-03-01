const axios = require("axios");
const logger = require("../utils/logger");

module.exports = async function healthCheck(servers) {
  const timeout = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 2500);

  await Promise.allSettled(
    servers.map(async (server) => {
      try {
        const response = await axios.get(`${server.url}/health`, { timeout });
        server.active = response.status >= 200 && response.status < 300;
        if (!server.active) {
          logger.warn(`Health check non-2xx for ${server.id}`);
        }
      } catch (err) {
        server.active = false;
        logger.warn(`Health check failed for ${server.id}`);
      }
    })
  );
};
