(function() {
  'use strict';

  const NAV_ITEMS = [
    { label: 'Dashboard',       icon: 'bi-speedometer2',   href: '/admin',                              adminOnly: false },
    { label: 'Sources',         icon: 'bi-book',           href: '/modules/sources/index.html',         adminOnly: false },
    { label: 'Composers',       icon: 'bi-person',         href: '/modules/composers/index.html',       adminOnly: false },
    { label: 'Editors',         icon: 'bi-pencil',         href: '/modules/editors/index.html',         adminOnly: false },
    { label: 'Scribes',         icon: 'bi-feather',        href: '/modules/scribes/index.html',         adminOnly: false },
    { label: 'Publishers',      icon: 'bi-printer',        href: '/modules/publishers/index.html',      adminOnly: false },
    { label: 'Performers',      icon: 'bi-mic',            href: '/modules/performers/index.html',      adminOnly: false },
    { label: 'Titles',          icon: 'bi-card-text',      href: '/modules/titles/index.html',          adminOnly: false },
    { label: 'Functions',       icon: 'bi-tag',            href: '/modules/functions/index.html',       adminOnly: false },
    { label: 'Groups / Editions / Recordings', icon: 'bi-vinyl', href: '/group-management.html', adminOnly: true, smallLabel: true },
    { label: 'Clef / Voicings', icon: 'custom-treble-clef', href: '/modules/clef-voicings/index.html', adminOnly: true },
    { label: 'Users',           icon: 'bi-people',         href: '/user-management.html',               adminOnly: true }
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
    if (href === '/admin') {
      return path === '/admin' || path === '/admin/' || path === '/admin-dashboard.html';
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
    html += `<button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">
      <i class="bi ${collapsed ? 'bi-chevron-right' : 'bi-chevron-left'}"></i>
    </button>`;
    html += '</div>';

    html += '<ul class="sidebar-nav">';
    for (const item of NAV_ITEMS) {
      const active = isActive(item.href) ? ' active' : '';
      const adminClass = item.adminOnly ? ' admin-only' : '';
      const labelStyle = item.smallLabel ? ' style="font-size:0.75rem;line-height:1.15"' : '';
      const iconHtml = item.icon === 'custom-treble-clef'
        ? '<span class="sidebar-treble-clef">\uD834\uDD1E</span>'
        : `<i class="bi ${item.icon}"></i>`;
      html += `<li class="sidebar-item${active}${adminClass}">
        <a href="${item.href}" class="sidebar-link" title="${item.label}">
          ${iconHtml}
          <span class="sidebar-label"${labelStyle}>${item.label}</span>
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

    document.getElementById('sidebarToggle').addEventListener('click', function() {
      const nowCollapsed = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', nowCollapsed);
      document.getElementById('adminSidebar').classList.toggle('collapsed', nowCollapsed);
      setCollapsed(nowCollapsed);
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

    main.querySelectorAll('.auth-info, .back-to-dashboard').forEach(el => el.remove());
    main.querySelectorAll('a[href*="admin-dashboard"], a[href="/admin"]').forEach(el => {
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
