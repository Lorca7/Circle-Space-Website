(function () {
  var items = [];
  var current = 0;
  var overlay = null;

  function collectItems() {
    items = [];
    document.querySelectorAll('[data-lightbox-src], [data-lightbox-video]').forEach(function (el) {
      items.push({
        src: el.getAttribute('data-lightbox-src') || null,
        video: el.getAttribute('data-lightbox-video') || null,
        alt: el.getAttribute('data-lightbox-alt') || '',
        title: el.getAttribute('data-lightbox-title') || '',
        meta: el.getAttribute('data-lightbox-meta') || ''
      });
    });
  }

  function open(index) {
    current = index;
    var item = items[current];
    if (!item) return;

    overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', item.title || 'Enlarged view');

    var html = '';

    if (items.length > 1) {
      html += '<span class="lightbox__counter">' + (current + 1) + ' / ' + items.length + '</span>';
    }

    if (item.src) {
      html += '<img class="lightbox__image" src="' + esc(item.src) + '" alt="' + esc(item.alt) + '">';
    } else if (item.video) {
      html += '<div class="lightbox__viewer">';
      html += '<div class="lightbox__video"><iframe src="' + esc(item.video) + '" allowfullscreen></iframe></div>';
      html += '</div>';
    }

    if (item.title || item.meta) {
      html += '<div class="lightbox__info">';
      if (item.title) html += '<div class="lightbox__title">' + esc(item.title) + '</div>';
      if (item.meta) html += '<div class="lightbox__meta">' + esc(item.meta) + '</div>';
      html += '</div>';
    }

    html += '<button class="lightbox__close" aria-label="Close">&times;</button>';

    if (items.length > 1) {
      html += '<button class="lightbox__nav lightbox__nav--prev" aria-label="Previous">&lsaquo;</button>';
      html += '<button class="lightbox__nav lightbox__nav--next" aria-label="Next">&rsaquo;</button>';
    }

    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.querySelector('.lightbox__close').focus();

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('lightbox__image')) close();
    });
    overlay.querySelector('.lightbox__close').addEventListener('click', close);

    if (items.length > 1) {
      overlay.querySelector('.lightbox__nav--prev').addEventListener('click', function (e) {
        e.stopPropagation();
        go((current - 1 + items.length) % items.length);
      });
      overlay.querySelector('.lightbox__nav--next').addEventListener('click', function (e) {
        e.stopPropagation();
        go((current + 1) % items.length);
      });
    }
  }

  function go(index) {
    close();
    open(index);
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      document.body.style.overflow = '';
    }
  }

  function esc(s) {
    var el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-lightbox-src], [data-lightbox-video]');
    if (!trigger) return;
    e.preventDefault();
    collectItems();
    var triggers = Array.from(document.querySelectorAll('[data-lightbox-src], [data-lightbox-video]'));
    var idx = triggers.indexOf(trigger);
    open(idx >= 0 ? idx : 0);
  });

  document.addEventListener('keydown', function (e) {
    if (!overlay) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && items.length > 1) go((current - 1 + items.length) % items.length);
    if (e.key === 'ArrowRight' && items.length > 1) go((current + 1) % items.length);
  });
})();
