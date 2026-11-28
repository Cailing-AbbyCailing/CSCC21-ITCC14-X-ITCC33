const LAUNDRY_PRICE_PER_LOAD = 180;
const MAX_LAUNDRY_CAPACITY_KG = 7;

function switchView(viewId, event) {
    document.querySelectorAll('.panel-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active');
    }

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    const titles = {
        'choose-service': ['HOME', 'Select your service, fill out order details, and track your requests.'],
        'order-tracker': ['Track Order Status', 'Monitor active water orders and laundry turnaround states.'],
        'account-settings': ['Account Settings', 'Manage your profile and account preferences.']
    };

    const headerTitle = document.getElementById('header-title');
    const headerDesc = document.getElementById('header-desc');
    if (headerTitle && titles[viewId]) headerTitle.innerText = titles[viewId][0];
    if (headerDesc && titles[viewId]) headerDesc.innerText = titles[viewId][1];
}

function selectServiceTab(type) {
    const promptBox = document.getElementById('no-service-prompt');
    if (promptBox) {
        promptBox.style.display = 'none';
    }

    const waterBtn = document.getElementById('tab-water-btn');
    const laundryBtn = document.getElementById('tab-laundry-btn');
    const waterContent = document.getElementById('water-form-content');
    const laundryContent = document.getElementById('laundry-form-content');

    waterBtn?.classList.remove('active');
    laundryBtn?.classList.remove('active');
    waterContent?.classList.remove('active');
    laundryContent?.classList.remove('active');

    if (type === 'water') {
        waterBtn?.classList.add('active');
        waterContent?.classList.add('active');
        calculateWaterTotal();
    } else if (type === 'laundry') {
        laundryBtn?.classList.add('active');
        laundryContent?.classList.add('active');
        calculateLaundryTotal();
    }
}

function toggleSchedule(service) {
    const toggleEl = document.getElementById(service + 'DeliveryToggle');
    const scheduleBox = document.getElementById(service + 'ScheduleBox');
    const addressBox = document.getElementById(service + 'AddressBox');
    if (!toggleEl) return;

    const showFields = toggleEl.value === 'yes' ? 'flex' : 'none';
    if (scheduleBox) scheduleBox.style.display = showFields;
    if (addressBox) addressBox.style.display = showFields;
}

/* =========================================
   PRICE CALCULATION & CAPACITY VALIDATION
   ========================================= */
function calculateWaterTotal() {
    const typeSelect = document.getElementById('waterType');
    const qtyInput = document.getElementById('waterQty');
    const totalEl = document.getElementById('waterDisplayTotal');
    if (!typeSelect || !qtyInput || !totalEl) return;

    const unitPrice = parseFloat(typeSelect.value) || 0;
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    totalEl.textContent = `₱${(unitPrice * qty).toFixed(2)}`;
}

function validateLaundryCapacity() {
    const loadsInput = document.getElementById('laundryLoads');
    const errorEl = document.getElementById('laundryCapacityError');
    if (!loadsInput || !errorEl) return true;

    const rawValue = parseFloat(loadsInput.value);
    if (!Number.isNaN(rawValue) && rawValue > MAX_LAUNDRY_CAPACITY_KG) {
        errorEl.textContent = 'Error: Maximum capacity is 7 kg';
        errorEl.hidden = false;
        return false;
    }

    errorEl.textContent = '';
    errorEl.hidden = true;
    return true;
}

function calculateLaundryTotal() {
    const loadsInput = document.getElementById('laundryLoads');
    const totalEl = document.getElementById('laundryDisplayTotal');
    if (!loadsInput || !totalEl) return;

    validateLaundryCapacity();

    let loads = parseInt(loadsInput.value, 10);
    if (Number.isNaN(loads) || loads < 1) loads = 1;
    if (loads > MAX_LAUNDRY_CAPACITY_KG) loads = MAX_LAUNDRY_CAPACITY_KG;

    totalEl.textContent = `₱${(LAUNDRY_PRICE_PER_LOAD * loads).toFixed(2)}`;
}

function submitLaundryBooking() {
    if (!validateLaundryCapacity()) return;

    openOrderModal(
        'Booking Submitted',
        'Laundry Booking Submitted!',
        'Your booking is pending confirmation from admin/staff.'
    );
}

/* =========================================
   MODALS (SIGN IN, LOGOUT & ORDER/SAVE)
   ========================================= */
let signinRedirectUrl = 'customer.html';

function openSigninModal(redirectUrl = 'customer.html', autoRedirectMs = 0) {
    signinRedirectUrl = redirectUrl;

    const modal = document.getElementById('signin-modal-backdrop');
    const continueBtn = document.getElementById('signin-continue-btn');

    if (continueBtn) {
        continueBtn.href = signinRedirectUrl;
    }
    if (modal) {
        modal.hidden = false;
    }
    if (autoRedirectMs > 0) {
        setTimeout(() => {
            window.location.href = signinRedirectUrl;
        }, autoRedirectMs);
    }
}

function closeSigninModal() {
    const modal = document.getElementById('signin-modal-backdrop');
    if (modal) {
        modal.hidden = true;
    }
}

function openLogoutModal(event) {
    if (event) {
        event.preventDefault();
    }

    const modal = document.getElementById('logout-modal-backdrop');
    if (modal) {
        modal.hidden = false;
    }
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal-backdrop');
    if (modal) {
        modal.hidden = true;
    }
}

function openOrderModal(
    titleText = 'Order Submitted',
    headingText = 'Water Order Submitted Successfully!',
    messageText = 'Your order has been received and is being processed.'
) {
    const modal = document.getElementById('order-modal-backdrop');
    const titleEl = document.getElementById('order-modal-title');
    const headingEl = document.getElementById('order-modal-heading');
    const messageEl = document.getElementById('order-modal-message');

    if (titleEl) titleEl.textContent = titleText;
    if (headingEl) headingEl.textContent = headingText;
    if (messageEl) messageEl.textContent = messageText;
    if (modal) modal.hidden = false;
}

function closeOrderModal() {
    const modal = document.getElementById('order-modal-backdrop');
    if (modal) {
        modal.hidden = true;
    }
}

/* =========================================
   CUSTOMER SUPPORT CHAT
   ========================================= */
function toggleCustomerChat(show) {
    const widget = document.getElementById('customer-chat-widget');
    const toggleBtn = document.getElementById('chat-toggle-btn');
    if (!widget || !toggleBtn) return;

    if (show) {
        widget.style.display = 'block';
        toggleBtn.style.display = 'none';
        renderCustomerChat();
    } else {
        widget.style.display = 'none';
        toggleBtn.style.display = 'flex';
    }
}

function renderCustomerChat() {
    const box = document.getElementById('customer-chat-messages');
    if (!box || typeof ChatAPI === 'undefined') return;

    const msgs = ChatAPI.getMessages('support');
    box.innerHTML = msgs.map(m => `
        <div style="align-self:${m.senderRole === 'customer' ? 'flex-end' : 'flex-start'}; background:${m.senderRole === 'customer' ? '#0284c7' : '#e2e8f0'}; color:${m.senderRole === 'customer' ? '#fff' : '#0f172a'}; padding:8px 12px; border-radius:8px; max-width:80%; font-size:13px;">
            <div style="font-size:10px; opacity:0.8; margin-bottom:2px;">${m.senderName} • ${m.timestamp}</div>
            <div>${m.text}</div>
        </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
}

function sendCustomerMsg(e) {
    e.preventDefault();
    const input = document.getElementById('customer-chat-input');
    if (!input || typeof ChatAPI === 'undefined') return;

    ChatAPI.sendMessage({
        channel: 'support',
        senderName: 'Juan Dela Cruz',
        senderRole: 'customer',
        text: input.value
    });
    input.value = '';
    renderCustomerChat();
}

/* =========================================
   GLOBAL LISTENERS & INITIALIZATION
   ========================================= */
document.addEventListener('click', function (event) {
    const signinModal = document.getElementById('signin-modal-backdrop');
    if (signinModal && !signinModal.hidden && event.target === signinModal) {
        closeSigninModal();
    }

    const logoutModal = document.getElementById('logout-modal-backdrop');
    if (logoutModal && !logoutModal.hidden && event.target === logoutModal) {
        closeLogoutModal();
    }

    const orderModal = document.getElementById('order-modal-backdrop');
    if (orderModal && !orderModal.hidden && event.target === orderModal) {
        closeOrderModal();
    }
});

document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        closeSigninModal();
        closeLogoutModal();
        closeOrderModal();
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const waterType = document.getElementById('waterType');
    const waterQty = document.getElementById('waterQty');
    const laundryLoads = document.getElementById('laundryLoads');
    const chatForm = document.getElementById('customer-chat-form');

    waterType?.addEventListener('change', calculateWaterTotal);
    waterQty?.addEventListener('input', calculateWaterTotal);
    waterQty?.addEventListener('change', calculateWaterTotal);

    laundryLoads?.addEventListener('input', calculateLaundryTotal);
    laundryLoads?.addEventListener('change', calculateLaundryTotal);

    chatForm?.addEventListener('submit', sendCustomerMsg);

    if (typeof ChatAPI !== 'undefined') {
        ChatAPI.onNewMessage(renderCustomerChat);
        renderCustomerChat();
    }

    calculateWaterTotal();
    calculateLaundryTotal();
});