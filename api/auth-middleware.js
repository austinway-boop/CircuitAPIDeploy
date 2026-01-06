// API Token Authentication Middleware
// Provides secure API access control using hashed tokens

const crypto = require('crypto');

class ApiAuthenticator {
    constructor() {
        // Load authorized tokens from environment variables
        this.authorizedTokens = this.loadAuthorizedTokens();
        this.rateLimits = new Map(); // Simple rate limiting
    }
    
    loadAuthorizedTokens() {
        const tokens = new Set();
        
        // Load tokens from environment variables efficiently
        // Format: API_TOKEN_1, API_TOKEN_2, etc.
        const envKeys = Object.keys(process.env);
        for (const key of envKeys) {
            if (key.startsWith('API_TOKEN_')) {
                const token = process.env[key];
                if (token) {
                    tokens.add(this.hashToken(token));
                }
            }
        }
        
        // If no tokens are configured, create a default one for development
        if (tokens.size === 0) {
            tokens.add(this.hashToken('dev-token-123'));
        }
        
        return tokens;
    }
    
    hashToken(token) {
        // Use SHA-256 to hash tokens for secure storage
        return crypto.createHash('sha256').update(token).digest('hex');
    }
    
    authenticate(req, res, next) {
        // Extract token from Authorization header or query parameter
        let token = null;
        
        // Check Authorization header (Bearer token)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
        
        // Check query parameter as fallback
        if (!token && req.query.api_token) {
            token = req.query.api_token;
        }
        
        // Check if token is provided
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please provide an API token in the Authorization header (Bearer token) or as api_token query parameter',
                example: {
                    header: 'Authorization: Bearer your-api-token-here',
                    query: '?api_token=your-api-token-here'
                }
            });
        }
        
        // Hash the provided token and check if it's authorized
        const hashedToken = this.hashToken(token);
        
        if (!this.authorizedTokens.has(hashedToken)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API token',
                message: 'The provided API token is not authorized to access this API'
            });
        }
        
        // Optimized rate limiting
        const clientId = hashedToken.substring(0, 8);
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        const maxRequests = 100;
        
        let requests = this.rateLimits.get(clientId);
        if (!requests) {
            requests = [];
            this.rateLimits.set(clientId, requests);
        }
        
        // Filter old requests efficiently
        while (requests.length > 0 && now - requests[0] >= windowMs) {
            requests.shift();
        }
        
        if (requests.length >= maxRequests) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded',
                message: `Maximum ${maxRequests} requests per minute exceeded`,
                retry_after: Math.ceil((requests[0] + windowMs - now) / 1000)
            });
        }
        
        requests.push(now);
        
        // Continue to the actual endpoint
        next();
    }
    
    // Utility method to generate new tokens
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    // Get authentication statistics
    getAuthStats() {
        return {
            authorized_tokens: this.authorizedTokens.size,
            active_rate_limits: this.rateLimits.size,
            rate_limit_window: '60 seconds',
            max_requests_per_window: 100
        };
    }
}

// Global authenticator instance
const apiAuth = new ApiAuthenticator();

// Export both the middleware function and the authenticator instance
module.exports = {
    authenticate: (req, res, next) => apiAuth.authenticate(req, res, next),
    apiAuth,
    generateToken: () => apiAuth.generateToken()
};
