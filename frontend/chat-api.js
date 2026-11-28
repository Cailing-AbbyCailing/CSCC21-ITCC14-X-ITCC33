// chat-api.js
const ChatAPI = {
  STORAGE_KEY: 'alavanza_portal_messages',

  // Fetch all messages (or filter by channel: 'support' or 'internal')
  getMessages(channel = 'support') {
    const all = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    return all.filter(msg => msg.channel === channel);
  },

  // Send a new message
  sendMessage({ channel = 'support', senderName, senderRole, text }) {
    if (!text.trim()) return null;

    const all = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    const newMsg = {
      id: Date.now(),
      channel,         // 'support' (Customer <-> Staff/Admin) or 'internal' (Staff <-> Admin)
      senderName,      // e.g., 'Juan Dela Cruz', 'Staff User', 'Admin Manager'
      senderRole,      // 'customer' | 'staff' | 'admin'
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    all.push(newMsg);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
    return newMsg;
  },

  // Listen for real-time updates from other open browser tabs
  onNewMessage(callback) {
    window.addEventListener('storage', (event) => {
      if (event.key === this.STORAGE_KEY) {
        callback();
      }
    });
  }
};