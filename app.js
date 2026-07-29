/**
 * Hamilton County Election Commission - Election Night Results Dashboard Controller
 * Fully compliant with HTML Development Playbook (DNN CMS, Mobile & WCAG 2.1 AA)
 */

window.ElectionApp = (function() {
  'use strict';

  // Application State
  let electionData = null;
  let activePartyFilter = 'ALL';
  let searchQuery = '';
  let isDarkMode = false;
  let isHighContrast = false;

  // Modal State
  let currentModalContest = null;
  let modalFilter = 'ALL';
  let modalSearch = '';

  const MAX_PRECINCT_CAP = 92;

  // Initialize application
  function init() {
    if (!window.ELECTION_DATA) {
      console.error('Election data payload missing.');
      return;
    }

    electionData = window.ELECTION_DATA;

    renderNavbarMetadata();
    renderDashboard();

    // Attach search listener
    const searchInput = document.getElementById('contest-search');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        searchQuery = e.target.value.trim().toLowerCase();
        renderContests();
      });
    }

    // Attach scroll listener for Back-to-Top button
    window.addEventListener('scroll', handleScrollState);

    // Attach ESC key listener for modal closure
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closePrecinctModal();
      }
    });

    // Location & Scroll position preservation after rendering
    setTimeout(restoreSavedLocation, 150);
  }

  function renderNavbarMetadata() {
    const meta = electionData.metadata || {};
    const subTitleEl = document.getElementById('navbar-subtitle');
    if (subTitleEl) {
      const county = meta.county || 'Hamilton';
      const date = meta.electionDate || '';
      subTitleEl.textContent = `${county} County, TN - ${date}`;
    }
  }

  function setPartyFilter(party) {
    activePartyFilter = party;
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      if (btn.getAttribute('data-party') === party) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });
    renderContests();
  }

  function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    if (isDarkMode && isHighContrast) {
      isHighContrast = false;
      document.body.classList.remove('high-contrast');
    }
    document.body.classList.toggle('dark-mode', isDarkMode);

    const darkBtn = document.getElementById('dark-mode-toggle');
    if (darkBtn) {
      darkBtn.setAttribute('aria-pressed', isDarkMode ? 'true' : 'false');
      darkBtn.innerHTML = isDarkMode ? '&#x2600;&#xFE0F; Light Mode' : '&#x1F319; Dark Mode';
    }
  }

  function toggleHighContrast() {
    isHighContrast = !isHighContrast;
    if (isHighContrast && isDarkMode) {
      isDarkMode = false;
      document.body.classList.remove('dark-mode');
    }
    document.body.classList.toggle('high-contrast', isHighContrast);

    const contrastBtn = document.getElementById('contrast-toggle');
    if (contrastBtn) {
      contrastBtn.setAttribute('aria-pressed', isHighContrast ? 'true' : 'false');
      contrastBtn.innerHTML = isHighContrast ? '&#x2600;&#xFE0F; Standard Contrast' : '&#x1F317; High Contrast';
    }
  }

  function refreshResults() {
    sessionStorage.setItem('scrollPosY', window.scrollY);
    const watched = sessionStorage.getItem('watchedContest') || (window.location.hash ? window.location.hash.substring(1) : '');
    if (watched) {
      sessionStorage.setItem('watchedContest', watched);
    }
    window.location.reload();
  }

  function getCurrentDataset() {
    return electionData.latest || electionData;
  }

  function renderDashboard() {
    const data = getCurrentDataset();
    if (!data) return;

    // Render Hero Turnout Metrics
    const heroTitle = document.getElementById('hero-title');
    const heroDate = document.getElementById('hero-date');
    const statusText = document.getElementById('status-text');
    const statVoters = document.getElementById('stat-voters');
    const statBallots = document.getElementById('stat-ballots');
    const statTurnout = document.getElementById('stat-turnout');
    const statReporting = document.getElementById('stat-reporting');
    const turnoutFill = document.getElementById('turnout-fill');

    const overallRepCapped = Math.min(data.overallPrecinctsReporting || 0, MAX_PRECINCT_CAP);
    const overallTotCapped = Math.min(data.overallPrecinctsTotal || MAX_PRECINCT_CAP, MAX_PRECINCT_CAP);

    if (heroTitle) heroTitle.textContent = `${data.county} County ${data.electionTitle}`;
    if (heroDate) heroDate.textContent = data.electionDate;
    if (statusText) statusText.textContent = data.statusLabel || 'UNOFFICIAL RESULTS';
    if (statVoters) statVoters.textContent = data.totalVoters.toLocaleString();
    if (statBallots) statBallots.textContent = data.totalBallots.toLocaleString();
    if (statTurnout) statTurnout.textContent = `${data.turnoutPercent.toFixed(2)}%`;
    if (statReporting) statReporting.textContent = `${overallRepCapped} of ${overallTotCapped} Precincts Reporting`;
    if (turnoutFill) turnoutFill.style.width = `${Math.min(data.turnoutPercent, 100)}%`;

    renderContests();
    renderReportingTable();
    populateJumpMenu();
  }

  function populateJumpMenu() {
    const jumpSelect = document.getElementById('contest-jump-menu');
    if (!jumpSelect) return;

    const data = getCurrentDataset();
    if (!data || !data.contests) return;

    let optionsHtml = '<option value="">&#x1F4CC; Jump to Contest...</option>';
    data.contests.forEach(contest => {
      const slug = slugify(contest.title);
      optionsHtml += `<option value="${slug}">${escapeHtml(contest.title)}</option>`;
    });

    jumpSelect.innerHTML = optionsHtml;
    jumpSelect.selectedIndex = 0;
  }

  function jumpToContest(slug) {
    if (!slug) return;
    const targetEl = document.getElementById(`contest-card-${slug}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.location.hash = `#${slug}`;
      sessionStorage.setItem('watchedContest', slug);
    }
    const jumpSelect = document.getElementById('contest-jump-menu');
    if (jumpSelect) {
      setTimeout(() => {
        jumpSelect.selectedIndex = 0;
      }, 300);
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.location.hash) {
      history.pushState('', document.title, window.location.pathname + window.location.search);
    }
    sessionStorage.removeItem('watchedContest');
  }

  function handleScrollState() {
    const topBtn = document.getElementById('back-to-top');
    if (topBtn) {
      if (window.scrollY > 300) {
        topBtn.classList.add('visible');
      } else {
        topBtn.classList.remove('visible');
      }
    }
    sessionStorage.setItem('scrollPosY', window.scrollY);
  }

  function restoreSavedLocation() {
    let slug = window.location.hash ? window.location.hash.substring(1) : '';
    if (!slug) {
      slug = sessionStorage.getItem('watchedContest') || '';
    }

    if (slug) {
      const targetEl = document.getElementById(`contest-card-${slug}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    const savedY = sessionStorage.getItem('scrollPosY');
    if (savedY && !isNaN(savedY) && parseInt(savedY, 10) > 100) {
      window.scrollTo({ top: parseInt(savedY, 10), behavior: 'smooth' });
    }
  }

  function renderContests() {
    const data = getCurrentDataset();
    const container = document.getElementById('contests-container');
    if (!container || !data || !data.contests) return;

    const filteredContests = data.contests.filter(contest => {
      if (searchQuery) {
        const matchesTitle = contest.title.toLowerCase().includes(searchQuery);
        const matchesCandidate = contest.candidates.some(c => c.name.toLowerCase().includes(searchQuery));
        if (!matchesTitle && !matchesCandidate) return false;
      }

      if (activePartyFilter !== 'ALL') {
        if (activePartyFilter === 'REP') {
          const hasRepInTitle = /\bREP\b/i.test(contest.title);
          const hasRepCand = contest.candidates.some(c => c.party === 'REP');
          return hasRepInTitle || hasRepCand;
        } else if (activePartyFilter === 'DEM') {
          const hasDemInTitle = /\bDEM\b/i.test(contest.title);
          const hasDemCand = contest.candidates.some(c => c.party === 'DEM');
          return hasDemInTitle || hasDemCand;
        } else if (activePartyFilter === 'IND') {
          const titleUpper = contest.title.toUpperCase();
          const hasDemOrRepInTitle = /\b(DEM|REP)\b/.test(titleUpper);
          const hasIndOrNonPartisanCand = contest.candidates.some(c => c.party === 'IND' || !c.party);
          return !hasDemOrRepInTitle && hasIndOrNonPartisanCand;
        }
      }
      return true;
    });

    if (filteredContests.length === 0) {
      container.innerHTML = `
        <div style="background:var(--surface); border:1px solid var(--border); padding:40px; text-align:center; border-radius:var(--radius-md); font-weight:600; color:var(--neutral-muted);">
          No matching contests found.
        </div>
      `;
      return;
    }

    let html = '';
    filteredContests.forEach(contest => {
      const cTitleEsc = escapeHtml(contest.title);
      const cSlug = slugify(contest.title);
      const cRepCapped = Math.min(contest.precinctsReporting || 0, MAX_PRECINCT_CAP);
      const cTotCapped = Math.min(contest.precinctsTotal || 0, MAX_PRECINCT_CAP);

      html += `
        <article id="contest-card-${cSlug}" class="contest-card" aria-labelledby="contest-title-${cSlug}">
          <header class="contest-header">
            <div>
              <h2 id="contest-title-${cSlug}" class="contest-title">${cTitleEsc}</h2>
              <div class="contest-meta" style="margin-top:4px;">
                <span>${escapeHtml(contest.voteFor)}</span>
                <span>&bull;</span>
                <span>Total Votes: ${contest.totalVotes.toLocaleString()}</span>
              </div>
            </div>
            <button type="button" class="reporting-btn" onclick="ElectionApp.openPrecinctModal('${escapeJsString(contest.title)}')" aria-label="View Precinct Reporting Status for ${cTitleEsc}">
              &#x1F5F3;&#xFE0F; ${cRepCapped} of ${cTotCapped} Precincts Reporting &#x25BE;
            </button>
          </header>
          <div class="contest-body">
            <table class="candidates-table" role="table" aria-label="Candidates for ${cTitleEsc}">
              <tbody role="rowgroup">
      `;

      contest.candidates.forEach(cand => {
        const partyClass = cand.party === 'REP' ? 'party-rep' : cand.party === 'DEM' ? 'party-dem' : 'party-ind';
        const fillClass = cand.party === 'REP' ? 'fill-rep' : cand.party === 'DEM' ? 'fill-dem' : 'fill-ind';

        html += `
          <tr class="candidate-row" role="row">
            <td class="cand-name-cell" role="cell">
              <span>${escapeHtml(cand.name)}</span>
              ${cand.party ? `<span class="party-pill ${partyClass}">${escapeHtml(cand.party)}</span>` : ''}
              ${cand.isLeading && contest.totalVotes > 0 ? '<span class="leading-tag">&#x2714;&#xFE0F; LEADING</span>' : ''}
            </td>
            <td class="cand-bar-cell" role="cell">
              <div class="progress-track" aria-hidden="true">
                <div class="progress-fill ${fillClass}" style="width: ${Math.min(cand.percentage, 100)}%;"></div>
              </div>
            </td>
            <td class="cand-votes-cell" role="cell">
              <span class="vote-count">${cand.votes.toLocaleString()}</span>
              <span class="vote-percent">(${cand.percentage.toFixed(1)}%)</span>
            </td>
          </tr>
        `;
      });

      html += `
              </tbody>
            </table>
          </div>
        </article>
      `;
    });

    container.innerHTML = html;
  }

  function renderReportingTable() {
    const tableBody = document.getElementById('reporting-table-body');
    if (!tableBody) return;

    const data = getCurrentDataset();
    if (!data || !data.contests) return;

    let html = '';
    data.contests.forEach(contest => {
      const cRepCapped = Math.min(contest.precinctsReporting || 0, MAX_PRECINCT_CAP);
      const cTotCapped = Math.min(contest.precinctsTotal || 0, MAX_PRECINCT_CAP);
      const pct = cTotCapped > 0 ? (cRepCapped / cTotCapped * 100).toFixed(1) : '0.0';

      const statusBadge = cRepCapped === cTotCapped && cTotCapped > 0 ? 
        '<span style="color:#16a34a; font-weight:700;">&#x2705; COMPLETE</span>' : 
        `<span style="color:var(--primary); font-weight:700;">&#x23F3; IN PROGRESS (${pct}%)</span>`;

      html += `
        <tr>
          <td style="font-weight:700;">${escapeHtml(contest.title)}</td>
          <td>${escapeHtml(contest.voteFor)}</td>
          <td>
            <button type="button" class="reporting-btn" onclick="ElectionApp.openPrecinctModal('${escapeJsString(contest.title)}')" aria-label="View Precinct Breakdown for ${escapeHtml(contest.title)}">
              &#x1F5F3;&#xFE0F; ${cRepCapped} of ${cTotCapped} &#x25BE;
            </button>
          </td>
          <td>${statusBadge}</td>
          <td style="font-weight:700;">${contest.totalVotes.toLocaleString()}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  }

  // Precinct Reporting Visual Modal Logic
  function openPrecinctModal(contestTitle) {
    const data = getCurrentDataset();
    if (!data || !data.contests) return;

    const contest = data.contests.find(c => c.title === contestTitle);
    if (!contest) return;

    currentModalContest = contest;
    modalFilter = 'ALL';
    modalSearch = '';

    const modalTitleEl = document.getElementById('modal-title');
    const modalSubtitleEl = document.getElementById('modal-subtitle');
    const modalSearchInput = document.getElementById('modal-search-input');

    const cRepCapped = Math.min(contest.precinctsReporting || 0, MAX_PRECINCT_CAP);
    const cTotCapped = Math.min(contest.precinctsTotal || 0, MAX_PRECINCT_CAP);

    if (modalTitleEl) modalTitleEl.textContent = `${contest.title} - Precinct Reporting Breakdown`;
    if (modalSubtitleEl) modalSubtitleEl.textContent = `${cRepCapped} of ${cTotCapped} Precincts Reported (${contest.voteFor})`;
    if (modalSearchInput) modalSearchInput.value = '';

    setModalFilter('ALL');
    renderModalPrecinctGrid();

    const backdrop = document.getElementById('precinct-modal');
    if (backdrop) {
      backdrop.classList.add('active');
      backdrop.setAttribute('aria-hidden', 'false');
    }
  }

  function closePrecinctModal() {
    const backdrop = document.getElementById('precinct-modal');
    if (backdrop) {
      backdrop.classList.remove('active');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    currentModalContest = null;
  }

  function setModalFilter(filterType) {
    modalFilter = filterType;
    const filterBtns = document.querySelectorAll('.modal-filter-btn');
    filterBtns.forEach(btn => {
      if (btn.getAttribute('data-mfilter') === filterType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    renderModalPrecinctGrid();
  }

  function handleModalSearch(val) {
    modalSearch = val.trim().toLowerCase();
    renderModalPrecinctGrid();
  }

  function renderModalPrecinctGrid() {
    const gridContainer = document.getElementById('modal-precinct-grid');
    if (!gridContainer || !currentModalContest) return;

    const pList = currentModalContest.precinctsStatus || [];

    const filteredList = pList.filter(p => {
      if (modalSearch && !p.name.toLowerCase().includes(modalSearch)) {
        return false;
      }
      if (modalFilter === 'REPORTED' && !p.reported) return false;
      if (modalFilter === 'PENDING' && p.reported) return false;
      return true;
    });

    if (filteredList.length === 0) {
      gridContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--neutral-muted); font-weight: 600;">
          No precincts match filter criteria.
        </div>
      `;
      return;
    }

    let html = '';
    filteredList.forEach(p => {
      const chipClass = p.reported ? 'reported' : 'pending';
      const icon = p.reported ? '&#x2705;' : '&#x23F3;';
      const statusLabel = p.reported ? 'Reported' : 'Pending';

      html += `
        <div class="precinct-chip ${chipClass}">
          <span>${escapeHtml(p.name)}</span>
          <span style="font-size:11px; font-weight:700;">${icon} ${statusLabel}</span>
        </div>
      `;
    });

    gridContainer.innerHTML = html;
  }

  function exportCSV() {
    const data = getCurrentDataset();
    if (!data || !data.contests) return;

    let csvRows = [];
    csvRows.push(['Election', 'County', 'Contest', 'Vote For', 'Precincts Reporting', 'Total Precincts', 'Candidate', 'Party', 'Votes', 'Percentage']);

    data.contests.forEach(contest => {
      if (searchQuery) {
        const matchesTitle = contest.title.toLowerCase().includes(searchQuery);
        const matchesCandidate = contest.candidates.some(c => c.name.toLowerCase().includes(searchQuery));
        if (!matchesTitle && !matchesCandidate) return;
      }
      if (activePartyFilter !== 'ALL') {
        if (activePartyFilter === 'REP') {
          const hasRepInTitle = /\bREP\b/i.test(contest.title);
          const hasRepCand = contest.candidates.some(c => c.party === 'REP');
          if (!hasRepInTitle && !hasRepCand) return;
        } else if (activePartyFilter === 'DEM') {
          const hasDemInTitle = /\bDEM\b/i.test(contest.title);
          const hasDemCand = contest.candidates.some(c => c.party === 'DEM');
          if (!hasDemInTitle && !hasDemCand) return;
        } else if (activePartyFilter === 'IND') {
          const titleUpper = contest.title.toUpperCase();
          const hasDemOrRepInTitle = /\b(DEM|REP)\b/.test(titleUpper);
          const hasIndOrNonPartisanCand = contest.candidates.some(c => c.party === 'IND' || !c.party);
          if (hasDemOrRepInTitle || !hasIndOrNonPartisanCand) return;
        }
      }

      const cRepCapped = Math.min(contest.precinctsReporting || 0, MAX_PRECINCT_CAP);
      const cTotCapped = Math.min(contest.precinctsTotal || 0, MAX_PRECINCT_CAP);

      contest.candidates.forEach(cand => {
        csvRows.push([
          formatCsvCell(data.electionTitle),
          formatCsvCell(data.county),
          formatCsvCell(contest.title),
          formatCsvCell(contest.voteFor),
          cRepCapped,
          cTotCapped,
          formatCsvCell(cand.name),
          formatCsvCell(cand.party),
          cand.votes,
          `${cand.percentage.toFixed(2)}%`
        ]);
      });
    });

    const csvContent = csvRows.map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Hamilton_Election_Summary_Results.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function slugify(text) {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeJsString(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  function formatCsvCell(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    setPartyFilter: setPartyFilter,
    toggleDarkMode: toggleDarkMode,
    toggleHighContrast: toggleHighContrast,
    refreshResults: refreshResults,
    jumpToContest: jumpToContest,
    scrollToTop: scrollToTop,
    openPrecinctModal: openPrecinctModal,
    closePrecinctModal: closePrecinctModal,
    setModalFilter: setModalFilter,
    handleModalSearch: handleModalSearch,
    exportCSV: exportCSV
  };
})();
