(() => {
    const POLL_MS = 3000;
    let pollHandle = null;
    let activeChannel = 'support';
    let activeCustomerId = '';
    let busy = false;

    function storedUser() {
        try { return JSON.parse(sessionStorage.getItem('acs_user') || 'null'); }
        catch { return null; }
    }
    function isCustomerPage() { return Boolean(document.getElementById('customer-chat-widget')); }
    function staffConsole() { return document.getElementById('staff-chat-console') || document.getElementById('admin-chat-console'); }
    function staffMessageBox() { return document.getElementById('staff-chat-messages'); }
    function chatStatus(message, isError = false) {
        let node = document.getElementById('chat-api-status');
        if (!node) {
            node = document.createElement('div');
            node.id = 'chat-api-status';
            node.style.cssText = 'font-size:11px;margin:6px 0;color:#94a3b8;';
            const consoleNode = staffConsole();
            const customerNode = document.getElementById('customer-chat-widget');
            (consoleNode || customerNode)?.prepend(node);
        }
        node.textContent = message;
        node.style.color = isError ? '#fca5a5' : '#86efac';
    }
    function makeBubble(message, customerView) {
        const item = document.createElement('div');
        const fromCustomer = message.sender_role === 'customer';
        const mine = customerView ? fromCustomer : message.sender_id === storedUser()?.id;
        item.style.cssText = customerView
            ? `align-self:${mine ? 'flex-end' : 'flex-start'};background:${mine ? '#0284c7' : '#e2e8f0'};color:${mine ? '#fff' : '#0f172a'};padding:8px 12px;border-radius:8px;max-width:85%;font-size:13px;`
            : `align-self:${mine ? 'flex-end' : 'flex-start'};background:#1e293b;padding:8px 12px;border-radius:6px;border-left:3px solid ${fromCustomer ? '#38bdf8' : '#22c55e'};max-width:90%;`;
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px;opacity:.75;margin-bottom:3px;';
        const date = message.created_at ? new Date(message.created_at).toLocaleString('en-PH') : '';
        meta.textContent = `${message.sender_name || message.sender_role || 'User'} • ${date}`;
        const body = document.createElement('div');
        body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;';
        body.textContent = message.message || '';
        item.append(meta, body);

        // The UI uses the documented individual-message GET/PUT/DELETE resources,
        // while read receipts continue to use PATCH /api/messages/:id.
        const currentUser = storedUser();
        const canEdit = Boolean(currentUser && (message.sender_id === currentUser.id || currentUser.role === 'admin'));
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;margin-top:5px;flex-wrap:wrap;';
        const actionStyle = 'border:0;background:transparent;padding:0;font-size:10px;text-decoration:underline;cursor:pointer;color:inherit;opacity:.8;';
        const details = document.createElement('button');
        details.type = 'button'; details.textContent = 'Details'; details.style.cssText = actionStyle;
        details.addEventListener('click', async () => {
            try {
                const record = await ChatAPI.getMessage(message.id);
                window.alert(`Message ${record.id}\nChannel: ${record.channel}\nSender role: ${record.sender_role}\nSent: ${new Date(record.created_at).toLocaleString('en-PH')}\nRead: ${record.is_read ? 'Yes' : 'No'}\n\n${record.message}`);
            } catch (error) { chatStatus(`Could not retrieve message details: ${error.message}`, true); }
        });
        actions.append(details);
        if (canEdit) {
            const edit = document.createElement('button');
            edit.type = 'button'; edit.textContent = 'Edit'; edit.style.cssText = actionStyle;
            edit.addEventListener('click', async () => {
                const replacement = window.prompt('Edit this message:', message.message || '');
                if (replacement === null || !replacement.trim()) return;
                try {
                    await ChatAPI.updateMessage(message.id, replacement.trim());
                    if (isCustomerPage()) await renderCustomerChat(); else await renderStaffChat();
                } catch (error) { chatStatus(`Could not edit message: ${error.message}`, true); }
            });
            actions.append(edit);
            const remove = document.createElement('button');
            remove.type = 'button'; remove.textContent = 'Delete'; remove.style.cssText = actionStyle;
            remove.addEventListener('click', async () => {
                if (!window.confirm('Delete this chat message?')) return;
                try {
                    await ChatAPI.deleteMessage(message.id);
                    if (isCustomerPage()) await renderCustomerChat(); else await renderStaffChat();
                } catch (error) { chatStatus(`Could not delete message: ${error.message}`, true); }
            });
            actions.append(remove);
        }
        item.append(actions);
        return item;
    }
    async function renderCustomerChat() {
        const box = document.getElementById('customer-chat-messages');
        if (!box || busy) return;
        busy = true;
        try {
            const messages = await ChatAPI.getMessages('support');
            // Mark staff/admin replies as read by the customer through PATCH /api/messages/:id.
            await Promise.all(messages.filter(message => message.sender_role !== 'customer' && !message.is_read)
                .map(message => ChatAPI.markRead(message.id).catch(error => console.warn('Could not mark message read:', error.message))));
            box.replaceChildren(...messages.map(message => makeBubble(message, true)));
            box.scrollTop = box.scrollHeight;
            chatStatus('Connected to Live Messaging API');
        } catch (error) { chatStatus(error.message || 'Could not load messages.', true); }
        finally { busy = false; }
    }
    async function loadConversations(select) {
        try {
            const conversations = await ChatAPI.getConversations();
            const current = activeCustomerId || select.value;
            select.replaceChildren();
            for (const conversation of conversations) {
                const option = document.createElement('option');
                option.value = conversation.customer_id;
                option.textContent = `${conversation.customer.full_name || conversation.customer.email || 'Customer'} · ${String(conversation.customer_id).slice(0, 8)}`;
                select.append(option);
            }
            if (current && conversations.some(item => item.customer_id === current)) select.value = current;
            else if (conversations.length) select.value = conversations[0].customer_id;
            activeCustomerId = select.value || '';
            if (!conversations.length) {
                const option = document.createElement('option'); option.value = ''; option.textContent = 'No customer conversations yet'; select.append(option);
                activeCustomerId = '';
            }
        } catch (error) { chatStatus(error.message || 'Could not load conversations.', true); }
    }
    async function renderStaffChat() {
        const box = staffMessageBox();
        if (!box || busy || !staffConsole()?.style.display || staffConsole().style.display === 'none') return;
        busy = true;
        try {
            let customerId = null;
            if (activeChannel === 'support') {
                const select = document.getElementById('staff-chat-customer-select');
                if (select) {
                    await loadConversations(select);
                    customerId = activeCustomerId;
                }
                if (!customerId) {
                    box.textContent = 'No customer conversations yet. Messages from customers will appear here.';
                    return;
                }
            }
            const messages = await ChatAPI.getMessages(activeChannel, customerId);
            // Mark incoming customer support messages as read using the documented
            // PATCH /api/messages/:id resource endpoint.
            if (activeChannel === 'support') {
                await Promise.all(messages.filter(message => message.sender_role === 'customer' && !message.is_read)
                    .map(message => ChatAPI.markRead(message.id).catch(error => console.warn('Could not mark message read:', error.message))));
            }
            box.replaceChildren(...messages.map(message => makeBubble(message, false)));
            box.scrollTop = box.scrollHeight;
            chatStatus('Connected to Live Messaging API · refreshes automatically');
        } catch (error) { chatStatus(error.message || 'Could not load messages.', true); }
        finally { busy = false; }
    }
    function startPolling() {
        stopPolling();
        const refresh = isCustomerPage() ? renderCustomerChat : renderStaffChat;
        refresh();
        pollHandle = window.setInterval(refresh, POLL_MS);
    }
    function stopPolling() {
        if (pollHandle !== null) window.clearInterval(pollHandle);
        pollHandle = null;
    }
    function ensureStaffCustomerSelect() {
        const box = staffMessageBox();
        if (!box || document.getElementById('staff-chat-customer-select')) return;
        const select = document.createElement('select');
        select.id = 'staff-chat-customer-select';
        select.style.cssText = 'width:100%;margin:4px 0 10px;padding:8px;border-radius:6px;background:#0f172a;color:#fff;border:1px solid #334155;';
        select.addEventListener('change', () => { activeCustomerId = select.value; renderStaffChat(); });
        box.parentNode.insertBefore(select, box);
    }
    window.toggleCustomerChat = function(show) {
        const widget = document.getElementById('customer-chat-widget');
        const button = document.getElementById('chat-toggle-btn');
        if (!widget || !button) return;
        widget.style.display = show ? 'block' : 'none';
        button.style.display = show ? 'none' : 'flex';
        if (show) startPolling(); else stopPolling();
    };
    window.sendCustomerMsg = async function(event) {
        event.preventDefault();
        const input = document.getElementById('customer-chat-input');
        const text = input?.value.trim();
        if (!text) return;
        try {
            await ChatAPI.sendMessage({ channel: 'support', text });
            input.value = '';
            await renderCustomerChat();
        } catch (error) { chatStatus(error.message || 'Message could not be sent.', true); }
    };
    window.toggleStaffChat = window.toggleAdminChat = function(show) {
        const consoleNode = staffConsole();
        const button = document.getElementById('staff-chat-toggle-btn') || document.getElementById('admin-chat-toggle-btn');
        if (!consoleNode || !button) return;
        consoleNode.style.display = show ? 'block' : 'none';
        button.style.display = show ? 'none' : 'flex';
        if (show) startPolling(); else stopPolling();
    };
    window.switchChatChannel = function(channel) {
        if (!['support', 'internal'].includes(channel)) return;
        activeChannel = channel;
        const supportBtn = document.getElementById('tab-support-btn');
        const internalBtn = document.getElementById('tab-internal-btn');
        if (supportBtn && internalBtn) {
            supportBtn.style.background = channel === 'support' ? '#0284c7' : '#334155';
            supportBtn.style.color = channel === 'support' ? '#fff' : '#cbd5e1';
            internalBtn.style.background = channel === 'internal' ? '#0284c7' : '#334155';
            internalBtn.style.color = channel === 'internal' ? '#fff' : '#cbd5e1';
        }
        const select = document.getElementById('staff-chat-customer-select');
        if (select) select.style.display = channel === 'support' ? 'block' : 'none';
        renderStaffChat();
    };
    window.sendStaffOrAdminMsg = async function(event) {
        event.preventDefault();
        const input = document.getElementById('staff-chat-input');
        const text = input?.value.trim();
        if (!text) return;
        const customerId = activeChannel === 'support' ? activeCustomerId : null;
        if (activeChannel === 'support' && !customerId) { chatStatus('Select a customer conversation first.', true); return; }
        try {
            await ChatAPI.sendMessage({ channel: activeChannel, customerId, text });
            input.value = '';
            await renderStaffChat();
        } catch (error) { chatStatus(error.message || 'Message could not be sent.', true); }
    };
    document.addEventListener('DOMContentLoaded', () => {
        if (isCustomerPage()) {
            // The customer chat is authenticated; the backend derives sender identity from the session.
            return;
        }
        ensureStaffCustomerSelect();
        const form = document.querySelector('#staff-chat-console form, #admin-chat-console form');
        if (form) form.addEventListener('submit', window.sendStaffOrAdminMsg);
    });
    window.addEventListener('beforeunload', stopPolling);
})();
