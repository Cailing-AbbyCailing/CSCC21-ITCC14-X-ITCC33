document.addEventListener('DOMContentLoaded', () => {
  const dateElement = document.getElementById('current-date-str');
  if (dateElement) {
    dateElement.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  if (role === 'staff') {
    staffDashboard.classList.remove('hidden');
    adminDashboard.classList.add('hidden');
    staffNav.classList.remove('hidden');
    adminNav.classList.add('hidden');
    btnStaff.classList.add('active');
    btnAdmin.classList.remove('active');
    userName.textContent = 'Staff User';
    userRole.textContent = 'Operations Staff';
  } else {
    staffDashboard.classList.add('hidden');
    adminDashboard.classList.remove('hidden');
    staffNav.classList.add('hidden');
    adminNav.classList.remove('hidden');
    btnAdmin.classList.add('active');
    btnStaff.classList.remove('active');
    userName.textContent = 'Admin Manager';
    userRole.textContent = 'System Administrator';
  }
}

function showSection(sectionId, element) {
  const sections = document.querySelectorAll('.section-pane');
  sections.forEach(s => s.classList.remove('active'));

  const targetSection = document.getElementById(`${sectionId}-section`);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  const navContainer = (element && element.parentElement) || document.querySelector('.nav-list');
  if (navContainer) {
    const navItems = navContainer.querySelectorAll('.nav-item');
    navItems.forEach(n => n.classList.remove('active'));
  }

  if (element) {
    element.classList.add('active');
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

