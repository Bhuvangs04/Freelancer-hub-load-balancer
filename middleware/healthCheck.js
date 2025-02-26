const axios = require("axios");
const logger = require("../utils/logger");

module.exports = async function healthCheck(servers) {
  for (const server of servers) {
    try {
      const response = await axios.get(`${server.url}/health`);
      server.active = response.status === 200;
      logger.info(`Server ${server.url} is healthy.`);
    } catch (err) {
      server.active = false;
      logger.error(`Server ${server.url} is down.`);
    }
  }
};
