(() => {
    const BASES = Object.freeze({
        auth: 'http://localhost:3000',
        analytics: 'http://localhost:3001',
        services: 'http://localhost:3002',
        orders: 'http://localhost:3003',
        inventory: 'http://localhost:3004',
        chat: 'http://localhost:3005'
    });

    let refreshInFlight = null;

    function getToken() {
        return sessionStorage.getItem('acs_access_token');
    }

    function clearSession() {
        ['acs_access_token', 'acs_refresh_token', 'acs_user', 'acs_expires_at'].forEach(key => sessionStorage.removeItem(key));
    }

    function saveSessionTokens(data) {
        if (data.access_token) sessionStorage.setItem('acs_access_token', data.access_token);
        if (data.refresh_token) sessionStorage.setItem('acs_refresh_token', data.refresh_token);
        if (data.expires_at) sessionStorage.setItem('acs_expires_at', String(data.expires_at));
        if (data.user) sessionStorage.setItem('acs_user', JSON.stringify(data.user));
    }

    async function parseResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) return response.json();
        const text = await response.text();
        return text ? { message: text } : {};
    }

    async function refreshSession() {
        if (refreshInFlight) return refreshInFlight;
        const refreshToken = sessionStorage.getItem('acs_refresh_token');
        if (!refreshToken) return false;

        refreshInFlight = (async () => {
            try {
                const response = await fetch(`${BASES.auth}/api/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken })
                });
                const payload = await parseResponse(response);
                if (!response.ok || !payload.access_token) throw new Error(payload.message || 'Session refresh failed.');
                saveSessionTokens(payload);
                return true;
            } catch (error) {
                clearSession();
                return false;
            } finally {
                refreshInFlight = null;
            }
        })();
        return refreshInFlight;
    }

    async function request(api, path, options = {}) {
        const base = BASES[api];
        if (!base) throw new Error(`Unknown API module: ${api}`);
        const requestOptions = { ...options };
        delete requestOptions._retried;
        const headers = new Headers(requestOptions.headers || {});
        const token = getToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        if (requestOptions.body !== undefined && typeof requestOptions.body !== 'string' && !(requestOptions.body instanceof FormData)) {
            requestOptions.body = JSON.stringify(requestOptions.body);
        }
        if (requestOptions.body !== undefined && !(requestOptions.body instanceof FormData) && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        let response = await fetch(`${base}${path}`, { ...requestOptions, headers });
        if (response.status === 401 && api !== 'auth' && !options._retried && await refreshSession()) {
            return request(api, path, { ...options, _retried: true });
        }
        if (response.status === 401 && api === 'auth' && path !== '/api/auth/login' && path !== '/api/auth/register' && !options._retried && await refreshSession()) {
            return request(api, path, { ...options, _retried: true });
        }

        const payload = await parseResponse(response);
        if (!response.ok) {
            const error = new Error(payload && typeof payload === 'object' ? (payload.message || `Request failed (${response.status})`) : `Request failed (${response.status})`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    async function logout() {
        try {
            if (getToken()) await request('auth', '/api/auth/logout', { method: 'POST' });
        } catch (error) {
            console.warn('Server sign-out could not be confirmed; local session will still be cleared.', error.message);
        } finally {
            clearSession();
            window.location.href = './index.html';
        }
    }

    async function requireRole(allowedRoles) {
        if (!getToken()) {
            window.location.replace('./index.html');
            return null;
        }
        try {
            const result = await request('auth', '/api/auth/session');
            if (!result.user || !allowedRoles.includes(result.user.role)) {
                window.location.replace('./index.html');
                return null;
            }
            sessionStorage.setItem('acs_user', JSON.stringify(result.user));
            return result.user;
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                clearSession();
                window.location.replace('./index.html');
                return null;
            }
            throw error;
        }
    }

    window.ACS_API = { BASES, request, logout, requireRole, clearSession, saveSessionTokens };
    window.logoutToLogin = logout;
})();
