## LOAD BALANCER 

### Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Usage](#usage)
6. [Security Features](#security-features)
7. [Logging](#logging)
8. [Health Checks](#health-checks)
9. [License](#license)



## Overview

This project implements a load balancer using Node.js and Express. It distributes incoming traffic across multiple backend servers using round-robin and sticky session mechanisms. It also includes security features such as rate limiting, IP blocking, and encrypted session management.

## Features

🚀 **Round-robin load balancing**

🍪 **Sticky sessions using encrypted cookies**

🛡️ **Rate limiting and IP blocking**

🩺 **Health check monitoring for backend servers**

🔒 **Secure proxy with Helmet and custom security headers**

🔄 **Periodic unblocking of IPs**

## Prerequisites

- Node.js (>=14.x)
- npm or yarn
- Environment variables configured in a .env file

## Installation

Clone the repository:

```bash
git clone <repository-url>
cd <repository-folder>
```

Install dependencies:

```bash
npm install
```

Create a .env file with the required environment variables:

```env
LOAD_BALANCER_PORT=4000
ENCRYPTION_KEY=your_secret_key
```

Configure backend servers in `config/server.js`:

```javascript
module.exports = [
    { url: "http://localhost:5000", active: true },
    { url: "http://localhost:5001", active: true }
];
```

## Usage

To start the load balancer, run:

```bash
npm start
```

This will launch the load balancer on the specified port.

## Security Features

- **Rate Limiting**: Limits requests to prevent abuse (100 requests per minute per IP).
- **IP Blocking**: Blocks abusive IPs temporarily.
- **Sticky Sessions**: Ensures a user remains connected to the same backend server using encrypted cookies.
- **Secure Headers**: Uses helmet to set security-related HTTP headers.

## Logging

Logs are generated for debugging and monitoring purposes using the custom logger located in `utils/logger.js`.

## Health Checks

The load balancer periodically checks the health of backend servers every 10 seconds.

## License

This project is open-source and available under the MIT License.



