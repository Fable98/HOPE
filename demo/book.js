// Multi-step booking form for the demo site.
(() => {
  const form = document.getElementById('booking');
  const steps = Array.from(form.querySelectorAll('.step'));
  const error = document.getElementById('error');
  let current = 0;

  function show(index) {
    steps.forEach((s, i) => s.classList.toggle('active', i === index));
    current = index;
    error.textContent = '';
    if (index === 3) fillReview();
  }

  function missing(step) {
    const required = Array.from(step.querySelectorAll('[required]'));
    return required.filter((el) => {
      if (el.type === 'radio') return !form.querySelector(`input[name="${el.name}"]:checked`);
      if (el.type === 'checkbox') return !el.checked;
      return !el.value.trim();
    });
  }

  function value(name) {
    const el = form.elements[name];
    if (el instanceof RadioNodeList) return el.value;
    if (el.tagName === 'SELECT') return el.options[el.selectedIndex].text;
    return el.value;
  }

  function fillReview() {
    const doctor = form.querySelector('input[name="doctor"]:checked');
    const fee = Number(doctor?.dataset.fee || 0) + (form.elements.priority.checked ? 199 : 0);
    document.getElementById('review').textContent =
      `${value('pname')}: ${value('doctor')}, ${value('dept')}, at ${value('loc')} on ${value('date')} at ${value('slot')}. ` +
      `Total payable: ₹${fee.toLocaleString('en-IN')}.`;
  }

  form.addEventListener('click', (e) => {
    if (e.target.classList.contains('next')) {
      const gaps = missing(steps[current]);
      if (gaps.length) {
        error.textContent = 'Please fill all mandatory fields marked with *.';
        return;
      }
      show(current + 1);
    }
    if (e.target.classList.contains('back')) show(current - 1);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    form.hidden = true;
    const ref = `CC-${Math.floor(10000 + Math.random() * 90000)}`;
    document.getElementById('success-text').textContent =
      `Your appointment is booked with ${value('doctor')} on ${value('date')} at ${value('slot')}. Booking reference: ${ref}.`;
    document.getElementById('success').hidden = false;
  });
})();
