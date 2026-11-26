const API_BASE_URL = 'http://localhost:3000';

function saveSession(data) {
    if (data.access_token) {
        sessionStorage.setItem('acs_access_token', data.access_token);
    }
    if (data.refresh_token) {
        sessionStorage.setItem('acs_refresh_token', data.refresh_token);
    }
    if (data.expires_at) sessionStorage.setItem('acs_expires_at', String(data.expires_at));
    if (data.user) sessionStorage.setItem('acs_user', JSON.stringify(data.user));
}

function showAuthMessage(form, message, isError = false) {
    let output = form.querySelector('.auth-message');

    if (!output) {
        output = document.createElement('p');
        output.className = 'auth-message';
        output.setAttribute('role', 'status');
        output.style.marginTop = '12px';
        output.style.fontSize = '14px';
        form.appendChild(output);
    }

    output.textContent = message;
    output.style.color = isError ? '#b42318' : '#16703c';
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.querySelector('[data-auth-form="login"]');
    const registerForm = document.querySelector('[data-auth-form="register"]');

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const email = loginForm.querySelector('[name="email"]').value.trim();
            const password = loginForm.querySelector('[name="password"]').value;
            const button = loginForm.querySelector('[type="submit"]');

            button.disabled = true;

            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.message || 'Could not log in.');
                }

                saveSession(result);

                const destinations = {
                    customer: './customer.html',
                    staff: './staff-dashboard.html',
                    admin: './admin-dashboard.html'
                };

                const destination = destinations[result.user.role];

                if (!destination) {
                    throw new Error('This account has an unrecognized role.');
                }

                window.location.href = destination;
            } catch (error) {
                showAuthMessage(loginForm, error.message, true);
            } finally {
                button.disabled = false;
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const full_name = registerForm.querySelector('[name="full_name"]').value.trim();
            const email = registerForm.querySelector('[name="email"]').value.trim();
            const password = registerForm.querySelector('[name="password"]').value;
            const phone = registerForm.querySelector('[name="phone"]')?.value.trim() || undefined;
            const default_address = registerForm.querySelector('[name="default_address"]')?.value.trim() || undefined;
            const button = registerForm.querySelector('[type="submit"]');

            button.disabled = true;

            try {
                const response = await fetch(`${API_BASE_URL}/api/users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ full_name, email, password, phone, default_address })
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.message || 'Could not create the account.');
                }

                if (result.access_token) {
                    saveSession(result);
                    showAuthMessage(registerForm, 'Account created. You can now sign in.');
                } else {
                    showAuthMessage(registerForm, result.message);
                }
            } catch (error) {
                showAuthMessage(registerForm, error.message, true);
            } finally {
                button.disabled = false;
            }
        });
    }
});
