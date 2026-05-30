/**
 * ==========================================================================
 * EXPENSE CAPTURE APP - CORE LOGIC & STATE CONTROLLER (CO-LEDGER)
 * ==========================================================================
 */

// --- Global Application State ---
let state = {
  expenses: [],
  fundings: [],
  activeLedgerTab: 'expenses', // 'expenses' | 'fundings'
  activeReportPeriod: 'week',  // 'day' | 'week' | 'month'
  filters: {
    search: '',
    recipientType: 'all',
    mode: 'all',
    funding: 'all'
  }
};

// --- Storage Keys ---
const STORAGE_KEY = 'co_ledger_state_v1';

// --- Sample Seed Data (For instant wow-factor demo) ---
const seedData = {
  fundings: [
    {
      id: 'f-1',
      date: getDaysAgo(10),
      amount: 150000,
      transferMode: 'Bank',
      status: 'Received',
      notes: 'Initial mobilization advance from Investor'
    },
    {
      id: 'f-2',
      date: getDaysAgo(4),
      amount: 75000,
      transferMode: 'GPay',
      status: 'Received',
      notes: 'Second advance tranche for materials'
    },
    {
      id: 'f-3',
      date: getDaysAgo(1),
      amount: 50000,
      transferMode: 'Bank',
      status: 'Delayed',
      notes: 'Delayed tranche - promised for electrical work'
    }
  ],
  expenses: [
    {
      id: 'e-1',
      date: getDaysAgo(9),
      amount: 85000,
      recipientType: 'contractor',
      recipientName: 'Vikas Earthmovers',
      paymentMode: 'Bank',
      paidFrom: 'Investor Advance',
      notes: 'Excavation & site leveling contractor'
    },
    {
      id: 'e-2',
      date: getDaysAgo(6),
      amount: 45000,
      recipientType: 'vendor',
      recipientName: 'UltraTech Cement Dealer',
      paymentMode: 'Bank',
      paidFrom: 'Investor Advance',
      notes: 'Purchased 100 bags of Grade 53 cement'
    },
    {
      id: 'e-3',
      date: getDaysAgo(3),
      amount: 35000,
      recipientType: 'contractor',
      recipientName: 'Karan Brickworks',
      paymentMode: 'Cash',
      paidFrom: 'Investor Advance',
      notes: 'Plinth level bricklaying labor charges'
    },
    {
      id: 'e-4',
      date: getDaysAgo(2),
      amount: 60000,
      recipientType: 'vendor',
      recipientName: 'Apex Steel Traders',
      paymentMode: 'GPay',
      paidFrom: 'My Hand',
      notes: 'Urgent reinforcement steel purchase (Investor fund delayed)'
    },
    {
      id: 'e-5',
      date: getDaysAgo(0),
      amount: 15000,
      recipientType: 'contractor',
      recipientName: 'Anil Centering Works',
      paymentMode: 'Cash',
      paidFrom: 'My Hand',
      notes: 'Plinth beam centering & shuttering layout'
    }
  ]
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  
  // Set default dates in form inputs
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('expense-date').value = todayStr;
  document.getElementById('funding-date').value = todayStr;
  
  // Close modals on clicking overlay background
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeExpenseModal();
        closeFundingModal();
      }
    });
  });
});

// --- Sync State Visual Controllers ---

/**
 * Update the dynamic visual live cloud sync status indicator in the footer.
 * Supports: 'syncing' | 'synced' | 'offline' | 'error'
 */
function updateSyncStatus(status, customMsg = '') {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (!dot || !text) return;

  // Reset indicator styles
  dot.className = 'sync-dot';
  
  if (status === 'syncing') {
    dot.classList.add('status-syncing');
    text.innerText = customMsg || 'Syncing ledger data...';
  } else if (status === 'synced') {
    dot.classList.add('status-synced');
    text.innerText = customMsg || 'Synced with Cloud (Redis)';
  } else if (status === 'offline') {
    dot.classList.add('status-offline');
    text.innerText = customMsg || 'Using Local Offline Cache';
  } else if (status === 'error') {
    dot.classList.add('status-error');
    text.innerText = customMsg || 'Sync Error - Local Saving Active';
  }
}

/**
 * Controls the fade-out transition of the initial cloud load overlay screen.
 */
function showAppLoader(show) {
  const loader = document.getElementById('app-loader');
  if (!loader) return;
  if (show) {
    loader.style.display = 'flex';
    loader.classList.remove('fade-out');
  } else {
    loader.classList.add('fade-out');
    setTimeout(() => {
      loader.style.display = 'none';
    }, 500); // match CSS fade transition duration
  }
}

/**
 * Initializes the application state, seeding if empty.
 * First tries to load from Vercel KV serverless API with a timeout fallback.
 */
async function initApp() {
  updateSyncStatus('syncing', 'Connecting to Vercel KV...');
  
  // Set up local storage backup loader
  const loadLocalFallback = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        state.expenses = parsed.expenses || [];
        state.fundings = parsed.fundings || [];
        updateSyncStatus('offline', 'Offline Fallback - Loaded Local Cache');
      } catch (e) {
        console.error('Failed to parse local storage', e);
        loadSeedDataLocalStorage();
      }
    } else {
      loadSeedDataLocalStorage();
    }
  };

  try {
    // 5-second fetch timeout using AbortController to prevent hanging connection on weak networks
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('/api/data', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Vercel KV API responded with status ${response.status}. Falling back to local.`);
      loadLocalFallback();
      return;
    }

    const cloudData = await response.json();

    // Check if the backend responded with an integration error (e.g. database not configured yet)
    if (cloudData.error && cloudData.error.includes('not configured')) {
      console.warn('Database is not linked in project dashboard. Running in local fallback mode.');
      loadLocalFallback();
      updateSyncStatus('offline', 'Database Not Connected (Local Sandbox)');
      return;
    }

    // Check if the database has records
    const isCloudEmpty = (!cloudData.expenses || cloudData.expenses.length === 0) &&
                        (!cloudData.fundings || cloudData.fundings.length === 0);

    if (isCloudEmpty) {
      console.log('Database is completely empty. Seeding defaults to cloud...');
      state.expenses = [...seedData.expenses];
      state.fundings = [...seedData.fundings];
      await saveToStorage(true); // run synchronously on initial seed
    } else {
      state.expenses = cloudData.expenses || [];
      state.fundings = cloudData.fundings || [];
      // Synchronize offline local cache
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        expenses: state.expenses,
        fundings: state.fundings
      }));
      updateSyncStatus('synced');
    }

  } catch (error) {
    console.error('Initial Vercel KV cloud fetch failed:', error);
    // Connect failed (e.g. offline) -> fallback to browser local storage
    loadLocalFallback();
  } finally {
    // Trigger visual draw updates and metric recalculations
    applyFilters();
    showAppLoader(false);
  }
}

/**
 * Fallback to seed state locally if cloud is inaccessible on first launch
 */
function loadSeedDataLocalStorage() {
  state.expenses = [...seedData.expenses];
  state.fundings = [...seedData.fundings];
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    expenses: state.expenses,
    fundings: state.fundings
  }));
  updateSyncStatus('offline', 'Cloud Offline - Loaded Local Sandbox');
}

/**
 * Saves current ledger state to LocalStorage immediately and syncs with Vercel KV in background.
 */
async function saveToStorage(runSynchronously = false) {
  const dataToSave = {
    expenses: state.expenses,
    fundings: state.fundings
  };

  // 1. Instant local storage update for high performance responsive UI
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));

  // 2. Perform background async network push to Vercel KV
  const syncTask = async () => {
    updateSyncStatus('syncing', 'Syncing changes with cloud...');
    try {
      const response = await fetch('/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSave),
      });

      if (!response.ok) {
        throw new Error(`Cloud sync returned HTTP status ${response.status}`);
      }

      const resJson = await response.json();
      if (resJson.error && resJson.error.includes('not configured')) {
        updateSyncStatus('offline', 'KV Not Connected (Changes Saved Locally)');
        return;
      }

      updateSyncStatus('synced', 'All changes saved to Cloud');
    } catch (err) {
      console.error('Cloud background sync failed:', err);
      updateSyncStatus('error', 'Sync Failed - Saved in Browser Cache');
    }
  };

  if (runSynchronously) {
    await syncTask();
  } else {
    // Run in background, avoiding blocking UI thread
    syncTask();
  }
}


// --- Date Helper Utilities ---
function getDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Parses date string (YYYY-MM-DD) into local date object, avoiding time shifts.
 */
function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function formatLocalDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a currency value with proper commas and decimals.
 */
function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
}

// --- Dashboard Calculus & Metrics ---
function recalculateMetrics() {
  const totals = {
    totalSpent: 0,
    spentFromHand: 0,
    spentFromAdvance: 0,
    totalReceived: 0,
    totalDelayed: 0
  };

  // Expenses calculations
  state.expenses.forEach(e => {
    const amt = parseFloat(e.amount) || 0;
    totals.totalSpent += amt;
    if (e.paidFrom === 'My Hand') {
      totals.spentFromHand += amt;
    } else {
      totals.spentFromAdvance += amt;
    }
  });

  // Fundings calculations
  state.fundings.forEach(f => {
    const amt = parseFloat(f.amount) || 0;
    if (f.status === 'Received') {
      totals.totalReceived += amt;
    } else {
      totals.totalDelayed += amt;
    }
  });

  // Net investor cash balance remaining in Middle Man's custody
  const investorBalance = totals.totalReceived - totals.spentFromAdvance;
  
  // Reimbursement outstanding: what I spent from hand + what investor delayed/promised
  const outstandingDue = totals.spentFromHand + totals.totalDelayed;

  // Update DOM KPI elements
  document.getElementById('kpi-total-spent').innerText = formatCurrency(totals.totalSpent);
  document.getElementById('kpi-spent-hand').innerText = formatCurrency(totals.spentFromHand);
  document.getElementById('kpi-received-investor').innerText = formatCurrency(totals.totalReceived);
  document.getElementById('kpi-outstanding-due').innerText = formatCurrency(outstandingDue);

  // Update Dynamic Balance Progress Bar
  const barInvestor = document.getElementById('bar-investor');
  const barHand = document.getElementById('bar-hand');
  const ratioText = document.getElementById('balance-ratio-value');
  const lblInvestorRatio = document.getElementById('lbl-investor-ratio');
  const lblHandRatio = document.getElementById('lbl-hand-ratio');

  lblInvestorRatio.innerText = formatCurrency(totals.spentFromAdvance);
  lblHandRatio.innerText = formatCurrency(totals.spentFromHand);

  if (totals.totalSpent === 0) {
    barInvestor.style.width = '0%';
    barHand.style.width = '0%';
    ratioText.innerText = '0% Investor / 0% My Hand';
  } else {
    const invPct = (totals.spentFromAdvance / totals.totalSpent) * 100;
    const handPct = (totals.spentFromHand / totals.totalSpent) * 100;
    
    barInvestor.style.width = `${invPct}%`;
    barHand.style.width = `${handPct}%`;
    ratioText.innerText = `${Math.round(invPct)}% Investor / ${Math.round(handPct)}% My Hand`;
  }
}

// --- Dynamic Ledger Views & Filtering ---
function renderLedger() {
  const container = document.getElementById('ledger-container');
  container.innerHTML = '';

  const searchLower = state.filters.search.toLowerCase();
  
  if (state.activeLedgerTab === 'expenses') {
    // Show filter elements related to expenses
    document.getElementById('filter-recipient-type').style.display = 'block';
    document.getElementById('filter-funding').style.display = 'block';

    const filteredExpenses = state.expenses.filter(e => {
      const matchSearch = e.recipientName.toLowerCase().includes(searchLower) || e.notes.toLowerCase().includes(searchLower);
      const matchType = state.filters.recipientType === 'all' || e.recipientType === state.filters.recipientType;
      const matchMode = state.filters.mode === 'all' || e.paymentMode === state.filters.mode;
      const matchFunding = state.filters.funding === 'all' || e.paidFrom === state.filters.funding;
      return matchSearch && matchType && matchMode && matchFunding;
    });

    // Sort by date descending
    filteredExpenses.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

    if (filteredExpenses.length === 0) {
      container.appendChild(createEmptyState('No expense transactions match your filters.'));
      return;
    }

    filteredExpenses.forEach(e => {
      const el = document.createElement('div');
      el.className = 'ledger-item';
      
      const isHand = e.paidFrom === 'My Hand';
      const badgeSourceClass = isHand ? 'badge-my-hand' : 'badge-investor-advance';
      const badgeModeClass = e.paymentMode === 'GPay' ? 'badge-gpay' : (e.paymentMode === 'Cash' ? 'badge-cash' : 'badge-other');

      el.innerHTML = `
        <div class="ledger-item-left">
          <div class="ledger-item-icon expense">
            <svg width="20" height="20" fill="none" stroke="var(--accent-danger)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12H8m0 0l2 2m-2-2l2-2m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div>
            <div class="ledger-item-title">${escapeHTML(e.recipientName)}</div>
            <div class="ledger-item-meta">
              <span class="ledger-item-meta-item">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                ${formatDisplayDate(e.date)}
              </span>
              <span class="badge ${badgeModeClass}">${e.paymentMode}</span>
              <span class="badge ${badgeSourceClass}">${e.paidFrom}</span>
              <span style="color: var(--text-muted); font-size: 0.8rem;">${escapeHTML(e.notes || '')}</span>
            </div>
          </div>
        </div>
        <div class="ledger-item-right">
          <div class="ledger-item-value expense">- ${formatCurrency(e.amount)}</div>
          <div class="ledger-actions">
            <button class="btn-icon" onclick="editExpense('${e.id}')" title="Edit expense">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button class="btn-icon delete" onclick="deleteExpense('${e.id}')" title="Delete expense">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
      container.appendChild(el);
    });
  } else {
    // Show filter elements related to funding (Hide recipient type & funding paid from)
    document.getElementById('filter-recipient-type').style.display = 'none';
    document.getElementById('filter-funding').style.display = 'none';

    const filteredFundings = state.fundings.filter(f => {
      const matchSearch = f.notes.toLowerCase().includes(searchLower);
      const matchMode = state.filters.mode === 'all' || f.transferMode === state.filters.mode;
      return matchSearch && matchMode;
    });

    filteredFundings.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

    if (filteredFundings.length === 0) {
      container.appendChild(createEmptyState('No funding tranches match your filters.'));
      return;
    }

    filteredFundings.forEach(f => {
      const el = document.createElement('div');
      el.className = 'ledger-item';

      const isDelayed = f.status === 'Delayed';
      const badgeStatusClass = isDelayed ? 'badge-delayed' : 'badge-received';
      const badgeModeClass = f.transferMode === 'GPay' ? 'badge-gpay' : (f.transferMode === 'Cash' ? 'badge-cash' : 'badge-other');

      el.innerHTML = `
        <div class="ledger-item-left">
          <div class="ledger-item-icon funding">
            <svg width="20" height="20" fill="none" stroke="var(--accent-primary)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          </div>
          <div>
            <div class="ledger-item-title">${escapeHTML(f.notes || 'Investor Deposit')}</div>
            <div class="ledger-item-meta">
              <span class="ledger-item-meta-item">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                ${formatDisplayDate(f.date)}
              </span>
              <span class="badge ${badgeModeClass}">${f.transferMode}</span>
              <span class="badge ${badgeStatusClass}">${f.status}</span>
            </div>
          </div>
        </div>
        <div class="ledger-item-right">
          <div class="ledger-item-value funding">+ ${formatCurrency(f.amount)}</div>
          <div class="ledger-actions">
            <button class="btn-icon" onclick="editFunding('${f.id}')" title="Edit funding">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button class="btn-icon delete" onclick="deleteFunding('${f.id}')" title="Delete funding">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
      container.appendChild(el);
    });
  }
}

function createEmptyState(msg) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
    <p>${msg}</p>
  `;
  return el;
}

function switchLedgerTab(tab) {
  state.activeLedgerTab = tab;
  document.getElementById('tab-expenses').classList.toggle('active', tab === 'expenses');
  document.getElementById('tab-fundings').classList.toggle('active', tab === 'fundings');
  applyFilters();
}

function applyFilters() {
  state.filters.search = document.getElementById('filter-search').value;
  state.filters.recipientType = document.getElementById('filter-recipient-type').value;
  state.filters.mode = document.getElementById('filter-mode').value;
  state.filters.funding = document.getElementById('filter-funding').value;
  
  recalculateMetrics();
  renderLedger();
  renderReports();
}

// --- Dynamic Reporting Engine ---
function switchReportPeriod(period) {
  state.activeReportPeriod = period;
  document.getElementById('rpt-day').classList.toggle('active', period === 'day');
  document.getElementById('rpt-week').classList.toggle('active', period === 'week');
  document.getElementById('rpt-month').classList.toggle('active', period === 'month');
  renderReports();
}

function renderReports() {
  const period = state.activeReportPeriod;
  const today = new Date();
  
  let startDate, endDate;
  let labelText = '';

  if (period === 'day') {
    startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    labelText = `Today: ${formatLabelDate(today)}`;
  } else if (period === 'week') {
    // Get current Monday
    const currentDay = today.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay; // Adjust Sunday = 0
    startDate = new Date(today.setDate(today.getDate() + distanceToMonday));
    startDate.setHours(0, 0, 0, 0);
    
    // Get Sunday
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    
    labelText = `${formatLabelDate(startDate)} to ${formatLabelDate(endDate)}`;
  } else if (period === 'month') {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    labelText = `${startDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  }

  document.getElementById('report-period-dates').innerText = labelText;

  // Filter expenses inside period bounds
  const periodExpenses = state.expenses.filter(e => {
    const expenseDate = parseLocalDate(e.date);
    return expenseDate >= startDate && expenseDate <= endDate;
  });

  // Calculate sum total spent in period
  const totalPeriodSpent = periodExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  document.getElementById('report-spent-value').innerText = formatCurrency(totalPeriodSpent);

  // Group by Recipient Name
  const recipientGroup = {};
  periodExpenses.forEach(e => {
    const name = e.recipientName;
    recipientGroup[name] = (recipientGroup[name] || 0) + parseFloat(e.amount);
  });

  // Group by Payment Mode
  const modeGroup = {};
  periodExpenses.forEach(e => {
    const mode = e.paymentMode;
    modeGroup[mode] = (modeGroup[mode] || 0) + parseFloat(e.amount);
  });

  // Render Charts
  renderBreakdownChart('recipient-chart', recipientGroup, totalPeriodSpent);
  renderBreakdownChart('mode-chart', modeGroup, totalPeriodSpent);
}

/**
 * Renders custom animated SVG-like CSS percentage bar charts.
 */
function renderBreakdownChart(elementId, groups, totalSum) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';

  const sortedGroups = Object.keys(groups).map(key => ({
    name: key,
    value: groups[key]
  })).sort((a, b) => b.value - a.value);

  if (sortedGroups.length === 0) {
    container.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">No transactions this period</div>`;
    return;
  }

  sortedGroups.forEach(item => {
    const pct = totalSum === 0 ? 0 : (item.value / totalSum) * 100;
    const row = document.createElement('div');
    row.className = 'mini-bar-row';
    row.innerHTML = `
      <div class="mini-bar-labels">
        <span class="mini-bar-name">${escapeHTML(item.name)}</span>
        <span class="mini-bar-value">${formatCurrency(item.value)} (${Math.round(pct)}%)</span>
      </div>
      <div class="mini-bar-track">
        <div class="mini-bar-fill" style="width: 0%; background: ${getRandomBarColor(elementId)}"></div>
      </div>
    `;
    container.appendChild(row);
    
    // Smooth width fill transition trigger
    setTimeout(() => {
      row.querySelector('.mini-bar-fill').style.width = `${pct}%`;
    }, 50);
  });
}

function getRandomBarColor(chartId) {
  if (chartId === 'mode-chart') {
    return 'linear-gradient(90deg, #60A5FA, var(--accent-info))';
  }
  return 'linear-gradient(90deg, #F87171, var(--accent-danger))';
}

function formatLabelDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatDisplayDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// --- Modal Controls ---
function openExpenseModal() {
  document.getElementById('modal-expense').classList.add('active');
  document.getElementById('expense-recipient-name').focus();
}

function closeExpenseModal() {
  document.getElementById('modal-expense').classList.remove('active');
  document.getElementById('form-expense').reset();
  document.getElementById('expense-id').value = '';
  document.getElementById('expense-submit-btn').innerText = 'Record Expense';
  
  // Restore default date
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('expense-date').value = todayStr;
}

function openFundingModal() {
  document.getElementById('modal-funding').classList.add('active');
  document.getElementById('funding-amount').focus();
}

function closeFundingModal() {
  document.getElementById('modal-funding').classList.remove('active');
  document.getElementById('form-funding').reset();
  document.getElementById('funding-id').value = '';
  document.getElementById('funding-submit-btn').innerText = 'Record Funding';
  
  // Restore default date
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('funding-date').value = todayStr;
}

// --- Submit Controllers ---
function handleExpenseSubmit(event) {
  event.preventDefault();

  const id = document.getElementById('expense-id').value;
  const recipientType = document.getElementById('expense-recipient-type').value;
  const recipientName = document.getElementById('expense-recipient-name').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const date = document.getElementById('expense-date').value;
  const paymentMode = document.getElementById('expense-mode').value;
  const paidFrom = document.getElementById('expense-source').value;
  const notes = document.getElementById('expense-notes').value.trim();

  if (!recipientName || isNaN(amount) || amount <= 0 || !date) {
    alert('Please fill out all fields correctly.');
    return;
  }

  const transactionData = {
    id: id || 'e-' + Date.now(),
    recipientType,
    recipientName,
    amount,
    date,
    paymentMode,
    paidFrom,
    notes
  };

  if (id) {
    // Editing existing expense
    const idx = state.expenses.findIndex(e => e.id === id);
    if (idx !== -1) {
      state.expenses[idx] = transactionData;
    }
  } else {
    // Add new expense
    state.expenses.push(transactionData);
  }

  saveToStorage();
  closeExpenseModal();
  applyFilters();
}

function handleFundingSubmit(event) {
  event.preventDefault();

  const id = document.getElementById('funding-id').value;
  const amount = parseFloat(document.getElementById('funding-amount').value);
  const date = document.getElementById('funding-date').value;
  const transferMode = document.getElementById('funding-mode').value;
  const status = document.getElementById('funding-status').value;
  const notes = document.getElementById('funding-notes').value.trim();

  if (isNaN(amount) || amount <= 0 || !date) {
    alert('Please enter a valid amount and date.');
    return;
  }

  const fundingData = {
    id: id || 'f-' + Date.now(),
    amount,
    date,
    transferMode,
    status,
    notes: notes || `Funding tranche via ${transferMode}`
  };

  if (id) {
    // Edit existing funding
    const idx = state.fundings.findIndex(f => f.id === id);
    if (idx !== -1) {
      state.fundings[idx] = fundingData;
    }
  } else {
    // Add new funding
    state.fundings.push(fundingData);
  }

  saveToStorage();
  closeFundingModal();
  applyFilters();
}

// --- Edit/Delete Operations ---
function editExpense(id) {
  const expense = state.expenses.find(e => e.id === id);
  if (!expense) return;

  document.getElementById('expense-id').value = expense.id;
  document.getElementById('expense-recipient-type').value = expense.recipientType;
  document.getElementById('expense-recipient-name').value = expense.recipientName;
  document.getElementById('expense-amount').value = expense.amount;
  document.getElementById('expense-date').value = expense.date;
  document.getElementById('expense-mode').value = expense.paymentMode;
  document.getElementById('expense-source').value = expense.paidFrom;
  document.getElementById('expense-notes').value = expense.notes || '';

  document.getElementById('expense-submit-btn').innerText = 'Save Changes';
  openExpenseModal();
}

function deleteExpense(id) {
  if (confirm('Are you sure you want to delete this expense transaction?')) {
    state.expenses = state.expenses.filter(e => e.id !== id);
    saveToStorage();
    applyFilters();
  }
}

function editFunding(id) {
  const funding = state.fundings.find(f => f.id === id);
  if (!funding) return;

  document.getElementById('funding-id').value = funding.id;
  document.getElementById('funding-amount').value = funding.amount;
  document.getElementById('funding-date').value = funding.date;
  document.getElementById('funding-mode').value = funding.transferMode;
  document.getElementById('funding-status').value = funding.status;
  document.getElementById('funding-notes').value = funding.notes || '';

  document.getElementById('funding-submit-btn').innerText = 'Save Changes';
  openFundingModal();
}

function deleteFunding(id) {
  if (confirm('Are you sure you want to delete this investor funding tranche?')) {
    state.fundings = state.fundings.filter(f => f.id !== id);
    saveToStorage();
    applyFilters();
  }
}

// --- Data Portability Engine (Export/Import) ---
function exportDataJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `co_ledger_backup_${new Date().toISOString().split('T')[0]}.json`);
  dlAnchorElem.click();
}

function exportDataCSV() {
  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Section 1: Expenses Header & Data
  csvContent += "=== EXPENSES ===\r\n";
  csvContent += "Date,Amount,Recipient Type,Recipient Name,Payment Mode,Paid From,Notes\r\n";
  state.expenses.forEach(e => {
    const row = [
      e.date,
      e.amount,
      e.recipientType,
      `"${e.recipientName.replace(/"/g, '""')}"`,
      e.paymentMode,
      e.paidFrom,
      `"${(e.notes || '').replace(/"/g, '""')}"`
    ].join(",");
    csvContent += row + "\r\n";
  });
  
  csvContent += "\r\n";
  
  // Section 2: Inflows Header & Data
  csvContent += "=== INVESTOR FUNDINGS ===\r\n";
  csvContent += "Date,Amount,Transfer Mode,Status,Notes\r\n";
  state.fundings.forEach(f => {
    const row = [
      f.date,
      f.amount,
      f.transferMode,
      f.status,
      `"${(f.notes || '').replace(/"/g, '""')}"`
    ].join(",");
    csvContent += row + "\r\n";
  });

  const encodedUri = encodeURI(csvContent);
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", encodedUri);
  dlAnchorElem.setAttribute("download", `co_ledger_export_${new Date().toISOString().split('T')[0]}.csv`);
  dlAnchorElem.click();
}

function triggerJSONImport() {
  document.getElementById('import-file-selector').click();
}

function importDataJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported.expenses) && Array.isArray(imported.fundings)) {
        state.expenses = imported.expenses;
        state.fundings = imported.fundings;
        
        saveToStorage();
        applyFilters();
        alert('Data successfully imported and active!');
      } else {
        alert('Error: Selected JSON file has an invalid format. Must contain expenses and fundings lists.');
      }
    } catch (err) {
      alert('Error parsing JSON backup file. Please make sure the file is not corrupted.');
    }
  };
  reader.readAsText(file);
}

function triggerCSVImport() {
  document.getElementById('import-csv-selector').click();
}

function importDataCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/);
    
    let parsedExpenses = [];
    let parsedFundings = [];
    
    let currentMode = 'auto'; // 'auto', 'expenses', 'fundings'
    let expenseHeaderIndices = null;
    let fundingHeaderIndices = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Check section headers
      if (line.includes('=== EXPENSES ===')) {
        currentMode = 'expenses';
        expenseHeaderIndices = null;
        continue;
      }
      if (line.includes('=== INVESTOR FUNDINGS ===')) {
        currentMode = 'fundings';
        fundingHeaderIndices = null;
        continue;
      }
      
      const columns = parseCSVLine(line);
      if (columns.length === 0 || (columns.length === 1 && columns[0] === '')) continue;
      
      // Auto-detect mode or inspect headers
      if (currentMode === 'auto' || currentMode === 'expenses') {
        const isHeader = columns.some(col => {
          const l = col.toLowerCase().trim();
          return l === 'date' || l === 'amount' || l === 'recipient name' || l === 'recipient' || l === 'paid to';
        });
        
        if (isHeader && !expenseHeaderIndices) {
          expenseHeaderIndices = mapHeaders(columns, 'expenses');
          if (currentMode === 'auto') currentMode = 'expenses';
          continue;
        }
      }
      
      if (currentMode === 'fundings') {
        const isHeader = columns.some(col => {
          const l = col.toLowerCase().trim();
          return l === 'date' || l === 'amount' || l === 'transfer mode' || l === 'status';
        });
        
        if (isHeader && !fundingHeaderIndices) {
          fundingHeaderIndices = mapHeaders(columns, 'fundings');
          continue;
        }
      }
      
      // Parse data rows
      if (currentMode === 'expenses') {
        const item = parseExpenseRow(columns, expenseHeaderIndices || { date: 0, amount: 1, recipientType: 2, recipientName: 3, paymentMode: 4, paidFrom: 5, notes: 6 }, i);
        if (item) parsedExpenses.push(item);
      } else if (currentMode === 'fundings') {
        const item = parseFundingRow(columns, fundingHeaderIndices || { date: 0, amount: 1, transferMode: 2, status: 3, notes: 4 }, i);
        if (item) parsedFundings.push(item);
      }
    }
    
    if (parsedExpenses.length > 0 || parsedFundings.length > 0) {
      if (confirm(`Successfully parsed ${parsedExpenses.length} expenses and ${parsedFundings.length} fundings. Overwrite current ledger?\n\n(Click 'OK' to overwrite current state. Click 'Cancel' to append these records to your existing list)`)) {
        state.expenses = parsedExpenses;
        state.fundings = parsedFundings;
      } else {
        state.expenses = [...state.expenses, ...parsedExpenses];
        state.fundings = [...state.fundings, ...parsedFundings];
      }
      
      saveToStorage();
      applyFilters();
      alert('CSV Data successfully loaded and calculated!');
    } else {
      alert('Could not parse any valid expense or funding rows from the selected CSV file. Please make sure headers match expected columns.');
    }
  };
  reader.readAsText(file);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i+1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function mapHeaders(columns, type) {
  const mapping = {};
  columns.forEach((col, idx) => {
    const l = col.toLowerCase().trim();
    if (l.includes('date')) mapping.date = idx;
    else if (l.includes('amount') || l.includes('value') || l.includes('sum')) mapping.amount = idx;
    else if (l.includes('recipient name') || l.includes('recipient') || l.includes('name') || l.includes('paid to') || l.includes('contractor') || l.includes('vendor')) mapping.recipientName = idx;
    else if (l.includes('recipient type') || l.includes('type')) mapping.recipientType = idx;
    else if (l.includes('payment mode') || l.includes('mode') || l.includes('method') || l.includes('transfer mode')) {
      if (type === 'expenses') mapping.paymentMode = idx;
      else mapping.transferMode = idx;
    }
    else if (l.includes('paid from') || l.includes('source')) mapping.paidFrom = idx;
    else if (l.includes('status')) mapping.status = idx;
    else if (l.includes('notes') || l.includes('ref') || l.includes('purpose') || l.includes('remarks') || l.includes('description')) mapping.notes = idx;
  });
  return mapping;
}

function parseExpenseRow(columns, mapping, index) {
  const dateCol = columns[mapping.date !== undefined ? mapping.date : 0] || '';
  const amountCol = columns[mapping.amount !== undefined ? mapping.amount : 1] || '';
  const nameCol = columns[mapping.recipientName !== undefined ? mapping.recipientName : 3] || 'Unknown';
  
  const amt = parseFloat(amountCol.replace(/[^0-9.-]/g, ''));
  if (!dateCol || isNaN(amt) || amt <= 0) return null;
  
  let recType = columns[mapping.recipientType !== undefined ? mapping.recipientType : 2] || 'contractor';
  recType = recType.toLowerCase().includes('vendor') ? 'vendor' : 'contractor';
  
  let payMode = columns[mapping.paymentMode !== undefined ? mapping.paymentMode : 4] || 'GPay';
  if (!['GPay', 'Cash', 'Bank', 'Other'].some(m => m.toLowerCase() === payMode.toLowerCase())) {
    payMode = payMode.toLowerCase().includes('bank') ? 'Bank' : (payMode.toLowerCase().includes('cash') ? 'Cash' : 'Other');
  }
  
  let paidFrom = columns[mapping.paidFrom !== undefined ? mapping.paidFrom : 5] || 'Investor Advance';
  paidFrom = paidFrom.toLowerCase().includes('hand') || paidFrom.toLowerCase().includes('pocket') ? 'My Hand' : 'Investor Advance';
  
  const notes = columns[mapping.notes !== undefined ? mapping.notes : 6] || '';
  const cleanDate = normalizeCSVDate(dateCol);
  
  return {
    id: 'e-csv-' + index + '-' + Date.now(),
    date: cleanDate,
    amount: amt,
    recipientType: recType,
    recipientName: nameCol,
    paymentMode: payMode,
    paidFrom: paidFrom,
    notes: notes
  };
}

function parseFundingRow(columns, mapping, index) {
  const dateCol = columns[mapping.date !== undefined ? mapping.date : 0] || '';
  const amountCol = columns[mapping.amount !== undefined ? mapping.amount : 1] || '';
  
  const amt = parseFloat(amountCol.replace(/[^0-9.-]/g, ''));
  if (!dateCol || isNaN(amt) || amt <= 0) return null;
  
  let mode = columns[mapping.transferMode !== undefined ? mapping.transferMode : 2] || 'Bank';
  if (!['Bank', 'GPay', 'Cash', 'Other'].some(m => m.toLowerCase() === mode.toLowerCase())) {
    mode = mode.toLowerCase().includes('gpay') ? 'GPay' : (mode.toLowerCase().includes('cash') ? 'Cash' : 'Bank');
  }
  
  let status = columns[mapping.status !== undefined ? mapping.status : 3] || 'Received';
  status = status.toLowerCase().includes('delay') || status.toLowerCase().includes('promise') || status.toLowerCase().includes('pending') ? 'Delayed' : 'Received';
  
  const notes = columns[mapping.notes !== undefined ? mapping.notes : 4] || `Funding via ${mode}`;
  const cleanDate = normalizeCSVDate(dateCol);
  
  return {
    id: 'f-csv-' + index + '-' + Date.now(),
    date: cleanDate,
    amount: amt,
    transferMode: mode,
    status: status,
    notes: notes
  };
}

function normalizeCSVDate(dateStr) {
  const clean = dateStr.trim().replace(/\//g, '-');
  const parts = clean.split('-');
  
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return `${y}-${m}-${d}`;
    } else if (parts[2].length === 4) {
      // DD-MM-YYYY
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }
  }
  return new Date().toISOString().split('T')[0];
}

// --- Utilities ---
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
