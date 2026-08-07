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
  const AUTO_REFRESH_INTERVAL_MS = 60000; // 1 minute auto-refresh
  let autoRefreshTimer = null;

  // Initialize application
  function init() {
    if (!window.ELECTION_DATA) {
      console.warn('Election data payload missing at start. Attempting dynamic load of ./data.js...');
      loadDataJsAndInit();
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

    // Start 1-minute auto-refresh timer
    startAutoRefreshTimer();

    // Location & Scroll position preservation after rendering
    setTimeout(restoreSavedLocation, 150);
  }

  function loadDataJsAndInit() {
    const script = document.createElement('script');
    script.src = `./data.js?v=${Date.now()}`;
    script.onload = function() {
      if (window.ELECTION_DATA) {
        init();
      } else {
        console.error('Failed to parse window.ELECTION_DATA from ./data.js');
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    script.onerror = function() {
      console.error('Failed to load ./data.js over network.');
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    document.head.appendChild(script);
  }

  function startAutoRefreshTimer() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(refreshDataSilently, AUTO_REFRESH_INTERVAL_MS);
  }

  function refreshDataSilently() {
    const newScript = document.createElement('script');
    newScript.src = `./data.js?v=${Date.now()}`;
    newScript.onload = function() {
      if (window.ELECTION_DATA) {
        electionData = window.ELECTION_DATA;
        renderNavbarMetadata();
        renderDashboard();
        renderReportingTable();
      }
      if (newScript.parentNode) {
        newScript.parentNode.removeChild(newScript);
      }
    };
    newScript.onerror = function() {
      console.warn('Silent auto-refresh failed to fetch updated data.js');
    };
    document.head.appendChild(newScript);
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

    if (slideshowActive) {
      renderCurrentSlide();
      if (!isPaused) startSlideTimer(true);
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

    if (slideshowActive) {
      renderCurrentSlide();
      if (!isPaused) startSlideTimer(true);
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
    const statEarlyVal = document.getElementById('stat-early-val');
    const statEarlySub = document.getElementById('stat-early-sub');
    const turnoutFill = document.getElementById('turnout-fill');
    const reportingFill = document.getElementById('reporting-fill');

    const overallRepCapped = Math.min(data.overallPrecinctsReporting || 0, MAX_PRECINCT_CAP);
    const overallTotCapped = Math.min(data.overallPrecinctsTotal || MAX_PRECINCT_CAP, MAX_PRECINCT_CAP);
    const reportingPct = overallTotCapped > 0 ? (overallRepCapped / overallTotCapped * 100) : 0;

    const statBallotsRep = document.getElementById('stat-ballots-rep');
    const statBallotsDem = document.getElementById('stat-ballots-dem');
    const statBallotsGen = document.getElementById('stat-ballots-gen');

    if (heroTitle) heroTitle.textContent = `${data.county} County ${data.electionTitle}`;
    if (heroDate) heroDate.textContent = data.electionDate;
    if (statusText) statusText.textContent = data.statusLabel || 'UNOFFICIAL RESULTS';
    if (statVoters) statVoters.textContent = data.totalVoters.toLocaleString();
    if (statBallots) statBallots.textContent = data.totalBallots.toLocaleString();
    if (statBallotsRep) statBallotsRep.textContent = (data.ballotsRep || 0).toLocaleString();
    if (statBallotsDem) statBallotsDem.textContent = (data.ballotsDem || 0).toLocaleString();
    if (statBallotsGen) statBallotsGen.textContent = (data.ballotsGen || 0).toLocaleString();
    if (statTurnout) statTurnout.textContent = `${data.turnoutPercent.toFixed(2)}%`;
    if (statReporting) statReporting.textContent = `${overallRepCapped} of ${overallTotCapped} Precincts`;

    if (statEarlyVal) {
      const hasBallots = (data.totalBallots || 0) > 0;
      const earlyRep = hasBallots && ((data.earlyVotingReporting !== undefined) ? data.earlyVotingReporting : (data.hasEarlyUpload ? 1 : 0)) ? 1 : 0;
      const earlyTot = data.earlyVotingTotal || 1;
      const earlyBadge = earlyRep > 0 ? '&#x2705;' : '&#x23F3;';
      statEarlyVal.innerHTML = `${earlyBadge} Early &amp; Absentee: ${earlyRep} of ${earlyTot} (${earlyRep > 0 ? 'Complete' : 'Pending'})`;
    }
    if (turnoutFill) turnoutFill.style.width = `${Math.min(data.turnoutPercent, 100)}%`;
    if (reportingFill) reportingFill.style.width = `${Math.min(reportingPct, 100)}%`;

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
              &#x1F5F3;&#xFE0F; ${cRepCapped} of ${cTotCapped} Election Day Precincts Reporting &#x25BE;
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
    const earlyTableBody = document.getElementById('early-reporting-table-body');
    const tableBody = document.getElementById('reporting-table-body');
    if (!tableBody && !earlyTableBody) return;

    const data = getCurrentDataset();
    if (!data || !data.contests) return;

    const hasBallots = (data.totalBallots || 0) > 0;
    const earlyRep = hasBallots && ((data.earlyVotingReporting !== undefined) ? data.earlyVotingReporting : (data.hasEarlyUpload ? 1 : 0)) ? 1 : 0;
    const earlyTot = data.earlyVotingTotal || 1;
    const earlyStatusBadge = earlyRep > 0 ? 
      '<span style="color:#16a34a; font-weight:700;">&#x2705; COMPLETE</span>' : 
      '<span style="color:var(--primary); font-weight:700;">&#x23F3; IN PROGRESS (0.0%)</span>';

    const earlyVotesCount = (data.earlyBallotsCast !== undefined) ? data.earlyBallotsCast : (earlyRep > 0 ? data.totalBallots : 0);

    if (earlyTableBody) {
      earlyTableBody.innerHTML = `
        <tr style="font-weight: 600;">
          <td style="font-weight:700; color:var(--primary);">
            &#x1F4EC; Early Voting/NH, Absentee &amp; UOCAVA
          </td>
          <td>Early Voting, Nursing Home, Absentee &amp; Military Ballots</td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px; font-weight:700; padding:4px 10px; background:var(--surface); border:1px solid var(--border); border-radius:12px; font-size:13px;">
              &#x1F4EC; ${earlyRep} of ${earlyTot}
            </span>
          </td>
          <td>${earlyStatusBadge}</td>
          <td style="font-weight:700;">${earlyVotesCount.toLocaleString()}</td>
        </tr>
      `;
    }

    if (tableBody) {
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
    if (modalSubtitleEl) modalSubtitleEl.textContent = `${cRepCapped} of ${cTotCapped} Election Day Precincts Reported (${contest.voteFor})`;
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
    csvRows.push(['Election', 'County', 'Contest', 'Vote For', 'Election Day Precincts Reporting', 'Total Precincts', 'Candidate', 'Party', 'Votes', 'Percentage']);

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

  // Slideshow Presentation Engine State
  let slideshowActive = false;
  let currentSlideIndex = 0;
  let slideIntervalMs = 8000;
  let isPaused = false;
  let slideTimer = null;
  let slideProgressTimer = null;

  function initSlideshow() {
    slideshowActive = true;
    currentSlideIndex = 0;
    renderTicker();
    populateSlideJumpMenu();
    renderCurrentSlide();
    startSlideTimer();
  }

  function formatCompactDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
    return dateStr;
  }

  function renderTicker() {
    const data = getCurrentDataset();
    if (!data) return;

    const tStatus = document.getElementById('ticker-status');
    const tDate = document.getElementById('ticker-date');
    const tVoters = document.getElementById('ticker-voters');
    const tBallots = document.getElementById('ticker-ballots');
    const tTurnout = document.getElementById('ticker-turnout');
    const tEarly = document.getElementById('ticker-early');
    const tReporting = document.getElementById('ticker-reporting');

    const overallRepCapped = Math.min(data.overallPrecinctsReporting || 0, MAX_PRECINCT_CAP);
    const overallTotCapped = Math.min(data.overallPrecinctsTotal || MAX_PRECINCT_CAP, MAX_PRECINCT_CAP);
    const hasBallots = (data.totalBallots || 0) > 0;
    const earlyRep = hasBallots && ((data.earlyVotingReporting !== undefined) ? data.earlyVotingReporting : (data.hasEarlyUpload ? 1 : 0)) ? 1 : 0;
    const earlyTot = data.earlyVotingTotal || 1;

    if (tStatus) tStatus.innerHTML = `&#x25CF; ${escapeHtml(data.statusLabel || 'UNOFFICIAL RESULTS')}`;
    if (tDate) tDate.textContent = formatCompactDate(data.electionDate) || data.electionDate || '';
    if (tVoters) tVoters.textContent = data.totalVoters ? data.totalVoters.toLocaleString() : '0';
    if (tBallots) tBallots.textContent = data.totalBallots ? data.totalBallots.toLocaleString() : '0';
    if (tTurnout) tTurnout.textContent = `${data.turnoutPercent.toFixed(2)}%`;
    if (tEarly) tEarly.textContent = `${earlyRep} of ${earlyTot} (${earlyRep > 0 ? 'Reported' : 'Pending'})`;
    if (tReporting) tReporting.textContent = `${overallRepCapped} of ${overallTotCapped} Precincts`;
  }

  const CANDIDATES_PER_SLIDE = 6;

  function getSlideList() {
    const data = getCurrentDataset();
    if (!data || !data.contests) return [];

    const slides = [{ type: 'summary' }];

    data.contests.forEach(contest => {
      const cands = contest.candidates || [];
      if (cands.length <= CANDIDATES_PER_SLIDE) {
        slides.push({
          type: 'contest',
          contest: contest,
          candidates: cands,
          pageNum: 1,
          totalPages: 1
        });
      } else {
        const totalPages = Math.ceil(cands.length / CANDIDATES_PER_SLIDE);
        for (let p = 0; p < totalPages; p++) {
          const chunk = cands.slice(p * CANDIDATES_PER_SLIDE, (p + 1) * CANDIDATES_PER_SLIDE);
          slides.push({
            type: 'contest',
            contest: contest,
            candidates: chunk,
            pageNum: p + 1,
            totalPages: totalPages
          });
        }
      }
    });

    return slides;
  }

  function populateSlideJumpMenu() {
    const menu = document.getElementById('slide-jump-menu');
    if (!menu) return;

    const slides = getSlideList();
    let html = '';
    slides.forEach((s, idx) => {
      if (s.type === 'summary') {
        html += `<option value="${idx}">Slide ${idx + 1}: Election Summary</option>`;
      } else {
        const pageLabel = s.totalPages > 1 ? ` (${s.pageNum}/${s.totalPages})` : '';
        html += `<option value="${idx}">Slide ${idx + 1}: ${escapeHtml(s.contest.title)}${pageLabel}</option>`;
      }
    });

    menu.innerHTML = html;
  }

  function reloadDataFresh() {
    // Re-fetch window.ELECTION_DATA dynamically to pick up any updated data.js content
    if (window.ELECTION_DATA) {
      electionData = window.ELECTION_DATA;
      renderTicker();
    }
  }

  function renderCurrentSlide() {
    reloadDataFresh();

    const viewport = document.getElementById('slide-viewport');
    if (!viewport) return;

    const slides = getSlideList();
    const totalSlides = slides.length;
    if (totalSlides === 0) return;

    if (currentSlideIndex < 0) currentSlideIndex = 0;
    if (currentSlideIndex >= totalSlides) currentSlideIndex = 0;

    const menu = document.getElementById('slide-jump-menu');
    if (menu) menu.value = currentSlideIndex;

    const currentSlideObj = slides[currentSlideIndex];
    if (!currentSlideObj) return;

    // Slide 0: Overall Election Summary
    if (currentSlideObj.type === 'summary') {
      const data = getCurrentDataset();
      const overallRepCapped = Math.min(data.overallPrecinctsReporting || 0, MAX_PRECINCT_CAP);
      const overallTotCapped = Math.min(data.overallPrecinctsTotal || MAX_PRECINCT_CAP, MAX_PRECINCT_CAP);
      const hasBallots = (data.totalBallots || 0) > 0;
      const earlyRep = hasBallots && ((data.earlyVotingReporting !== undefined) ? data.earlyVotingReporting : (data.hasEarlyUpload ? 1 : 0)) ? 1 : 0;
      const earlyTot = data.earlyVotingTotal || 1;

      viewport.innerHTML = `
        <article class="slide-card">
          <header class="slide-header">
            <div>
              <h1 class="slide-title">${escapeHtml(data.county)} County ${escapeHtml(data.electionTitle)}</h1>
              <div style="font-size: clamp(14px, 1.2vw, 18px); color:var(--neutral-muted); margin-top:4px;">Overall Election Night Progress Overview</div>
            </div>
            <div class="slide-meta">&#x1F4CA; Slide 1 of ${totalSlides} &bull; Summary</div>
          </header>

          <div class="slide-content-grid">
            <!-- Column 1: Turnout & Precinct Progress Bars -->
            <div>
              <div class="proj-chart-list">
                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>Registered Voters</span>
                    <span style="color:var(--primary); font-weight:800;">${data.totalVoters.toLocaleString()}</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: 100%; background:var(--primary);"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>Total Ballots Cast</span>
                    <span style="color:var(--primary); font-weight:800;">${data.totalBallots.toLocaleString()}</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${Math.min(data.turnoutPercent, 100)}%; background:var(--primary);"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>&bull; Republican Primary</span>
                    <span style="color:var(--primary); font-weight:700;">${(data.ballotsRep || 0).toLocaleString()}</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${data.totalBallots ? Math.min(((data.ballotsRep || 0) / data.totalBallots * 100), 100) : 0}%; background:#dc2626;"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>&bull; Democrat Primary</span>
                    <span style="color:var(--primary); font-weight:700;">${(data.ballotsDem || 0).toLocaleString()}</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${data.totalBallots ? Math.min(((data.ballotsDem || 0) / data.totalBallots * 100), 100) : 0}%; background:#2563eb;"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>&bull; General Election Only</span>
                    <span style="color:var(--primary); font-weight:700;">${(data.ballotsGen || 0).toLocaleString()}</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${data.totalBallots ? Math.min(((data.ballotsGen || 0) / data.totalBallots * 100), 100) : 0}%; background:#6b7280;"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>Voter Turnout Rate</span>
                    <span style="color:var(--primary); font-weight:800;">${data.turnoutPercent.toFixed(2)}%</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${Math.min(data.turnoutPercent, 100)}%; background:var(--secondary);"></div></div>
                </div>

                <div class="proj-cand-bar-item">
                  <div class="proj-cand-header">
                    <span>Election Day Precincts Reporting</span>
                    <span style="color:#16a34a; font-weight:800;">${overallRepCapped} of ${overallTotCapped} (${((overallRepCapped / (overallTotCapped || 1)) * 100).toFixed(1)}%)</span>
                  </div>
                  <div class="proj-track"><div class="proj-fill" style="width: ${(overallRepCapped / (overallTotCapped || 1)) * 100}%; background:#16a34a;"></div></div>
                </div>
              </div>
            </div>

            <!-- Column 2: Reporting Status Table -->
            <div>
              <table class="proj-table" role="table">
                <thead>
                  <tr>
                    <th>Reporting Category</th>
                    <th>Status Progress</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="font-weight:700; color:var(--primary);">&#x1F4EC; Early &amp; Absentee</td>
                    <td style="font-weight:800;">${earlyRep} of ${earlyTot}</td>
                    <td style="font-weight:700;">${earlyRep > 0 ? '<span style="color:#16a34a;">&#x2705; COMPLETE</span>' : '<span style="color:var(--primary);">&#x23F3; PENDING</span>'}</td>
                  </tr>
                  <tr>
                    <td style="font-weight:700; color:var(--primary);">&#x1F5F3;&#xFE0F; Election Day Precincts</td>
                    <td style="font-weight:800;">${overallRepCapped} of ${overallTotCapped}</td>
                    <td style="font-weight:700;">${overallRepCapped === overallTotCapped && overallTotCapped > 0 ? '<span style="color:#16a34a;">&#x2705; COMPLETE</span>' : '<span style="color:var(--primary);">&#x23F3; IN PROGRESS</span>'}</td>
                  </tr>
                  <tr>
                    <td style="font-weight:700; color:#dc2626;">&bull; Republican Primary</td>
                    <td style="font-weight:800;">${(data.ballotsRep || 0).toLocaleString()}</td>
                    <td style="font-weight:700;"><span style="color:var(--neutral-muted);">Ballots Cast</span></td>
                  </tr>
                  <tr>
                    <td style="font-weight:700; color:#2563eb;">&bull; Democrat Primary</td>
                    <td style="font-weight:800;">${(data.ballotsDem || 0).toLocaleString()}</td>
                    <td style="font-weight:700;"><span style="color:var(--neutral-muted);">Ballots Cast</span></td>
                  </tr>
                  <tr>
                    <td style="font-weight:700; color:#4b5563;">&bull; General Election Only</td>
                    <td style="font-weight:800;">${(data.ballotsGen || 0).toLocaleString()}</td>
                    <td style="font-weight:700;"><span style="color:var(--neutral-muted);">Ballots Cast</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Slide 1 Bottom Anchored Notices -->
          <footer class="slide-footer-notices">
            <div class="disclaimer-banner">
              <span>&#x2139;&#xFE0F;</span>
              <span><strong>Reporting Notice:</strong> Reaching 100% Election Day precincts reporting generally takes about 3 hours after polls close.</span>
            </div>
            <div class="disclaimer-banner">
              <span>&#x2139;&#xFE0F;</span>
              <span><strong>Results Notice:</strong> Precinct-level results are made available within 1 to 2 business days after Election Day.</span>
            </div>
          </footer>
        </article>
      `;
      return;
    }

    // Contest Slides (5 candidates max per chunk)
    const contest = currentSlideObj.contest;
    const candidates = currentSlideObj.candidates;
    const pageNum = currentSlideObj.pageNum;
    const totalPages = currentSlideObj.totalPages;

    const cTitleEsc = escapeHtml(contest.title);
    const cRepCapped = Math.min(contest.precinctsReporting || 0, MAX_PRECINCT_CAP);
    const cTotCapped = Math.min(contest.precinctsTotal || 0, MAX_PRECINCT_CAP);

    let chartBarsHtml = '';
    let tableRowsHtml = '';

    candidates.forEach(cand => {
      const partyClass = cand.party === 'REP' ? 'party-rep' : cand.party === 'DEM' ? 'party-dem' : 'party-ind';
      const fillColor = cand.party === 'REP' ? 'var(--party-rep)' : cand.party === 'DEM' ? 'var(--party-dem)' : 'var(--party-ind)';

      chartBarsHtml += `
        <div class="proj-cand-bar-item">
          <div class="proj-cand-header">
            <span>
              ${escapeHtml(cand.name)}
              ${cand.party ? `<span class="party-pill ${partyClass}">${escapeHtml(cand.party)}</span>` : ''}
              ${cand.isLeading && contest.totalVotes > 0 ? '<span class="leading-tag">&#x2714;&#xFE0F; LEADING</span>' : ''}
            </span>
            <span>${cand.votes.toLocaleString()} (${cand.percentage.toFixed(1)}%)</span>
          </div>
          <div class="proj-track">
            <div class="proj-fill" style="width: ${Math.min(cand.percentage, 100)}%; background: ${fillColor};"></div>
          </div>
        </div>
      `;

      tableRowsHtml += `
        <tr>
          <td style="font-weight:700;">
            ${escapeHtml(cand.name)}
            ${cand.party ? `<span class="party-pill ${partyClass}" style="margin-left:6px;">${escapeHtml(cand.party)}</span>` : ''}
          </td>
          <td style="font-weight:800; text-align:right;">${cand.votes.toLocaleString()}</td>
          <td style="font-weight:800; text-align:right; color:var(--primary);">${cand.percentage.toFixed(1)}%</td>
        </tr>
      `;
    });

    viewport.innerHTML = `
      <article class="slide-card">
        <header class="slide-header">
          <div>
            <h1 class="slide-title">${cTitleEsc}${totalPages > 1 ? `<span style="font-size:0.7em; color:var(--neutral-muted); margin-left:10px;">(Page ${pageNum} of ${totalPages})</span>` : ''}</h1>
            <div style="font-size: clamp(14px, 1.2vw, 18px); color:var(--neutral-muted); margin-top:4px;">
              <span>${escapeHtml(contest.voteFor)}</span> &bull; 
              <span>Total Votes: ${contest.totalVotes.toLocaleString()}</span>
            </div>
          </div>
          <div class="slide-meta">
            &#x1F4CA; Slide ${currentSlideIndex + 1} of ${totalSlides} &bull; &#x1F5F3;&#xFE0F; ${cRepCapped} of ${cTotCapped} ED Precincts
          </div>
        </header>

        <div class="slide-content-grid">
          <div class="proj-chart-list">
            ${chartBarsHtml}
          </div>

          <div>
            <table class="proj-table" role="table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th style="text-align:right;">Votes</th>
                  <th style="text-align:right;">Pct</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    `;
  }

  let slideElapsedMs = 0;
  let slideStartTime = 0;

  function startSlideTimer(resume) {
    stopSlideTimer();
    if (isPaused || !slideshowActive) return;

    if (resume && slideElapsedMs > 0) {
      slideStartTime = Date.now() - slideElapsedMs;
    } else {
      slideElapsedMs = 0;
      slideStartTime = Date.now();
    }

    const timerBar = document.getElementById('slide-timer-bar');

    slideProgressTimer = setInterval(() => {
      if (isPaused || !slideshowActive) return;
      slideElapsedMs = Date.now() - slideStartTime;
      const pct = Math.min((slideElapsedMs / slideIntervalMs) * 100, 100);
      if (timerBar) timerBar.style.width = `${pct}%`;

      if (slideElapsedMs >= slideIntervalMs) {
        slideElapsedMs = 0;
        nextSlide();
      }
    }, 100);
  }

  function stopSlideTimer() {
    if (slideProgressTimer) {
      clearInterval(slideProgressTimer);
      slideProgressTimer = null;
    }
    const timerBar = document.getElementById('slide-timer-bar');
    if (timerBar) timerBar.style.width = '0%';
  }

  function nextSlide() {
    const slides = getSlideList();
    const totalSlides = slides.length || 1;
    currentSlideIndex = (currentSlideIndex + 1) % totalSlides;
    renderCurrentSlide();
    startSlideTimer();
  }

  function prevSlide() {
    const slides = getSlideList();
    const totalSlides = slides.length || 1;
    currentSlideIndex = (currentSlideIndex - 1 + totalSlides) % totalSlides;
    renderCurrentSlide();
    startSlideTimer();
  }

  function jumpToSlide(idx) {
    currentSlideIndex = parseInt(idx, 10) || 0;
    renderCurrentSlide();
    startSlideTimer();
  }

  function togglePause() {
    isPaused = !isPaused;
    const btn = document.getElementById('btn-playpause');
    if (btn) {
      btn.innerHTML = isPaused ? '&#x25B6;&#xFE0F; Play' : '&#x23F8;&#xFE0F; Pause';
      btn.classList.toggle('active', !isPaused);
    }
    if (isPaused) {
      stopSlideTimer();
    } else {
      startSlideTimer();
    }
  }

  function setSlideSpeed(speedVal) {
    slideIntervalMs = parseInt(speedVal, 10) || 8000;
    startSlideTimer();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Fullscreen request failed:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
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
    exportCSV: exportCSV,

    // Slideshow Engine Exports
    initSlideshow: initSlideshow,
    nextSlide: nextSlide,
    prevSlide: prevSlide,
    jumpToSlide: jumpToSlide,
    togglePause: togglePause,
    setSlideSpeed: setSlideSpeed,
    toggleFullscreen: toggleFullscreen
  };
})();

