function showSection(roleOrSection, sectionOrElement, maybeElement) {
  let sectionId;
  let clickedEl;
  let scopeContainer = document.querySelector('main.content') || document;

  if (typeof sectionOrElement === 'string') {
    // 3-arg call: showSection('staff', 'services', this)
    const role = roleOrSection;
    sectionId = sectionOrElement;
    clickedEl = maybeElement;
    const roleDash = document.getElementById(`${role}-dashboard`);
    if (roleDash) scopeContainer = roleDash;
  } else {
    // 2-arg call: showSection('services', this)
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
