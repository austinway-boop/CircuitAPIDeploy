const fs = require('fs');
const path = require('path');

const USAGE_FILE = path.join(__dirname, 'key-usage.json');

// In-memory cache
let usageData = {};
let serverStartTime = Date.now();

// Load usage data on startup
function loadUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      usageData = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load usage data:', error);
    usageData = {};
  }
}

// Save usage data periodically
function saveUsage() {
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usageData, null, 2));
  } catch (error) {
    console.error('Failed to save usage data:', error);
  }
}

// Track API key usage
function trackKeyUsage(keyHash) {
  if (!usageData[keyHash]) {
    usageData[keyHash] = {
      requests: 0,
      lastUsed: null,
      firstUsed: new Date().toISOString()
    };
  }
  
  usageData[keyHash].requests++;
  usageData[keyHash].lastUsed = new Date().toISOString();
  
  // Save every 10 requests
  if (usageData[keyHash].requests % 10 === 0) {
    saveUsage();
  }
}

// Get usage for a key
function getKeyUsage(keyHash) {
  return usageData[keyHash] || {
    requests: 0,
    lastUsed: null,
    firstUsed: null
  };
}

// Get total stats
function getTotalStats() {
  const totalRequests = Object.values(usageData).reduce((sum, data) => sum + data.requests, 0);
  const uptimeSeconds = (Date.now() - serverStartTime) / 1000;
  const uptimeHours = uptimeSeconds / 3600;
  
  return {
    totalRequests,
    uptime: uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    serverStartTime: new Date(serverStartTime).toISOString()
  };
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// Initialize
loadUsage();

// Save usage every 5 minutes
setInterval(saveUsage, 5 * 60 * 1000);

// Save on exit
process.on('SIGTERM', () => {
  saveUsage();
  process.exit(0);
});

module.exports = {
  trackKeyUsage,
  getKeyUsage,
  getTotalStats
};

