(function() {
  'use strict';

  const NAV_ITEMS = [
    { label: 'Dashboard',      icon: 'bi-speedometer2',   href: '/admin/dashboard', adminOnly: false },
    { label: 'Sources',        icon: 'bi-book',           href: '/modules/sources/index.html', adminOnly: false },
    { label: 'Composers',      icon: 'bi-person',         href: '/modules/composers/index.html', adminOnly: false },
    { label: 'Editors',        icon: 'bi-pencil',         href: '/modules/editors/index.html', adminOnly: false },
    { label: 'Scribes',        icon: 'bi-pen',            href: '/modules/scribes/index.html', adminOnly: false },
    { label: 'Publishers',     icon: 'bi-printer',        href: '/modules/publishers/index.html', adminOnly: false },
    { label: 'Performers',     icon: 'bi-music-note',     href: '/modules/performers/index.html', adminOnly: false },
    { label: 'Functions',      icon: 'bi-tag',            href: '/modules/functions/index.html', adminOnly: false },
    { label: 'Groups',         icon: 'bi-collection',     href: '/group-management.html', adminOnly: true },
    { label: 'Clef / Voicings',icon: 'bi-music-note-list',href: '/modules/clef-voicings/index.html', adminOnly: true },
    { label: 'Users',          icon: 'bi-people',         href: '/user-management.html', adminOnly: true }
  ];

  const COLLAPSED_KEY = 'admin_sidebar_collapsed';

  function isCollapsed() {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  }

  function setCollapsed(val) {
    localStorage.setItem(COLLAPSED_KEY, val ? '1' : '0');
  }

  function isActive(href) {
    const path = window.location.pathname;
    if (href === '/admin/dashboard') {
      return path === '/admin/dashboard' || path === '/admin-dashboard.html';
    }
    return path.includes(href.replace('/index.html', '').replace('.html', ''));
  }

  function getUserName() {
    try {
      const info = localStorage.getItem('userInfo');
      if (info) {
        const user = JSON.parse(info);
        return user.username || user.name || user.email || 'Admin';
      }
    } catch(e) {}
    return 'Admin';
  }

  function buildSidebar(collapsed) {
    const sidebar = document.createElement('nav');
    sidebar.id = 'adminSidebar';
    sidebar.className = 'admin-sidebar' + (collapsed ? ' collapsed' : '');

    let html = '<div class="sidebar-header">';
    html += `<span class="sidebar-brand">${collapsed ? 'PD' : 'Polyphony DB'}</span>`;
    html += `<button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">
      <i class="bi ${collapsed ? 'bi-chevron-right' : 'bi-chevron-left'}"></i>
    </button>`;
    html += '</div>';

    html += '<ul class="sidebar-nav">';
    for (const item of NAV_ITEMS) {
      const active = isActive(item.href) ? ' active' : '';
      const adminClass = item.adminOnly ? ' admin-only' : '';
      html += `<li class="sidebar-item${active}${adminClass}">
        <a href="${item.href}" class="sidebar-link" title="${item.label}">
          <i class="bi ${item.icon}"></i>
          <span class="sidebar-label">${item.label}</span>
        </a>
      </li>`;
    }
    html += '</ul>';

    sidebar.innerHTML = html;
    return sidebar;
  }

  function buildHeader() {
    const header = document.createElement('header');
    header.id = 'adminHeader';
    header.className = 'admin-header';

    header.innerHTML = `
      <div class="header-left">
        <span class="header-title">Polyphony Database</span>
      </div>
      <div class="header-right">
        <a href="/" target="_blank" class="header-link" title="Open public database">
          <i class="bi bi-globe"></i> Public Database
        </a>
        <span class="header-user">
          <i class="bi bi-person-circle"></i> ${getUserName()}
        </span>
        <button class="header-btn" id="headerLogout" title="Logout">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </div>
    `;
    return header;
  }

  function init() {
    const collapsed = isCollapsed();

    // Move existing body children into a wrapper without serializing/re-parsing
    const main = document.createElement('div');
    main.id = 'adminMainContent';
    main.className = 'admin-main';
    while (document.body.firstChild) {
      main.appendChild(document.body.firstChild);
    }

    document.body.classList.add('admin-layout');
    if (collapsed) document.body.classList.add('sidebar-collapsed');

    const sidebar = buildSidebar(collapsed);
    const header = buildHeader();

    document.body.appendChild(sidebar);
    document.body.appendChild(header);
    document.body.appendChild(main);

    // Toggle uses only CSS class changes -- no DOM rebuilding
    document.getElementById('sidebarToggle').addEventListener('click', function() {
      const nowCollapsed = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', nowCollapsed);
      document.getElementById('adminSidebar').classList.toggle('collapsed', nowCollapsed);
      setCollapsed(nowCollapsed);

      sidebar.querySelector('.sidebar-brand').textContent = nowCollapsed ? 'PD' : 'Polyphony DB';
      this.querySelector('i').className = 'bi ' + (nowCollapsed ? 'bi-chevron-right' : 'bi-chevron-left');
    });

    document.getElementById('headerLogout').addEventListener('click', function() {
      if (window.authUtils && window.authUtils.logout) {
        window.authUtils.logout();
      } else {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userInfo');
        window.location.href = '/admin/login';
      }
    });

    // Remove old nav elements that pages may have had
    main.querySelectorAll('.auth-info, .back-to-dashboard').forEach(el => el.remove());
    main.querySelectorAll('a[href*="admin-dashboard"]').forEach(el => {
      if (el.textContent.includes('Back to Dashboard') || el.textContent.includes('Admin Dashboard')) {
        el.remove();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
