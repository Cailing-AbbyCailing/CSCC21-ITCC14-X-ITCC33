function showSection(roleOrSection, sectionOrElement, maybeElement) {
  let sectionId;
  let clickedEl;
  let scopeContainer = document.querySelector('main.content') || document;

  if (typeof sectionOrElement === 'string') {
    const role = roleOrSection;
    sectionId = sectionOrElement;
    clickedEl = maybeElement;
    const roleDash = document.getElementById(`${role}-dashboard`);
    if (roleDash) scopeContainer = roleDash;
  } else {
    sectionId = roleOrSection;
    clickedEl = sectionOrElement;
  }

  const sections = scopeContainer.querySelectorAll('.section-pane');
  sections.forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });

  const targetSection =
    document.getElementById(`${sectionId}-section`) ||
    document.getElementById(`staff-${sectionId}-section`) ||
    document.getElementById(`admin-${sectionId}-section`);

  if (targetSection) {
    targetSection.classList.add('active');
    targetSection.style.display = 'block';
  }

  if (clickedEl && clickedEl.parentElement) {
    clickedEl.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    clickedEl.classList.add('active');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dateElement = document.getElementById('current-date-str');
  if (dateElement) {
    dateElement.textContent = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Password visibility toggle on login form
  const togglePwdBtn = document.querySelector('.toggle-password');
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener('click', () => {
      const pwdInput = togglePwdBtn.parentElement?.querySelector('input');
      const icon = togglePwdBtn.querySelector('i');
      if (!pwdInput) return;

      const isHidden = pwdInput.type === 'password';
      pwdInput.type = isHidden ? 'text' : 'password';
      if (icon) {
        icon.classList.toggle('fa-eye', !isHidden);
        icon.classList.toggle('fa-eye-slash', isHidden);
      }
    });
  }

  // Login form submission: show success pop-up modal, then redirect
  const loginForm = document.querySelector('.login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();

      const emailInput = loginForm.querySelector('input[type="email"]');
      const email = (emailInput?.value || '').trim().toLowerCase();
      const targetDashboard = email.includes('admin')
        ? './admin-dashboard.html'
        : './staff-dashboard.html';

      const successModal = document.getElementById('login-success-modal');
      if (successModal) {
        successModal.classList.add('active');
        setTimeout(() => {
          window.location.href = targetDashboard;
        }, 1500);
      } else {
        window.location.href = targetDashboard;
      }
    });
  }
});

function switchView(role) {
  const staffDashboard = document.getElementById('staff-dashboard');
  const adminDashboard = document.getElementById('admin-dashboard');
  const staffNav = document.getElementById('staff-nav');
  const adminNav = document.getElementById('admin-nav');
  const btnStaff = document.getElementById('btn-staff-view');
  const btnAdmin = document.getElementById('btn-admin-view');
  const userName = document.getElementById('current-user-name');
  const userRole = document.getElementById('current-user-role');

  if (!staffDashboard || !adminDashboard) return;

  if (role === 'staff') {
    staffDashboard.classList.remove('hidden');
    adminDashboard.classList.add('hidden');
    staffNav?.classList.remove('hidden');
    adminNav?.classList.add('hidden');
    btnStaff?.classList.add('active');
    btnAdmin?.classList.remove('active');
    if (userName) userName.textContent = 'Staff User';
    if (userRole) userRole.textContent = 'Operations Staff';
  } else {
    staffDashboard.classList.add('hidden');
    adminDashboard.classList.remove('hidden');
    staffNav?.classList.add('hidden');
    adminNav?.classList.remove('hidden');
    btnAdmin?.classList.add('active');
    btnStaff?.classList.remove('active');
    if (userName) userName.textContent = 'Admin Manager';
    if (userRole) userRole.textContent = 'System Administrator';
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function handleFormSubmit(event, successMsg) {
  event.preventDefault();
  alert(successMsg + "\n\n(Backend API payload ready for backend team integration)");
  event.target.reset();
  const modalOverlay = event.target.closest('.modal-overlay');
  if (modalOverlay) modalOverlay.classList.remove('active');
}
