// Adds the usual annoyances to every demo page: cookie banner, chat widget,
// and a newsletter popup that appears after a moment.
(() => {
  const cookie = document.createElement('div');
  cookie.id = 'cookie-consent';
  cookie.innerHTML = `We value your privacy. We and our 247 partners use cookies and similar technologies to personalise content and ads.
    <a href="#">Cookie policy</a>
    <button class="btn" id="cookie-accept">Accept all</button>
    <button class="btn alt" id="cookie-settings">Manage preferences</button>
    <button class="btn alt" id="cookie-reject">Reject all</button>`;
  cookie.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') cookie.remove();
  });
  document.body.appendChild(cookie);

  const chat = document.createElement('div');
  chat.className = 'chat-widget';
  chat.innerHTML = `<strong>Hi! 👋 Need help?</strong><p>Chat with Priya from our care team.</p>
    <button class="btn">Start chat</button>`;
  document.body.appendChild(chat);

  setTimeout(() => {
    const popup = document.createElement('div');
    popup.className = 'newsletter-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.innerHTML = `<div class="box">
      <h2>Get 15% off your first health check!</h2>
      <p>Subscribe to our newsletter for exclusive deals.</p>
      <input type="email" placeholder="Your email">
      <button class="btn">Subscribe</button>
      <button class="btn alt" id="popup-no">No thanks</button>
    </div>`;
    popup.addEventListener('click', (e) => {
      if (e.target.id === 'popup-no') popup.remove();
    });
    document.body.appendChild(popup);
  }, 800);
})();
