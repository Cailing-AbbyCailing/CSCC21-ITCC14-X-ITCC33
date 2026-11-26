// Authenticated REST client for server-side support and internal messaging.
// All sender identity/role data is derived by the API from the verified Supabase JWT.
const ChatAPI = {
    async getMessages(channel = 'support', customerId = null) {
        const params = new URLSearchParams({ channel });
        if (customerId) params.set('customer_id', customerId);
        const result = await ACS_API.request('chat', `/api/messages?${params.toString()}`);
        return result.data || [];
    },
    async getConversations() {
        const result = await ACS_API.request('chat', '/api/conversations');
        return result.data || [];
    },
    async getMessage(id) {
        const result = await ACS_API.request('chat', `/api/messages/${encodeURIComponent(id)}`);
        return result.data;
    },
    async markRead(id) {
        const result = await ACS_API.request('chat', `/api/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { is_read: true } });
        return result.data;
    },
    async updateMessage(id, message) {
        const result = await ACS_API.request('chat', `/api/messages/${encodeURIComponent(id)}`, { method: 'PUT', body: { message } });
        return result.data;
    },
    async deleteMessage(id) {
        return ACS_API.request('chat', `/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async sendMessage({ channel = 'support', customerId = null, text }) {
        const result = await ACS_API.request('chat', '/api/messages', {
            method: 'POST',
            body: { channel, customer_id: customerId, message: String(text || '').trim() }
        });
        return result.data;
    }
};
