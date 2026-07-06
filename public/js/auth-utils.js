/**
 * Authentication utilities.
 *
 * Auth is session-based: the httpOnly session cookie is the only credential,
 * set by the server at login. Nothing sensitive is kept in localStorage
 * (only `userInfo` display data such as the user's name).
 */

/**
 * Clear locally stored display data (and legacy token storage from the old
 * JWT-based auth, so stale tokens don't linger in users' browsers).
 */
function clearAuthData() {
    localStorage.removeItem('authToken'); // legacy
    localStorage.removeItem('userInfo');
}

/**
 * fetch wrapper for API calls: includes the session cookie, sends JSON, and
 * redirects to the login page when the session has expired.
 */
async function authenticatedFetch(url, options = {}) {
    const fetchOptions = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        credentials: 'include'
    };

    const response = await fetch(url, fetchOptions);

    if (response.status === 401) {
        clearAuthData();
        if (window.location.pathname !== '/admin/login') {
            window.location.href = '/admin/login';
        }
        throw new Error('Authentication required');
    }

    return response;
}

/**
 * Check if the current session is authenticated.
 */
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status', { credentials: 'include' });
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
 * Logout: destroy the server-side session and return to the login page.
 */
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        clearAuthData();
        window.location.href = '/admin/login';
    }
}

// Remove any legacy JWT left over from the previous auth system.
localStorage.removeItem('authToken');

// Export functions for use in other scripts (API kept compatible with the
// previous token-based version; initAuth/refreshToken are now no-ops).
window.authUtils = {
    initAuth: async () => {},
    refreshToken: async () => true,
    authenticatedFetch,
    checkAuthStatus,
    logout,
    clearAuthData
};
