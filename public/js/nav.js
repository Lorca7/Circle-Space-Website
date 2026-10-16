(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('site-nav--open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.querySelectorAll('.site-nav a, .site-logo').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('site-nav--open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && nav.classList.contains('site-nav--open')) {
      nav.classList.remove('site-nav--open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
})();
