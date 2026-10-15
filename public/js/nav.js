// The sidebar is always visible on wide screens; on narrow ones this button
// reveals it. Written so the page works unchanged if the script never loads.
(function () {
  var button = document.querySelector('.nav-toggle');
  var body = document.body;
  if (!button) return;

  button.addEventListener('click', function () {
    var open = body.classList.toggle('nav-open');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Close the menu when a link is followed, and on Escape.
  document.querySelectorAll('.sidebar-nav a, .brand').forEach(function (link) {
    link.addEventListener('click', function () {
      body.classList.remove('nav-open');
      button.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && body.classList.contains('nav-open')) {
      body.classList.remove('nav-open');
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    }
  });
})();
