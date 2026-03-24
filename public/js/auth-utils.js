/**
 * Authentication utilities for persistent sessions
 * Handles token storage, restoration, and automatic refresh
 */

// Token refresh interval (refresh every 24 hours)
const TOKEN_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
let refreshTimer = null;

/**
 * Initialize authentication - restore session if needed and set up auto-refresh
 */
async function initAuth() {
    // Check if we have a token in localStorage but no active session
    const storedToken = localStorage.getItem('authToken');
    
    if (storedToken) {
        // Try to restore session by refreshing token
        try {
            await restoreSession(storedToken);
        } catch (error) {
            console.log('Failed to restore session:', error);
            // Clear invalid token
            clearAuthData();
        }
    }
    
    // Set up automatic token refresh
    setupTokenRefresh();
}

/**
 * Restore session from stored token
 */
async function restoreSession(token) {
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            // Update stored token
            localStorage.setItem('authToken', data.token);
            if (data.user) {
                localStorage.setItem('userInfo', JSON.stringify(data.user));
            }
            return true;
        } else {
            // Token is invalid, clear it
            clearAuthData();
            return false;
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        return false;
    }
}

/**
 * Setup automatic token refresh
 */
function setupTokenRefresh() {
    // Clear existing timer
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    
    // Refresh token periodically
    refreshTimer = setInterval(async () => {
        const storedToken = localStorage.getItem('authToken');
        if (storedToken) {
            try {
                await refreshToken();
            } catch (error) {
                console.error('Auto token refresh failed:', error);
            }
        }
    }, TOKEN_REFRESH_INTERVAL);
    
    // Also refresh on page visibility change (when user comes back to tab)
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden) {
            const storedToken = localStorage.getItem('authToken');
            if (storedToken) {
                try {
                    await refreshToken();
                } catch (error) {
                    console.error('Token refresh on visibility change failed:', error);
                }
            }
        }
    });
}

/**
 * Refresh the authentication token
 */
async function refreshToken() {
    try {
        const storedToken = localStorage.getItem('authToken');
        if (!storedToken) {
            return false;
        }
        
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storedToken}`
            },
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('authToken', data.token);
            if (data.user) {
                localStorage.setItem('userInfo', JSON.stringify(data.user));
            }
            return true;
        } else {
            // Token refresh failed, might need to re-login
            if (response.status === 401) {
                clearAuthData();
            }
            return false;
        }
    } catch (error) {
        console.error('Error refreshing token:', error);
        return false;
    }
}

/**
 * Clear authentication data
 */
function clearAuthData() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userInfo');
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

/**
 * Enhanced fetch wrapper that automatically adds auth token and handles 401 errors
 */
async function authenticatedFetch(url, options = {}) {
    const storedToken = localStorage.getItem('authToken');
    
    // Add Authorization header if token exists
    const headers = {
        ...options.headers,
        'Content-Type': 'application/json'
    };
    
    if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
    }
    
    // Ensure credentials are included for session cookies
    const fetchOptions = {
        ...options,
        headers,
        credentials: 'include'
    };
    
    try {
        const response = await fetch(url, fetchOptions);
        
        // If 401, try to refresh token once
        if (response.status === 401 && storedToken) {
            const refreshed = await refreshToken();
            if (refreshed) {
                // Retry the request with new token
                const newToken = localStorage.getItem('authToken');
                fetchOptions.headers['Authorization'] = `Bearer ${newToken}`;
                return fetch(url, fetchOptions);
            } else {
                // Refresh failed, redirect to login
                if (window.location.pathname !== '/admin/login') {
                    window.location.href = '/admin/login';
                }
                throw new Error('Authentication required');
            }
        }
        
        return response;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

/**
 * Check if user is authenticated
 */
async function checkAuthStatus() {
    try {
        const response = await authenticatedFetch('/api/auth/status');
        if (response.ok) {
            const data = await response.json();
            return data.authenticated;
        }
        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Logout and clear all auth data
 */
async function logout() {
    try {
        await authenticatedFetch('/api/auth/logout', {
            method: 'POST'
        });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        clearAuthData();
        window.location.href = '/admin/login';
    }
}

// Initialize auth when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
} else {
    initAuth();
}

// Export functions for use in other scripts
window.authUtils = {
    initAuth,
    refreshToken,
    authenticatedFetch,
    checkAuthStatus,
    logout,
    clearAuthData
};

