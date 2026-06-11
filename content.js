// Kallang Booker — content script
// Injected into thekallang.perfectgym.com

(function () {
  'use strict';

  // Avoid double-injection
  if (document.getElementById('kb-root')) return;

  // ── Constants ──
  const BASE             = 'https://thekallang.perfectgym.com/clientportal2';
  const CLUB_ID          = 1;
  const ZONE_TYPE        = 31;
  const RETRY_DURATION_MS = 30 * 1000;   // give up after 30s — if not booked by then, it's gone
  const PARALLEL_SHOTS   = 12;           // requests per salvo per session
  const POOL_SIZE        = 3;            // independent sessions fired simultaneously
  const PREFIRE_MS       = 100;          // fire this many ms before window opens
  const KEEPALIVE_MS     = 25000;        // refresh session every 25s while waiting

  // ── State ──
  let countdownTimer  = null;
  let keepaliveTimer  = null;
  let aborted  = false;
  let booked   = false;
  let paymentUrl = null;

  let TOKEN, USER_ID, RULE_ID, DURATION, START_TIME, SLOT_DATE, OPEN_AT_MS;

  // Session pool — each entry: { sessionId, zoneId, zones }
  let sessionPool = [];
  // Legacy single-session aliases (used by headers() / step2())
  let SESSION_ID       = null;
  let RESOLVED_ZONE_ID = null;
  let AVAILABLE_ZONES  = [];

  // ─────────────────────────────────────────────
  // UI Injection
  // ─────────────────────────────────────────────

  const STYLES = `
    #kb-root * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    #kb-root {
      --bg:       #0a1628;
      --surface:  #111f38;
      --border:   #1e3255;
      --green:    #1D9E75;
      --green-dk: #0F6E56;
      --green-lt: #9FE1CB;
      --green-bg: #0b2a20;
      --amber:    #f59e0b;
      --amber-bg: #2a1f06;
      --red:      #ef4444;
      --red-bg:   #2a0a0a;
      --text:     #e2e8f0;
      --muted:    #64748b;
      --mono:     'JetBrains Mono', 'Fira Mono', monospace;
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
      font-size: 14px;
      color: var(--text);
      width: 360px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    /* Toggle button (when panel is collapsed) */
    #kb-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #1D9E75;
      border: none;
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      transition: transform 0.15s;
    }
    #kb-toggle:hover { transform: scale(1.08); }

    /* Panel */
    #kb-panel {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      max-height: 90vh;
    }
    #kb-panel.kb-hidden { display: none; }

    /* Panel header */
    .kb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .kb-header-left { display: flex; align-items: center; gap: 8px; }
    .kb-header-icon { font-size: 20px; }
    .kb-header-title { font-size: 15px; font-weight: 700; letter-spacing: -0.2px; }
    .kb-close {
      background: none; border: none; cursor: pointer;
      color: var(--muted); font-size: 18px; padding: 2px 6px;
      border-radius: 6px; transition: color 0.1s;
    }
    .kb-close:hover { color: var(--text); }

    /* Scroll body */
    .kb-body {
      overflow-y: auto;
      flex: 1;
      padding: 14px;
    }

    /* Tabs */
    .kb-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px;
      margin-bottom: 14px;
    }
    .kb-tab {
      padding: 8px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      border-radius: 7px;
      cursor: pointer;
      color: var(--muted);
      transition: all 0.15s;
      border: none;
      background: none;
    }
    .kb-tab.active { background: var(--green); color: white; }

    /* Cards */
    .kb-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 10px;
    }
    .kb-card-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 10px;
    }

    /* Fields */
    .kb-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .kb-field:last-child { margin-bottom: 0; }
    .kb-field label { font-size: 11px; color: var(--muted); font-weight: 500; }
    .kb-field input,
    .kb-field select,
    .kb-field textarea {
      width: 100%;
      padding: 9px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      -webkit-appearance: none;
      appearance: none;
    }
    .kb-field input:focus,
    .kb-field select:focus,
    .kb-field textarea:focus {
      outline: none;
      border-color: var(--green);
    }
    .kb-field textarea {
      font-family: var(--mono);
      font-size: 11px;
      min-height: 60px;
      resize: none;
      line-height: 1.5;
    }
    .kb-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    /* Opens pill */
    .kb-opens-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11px;
      font-family: var(--mono);
      color: var(--green-lt);
      margin-top: 8px;
      width: 100%;
    }
    .kb-opens-pill .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }

    /* Primary button */
    .kb-btn-primary {
      width: 100%;
      padding: 13px;
      background: var(--green);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 4px;
      transition: background 0.15s, transform 0.1s;
    }
    .kb-btn-primary:active { background: var(--green-dk); transform: scale(0.98); }
    .kb-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* Status badge */
    .kb-status-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .kb-status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .kb-badge-armed   { background: var(--amber-bg); color: var(--amber); }
    .kb-badge-running { background: var(--green-bg); color: var(--green-lt); }
    .kb-badge-booked  { background: var(--green-bg); color: var(--green-lt); }
    .kb-badge-failed  { background: var(--red-bg); color: var(--red); }

    .kb-badge-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .kb-badge-armed   .kb-badge-dot { background: var(--amber); animation: kb-pulse 1.4s infinite; }
    .kb-badge-running .kb-badge-dot { background: var(--green-lt); animation: kb-pulse 0.7s infinite; }
    .kb-badge-booked  .kb-badge-dot { background: var(--green-lt); }
    .kb-badge-failed  .kb-badge-dot { background: var(--red); }

    @keyframes kb-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Countdown */
    .kb-countdown-block {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      text-align: center;
      margin-bottom: 10px;
    }
    .kb-countdown-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .kb-countdown-time {
      font-family: var(--mono);
      font-size: 30px;
      font-weight: 700;
      color: var(--text);
      letter-spacing: 2px;
      line-height: 1;
    }
    .kb-countdown-time.imminent { color: var(--amber); }
    .kb-countdown-date { font-size: 11px; color: var(--muted); margin-top: 5px; font-family: var(--mono); }

    /* Log */
    .kb-log-wrap {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .kb-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 10px;
      border-bottom: 1px solid var(--border);
    }
    .kb-log-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .kb-log-clear { font-size: 11px; color: var(--muted); background: none; border: none; cursor: pointer; padding: 2px 6px; }
    #kb-log {
      padding: 8px 10px;
      font-family: var(--mono);
      font-size: 10px;
      line-height: 1.7;
      max-height: 160px;
      overflow-y: auto;
      color: #94a3b8;
    }
    #kb-log .line-ok     { color: var(--green-lt); }
    #kb-log .line-err    { color: var(--red); }
    #kb-log .line-warn   { color: var(--amber); }
    #kb-log .line-fire   { color: #c084fc; }
    #kb-log .line-booked { color: var(--green-lt); font-weight: 700; font-size: 12px; }

    /* Booked banner */
    .kb-booked-banner {
      display: none;
      background: var(--green-bg);
      border: 1px solid var(--green);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
      margin-bottom: 10px;
    }
    .kb-booked-banner.show { display: block; }
    .kb-booked-banner .big { font-size: 32px; margin-bottom: 6px; }
    .kb-booked-banner .title { font-size: 16px; font-weight: 700; color: var(--green-lt); margin-bottom: 3px; }
    .kb-booked-banner .sub { font-size: 12px; color: var(--muted); }
    .kb-btn-payment {
      display: block;
      width: 100%;
      margin-top: 12px;
      padding: 11px;
      background: var(--green);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
    }

    /* Abort */
    .kb-btn-abort {
      width: 100%;
      padding: 10px;
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      margin-top: 8px;
    }
    .kb-btn-abort:hover { border-color: var(--red); color: var(--red); }

    /* Pane visibility */
    #kb-pane-setup { }
    #kb-pane-run   { display: none; }
    #kb-pane-run.show { display: block; }
  `;

  const HTML = `
    <style>${STYLES}</style>
    <button id="kb-toggle" title="Kallang Booker">🏸</button>
    <div id="kb-panel" class="kb-hidden">
      <div class="kb-header">
        <div class="kb-header-left">
          <span class="kb-header-icon">🏸</span>
          <span class="kb-header-title">Kallang Booker</span>
        </div>
        <button class="kb-close" id="kb-close-btn" title="Minimise">✕</button>
      </div>
      <div class="kb-body">

        <div class="kb-tabs">
          <button class="kb-tab active" id="kb-tab-setup" onclick="window._kb.showTab('setup')">Setup</button>
          <button class="kb-tab" id="kb-tab-run" onclick="window._kb.showTab('run')">Status</button>
        </div>

        <!-- Setup pane -->
        <div id="kb-pane-setup">
          <div class="kb-card">
            <div class="kb-card-label">Target Slot</div>
            <div class="kb-grid2">
              <div class="kb-field">
                <label>Date</label>
                <input type="date" id="kb-date" oninput="window._kb.updateOpens()">
              </div>
              <div class="kb-field">
                <label>Time</label>
                <input type="time" id="kb-time" value="07:00" oninput="window._kb.updateOpens()">
              </div>
            </div>
            <div class="kb-opens-pill" id="kb-opens-info">
              <span class="dot"></span>
              <span>Select date and time</span>
            </div>
          </div>

          <div class="kb-card">
            <div class="kb-card-label">Account</div>
            <div class="kb-grid2">
              <div class="kb-field">
                <label>User ID</label>
                <input type="number" id="kb-userId" value="62061" inputmode="numeric">
              </div>
              <div class="kb-field">
                <label>Rule ID</label>
                <input type="number" id="kb-ruleId" value="19" inputmode="numeric">
              </div>
            </div>
            <div class="kb-field">
              <label>Duration (min)</label>
              <select id="kb-duration">
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">120 minutes</option>
              </select>
            </div>
          </div>

          <div class="kb-card">
            <div class="kb-card-label">Bearer Token</div>
            <div class="kb-field">
              <label>JWT — no "Bearer " prefix</label>
              <textarea id="kb-token" placeholder="eyJhbGci..." autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
            </div>
          </div>

          <button class="kb-btn-primary" id="kb-arm-btn" onclick="window._kb.arm()">Arm Booker</button>
        </div>

        <!-- Run pane -->
        <div id="kb-pane-run">
          <div id="kb-booked-banner" class="kb-booked-banner">
            <div class="big">🎉</div>
            <div class="title">Court booked!</div>
            <div class="sub" id="kb-booked-court"></div>
            <a id="kb-payment-btn" class="kb-btn-payment" href="#" target="_blank">Complete payment →</a>
          </div>

          <div class="kb-card">
            <div class="kb-status-header">
              <div class="kb-status-badge kb-badge-armed" id="kb-status-badge">
                <span class="kb-badge-dot"></span>
                <span id="kb-status-text">Armed</span>
              </div>
              <div style="font-size:11px; color:var(--muted)" id="kb-slot-label"></div>
            </div>

            <div class="kb-countdown-block">
              <div class="kb-countdown-label">Window opens in</div>
              <div class="kb-countdown-time" id="kb-countdown">--:--:--</div>
              <div class="kb-countdown-date" id="kb-countdown-date"></div>
            </div>

            <div class="kb-log-wrap">
              <div class="kb-log-header">
                <span class="kb-log-title">Log</span>
                <button class="kb-log-clear" onclick="window._kb.clearLog()">Clear</button>
              </div>
              <div id="kb-log"></div>
            </div>

            <button class="kb-btn-abort" onclick="window._kb.abort()">Stop & reset</button>
          </div>
        </div>

      </div><!-- /kb-body -->
    </div><!-- /kb-panel -->
  `;

  // Mount root — use DOMParser so no dynamic user data touches innerHTML
  const root = document.createElement('div');
  root.id = 'kb-root';
  const parsed = new DOMParser().parseFromString(HTML, 'text/html');
  // Move all parsed children (style + button + panel) into root
  Array.from(parsed.body.childNodes).forEach(n => root.appendChild(document.adoptNode(n)));
  document.body.appendChild(root);

  // Toggle open/close
  const toggleBtn = document.getElementById('kb-toggle');
  const panel     = document.getElementById('kb-panel');
  const closeBtn  = document.getElementById('kb-close-btn');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('kb-hidden');
    toggleBtn.style.display = panel.classList.contains('kb-hidden') ? '' : 'none';
  });
  closeBtn.addEventListener('click', () => {
    panel.classList.add('kb-hidden');
    toggleBtn.style.display = '';
  });

  // ─────────────────────────────────────────────
  // Booking logic (same as PWA, namespaced)
  // ─────────────────────────────────────────────

  function showTab(tab) {
    document.getElementById('kb-pane-setup').style.display = tab === 'setup' ? '' : 'none';
    document.getElementById('kb-pane-run').style.display   = tab === 'run'   ? '' : 'none';
    document.getElementById('kb-tab-setup').classList.toggle('active', tab === 'setup');
    document.getElementById('kb-tab-run').classList.toggle('active',   tab === 'run');
  }

  function updateOpens() {
    const date = document.getElementById('kb-date').value;
    const time = document.getElementById('kb-time').value;
    const el = document.getElementById('kb-opens-info').querySelector('span:last-child');
    if (!date || !time) { el.textContent = 'Select date and time'; return; }
    const openMs = new Date(date + 'T' + time + ':00').getTime() - 168 * 3600000;
    el.textContent = 'Opens: ' + new Date(openMs).toLocaleString('en-SG', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function log(msg, type = '') {
    const el = document.getElementById('kb-log');
    const line = document.createElement('div');
    line.className = type ? 'line-' + type : '';
    line.textContent = new Date().toLocaleTimeString('en-SG') + '  ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function clearLog() { document.getElementById('kb-log').innerHTML = ''; }

  function setStatus(state, text) {
    const badge = document.getElementById('kb-status-badge');
    badge.className = 'kb-status-badge kb-badge-' + state;
    badge.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'kb-badge-dot';
    const lbl = document.createElement('span');
    lbl.textContent = text;
    badge.appendChild(dot);
    badge.appendChild(lbl);
  }

  function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

  function tickCountdown() {
    if (aborted) return;
    const ms   = OPEN_AT_MS - Date.now();
    const cdEl = document.getElementById('kb-countdown');

    if (ms <= PREFIRE_MS) {
      cdEl.textContent = '00:00:00';
      cdEl.classList.add('imminent');
      fireStep3UntilBooked();
      return;
    }

    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    cdEl.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    cdEl.classList.toggle('imminent', ms < 30000);

    const delay = ms > 300000 ? 1000 : ms > 10000 ? 500 : 100;
    countdownTimer = setTimeout(tickCountdown, delay);
  }

  function getOpenDate() {
    const d = new Date(OPEN_AT_MS);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Build one session: steps 1+2, returns { sessionId, zoneId, zones } or null
  async function buildSession() {
    try {
      const url = BASE + '/FacilityBookings/BuyProductBeforeBookingFacility/Start?clubId=' + CLUB_ID +
        '&zoneTypeId=' + ZONE_TYPE + '&date=' + getOpenDate() + '&startDate=' + START_TIME;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json, text/plain, */*', 'Authorization': 'Bearer ' + TOKEN,
          'X-Requested-With': 'XMLHttpRequest', 'CP-LANG': 'en', 'CP-MODE': 'desktop' }
      });
      if (!res.ok) return null;
      const sid = res.headers.get('cp-buy-product-before-booking-fb-session-id');
      if (!sid) return null;
      const data = await res.json();
      let zones = (data.Data && data.Data.Zones) ? data.Data.Zones : [];
      if (!zones.length) return null;
      zones.sort((a, b) => {
        const na = parseInt((a.Name.match(/\d+$/) || [0])[0]) || 0;
        const nb = parseInt((b.Name.match(/\d+$/) || [0])[0]) || 0;
        return nb - na;
      });
      const zoneId = zones[0].Id;

      // Step 2 with this session
      const hdrs = {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': 'Bearer ' + TOKEN,
        'X-Hash': '#/FacilityBooking?clubId=' + CLUB_ID + '&zoneTypeId=' + ZONE_TYPE + '&date=' + SLOT_DATE,
        'BAF-WIZARD-CURRENTURL': BASE + '/#/FacilityBooking?clubId=' + CLUB_ID + '&zoneTypeId=' + ZONE_TYPE + '&date=' + SLOT_DATE + '&sessionId=' + sid,
        'CP-BUY-PRODUCT-BEFORE-BOOKING-FB-SESSION-ID': sid,
        'X-Requested-With': 'XMLHttpRequest', 'CP-LANG': 'en', 'CP-MODE': 'desktop'
      };
      const r2 = await fetch(BASE + '/FacilityBookings/WizardSteps/SetFacilityBookingDetailsWizardStep/Next', {
        method: 'POST', credentials: 'include', headers: hdrs,
        body: JSON.stringify({ UserId: USER_ID, ZoneId: zoneId, StartTime: START_TIME,
          RequiredNumberOfSlots: null, Duration: DURATION })
      });
      if (!r2.ok) return null;
      return { sessionId: sid, zoneId, zones };
    } catch (_) { return null; }
  }

  // Refresh entire pool in parallel
  async function refreshPool() {
    if (aborted || booked) return;
    const results = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => buildSession())
    );
    sessionPool = results.filter(Boolean);
    // Keep legacy aliases pointing at first session for any remaining code
    if (sessionPool.length) {
      SESSION_ID       = sessionPool[0].sessionId;
      RESOLVED_ZONE_ID = sessionPool[0].zoneId;
      AVAILABLE_ZONES  = sessionPool[0].zones;
    }
    log('Pool: ' + sessionPool.length + '/' + POOL_SIZE + ' sessions ready', sessionPool.length ? 'ok' : 'err');
  }

  // Fire step 3 for a specific session
  async function tryStep3ForSession(sess) {
    const hdrs = {
      'Content-Type': 'application/json;charset=utf-8',
      'Accept': 'application/json, text/plain, */*',
      'Authorization': 'Bearer ' + TOKEN,
      'X-Hash': '#/FacilityBooking?clubId=' + CLUB_ID + '&zoneTypeId=' + ZONE_TYPE + '&date=' + SLOT_DATE,
      'BAF-WIZARD-CURRENTURL': BASE + '/#/FacilityBooking?clubId=' + CLUB_ID + '&zoneTypeId=' + ZONE_TYPE + '&date=' + SLOT_DATE + '&sessionId=' + sess.sessionId,
      'CP-BUY-PRODUCT-BEFORE-BOOKING-FB-SESSION-ID': sess.sessionId,
      'X-Requested-With': 'XMLHttpRequest', 'CP-LANG': 'en', 'CP-MODE': 'desktop'
    };
    try {
      const res = await fetch(BASE + '/FacilityBookings/WizardSteps/ChooseBookingRuleStep/Next', {
        method: 'POST', credentials: 'include', headers: hdrs,
        body: JSON.stringify({ ruleId: RULE_ID, OtherCalendarEventBookedAtRequestedTime: false,
          HasUserRequiredProducts: false })
      });
      if (!res.ok) return false;
      const data = await res.json();
      booked     = true;
      paymentUrl = data.Redirect || null;
      AVAILABLE_ZONES = sess.zones;
      return true;
    } catch (_) { return false; }
  }

  // Full pool salvo: POOL_SIZE × PARALLEL_SHOTS requests simultaneously
  async function poolSalvo() {
    if (!sessionPool.length) return false;
    const all = sessionPool.flatMap(sess =>
      Array.from({ length: PARALLEL_SHOTS }, () => tryStep3ForSession(sess))
    );
    return (await Promise.all(all)).some(Boolean);
  }

  async function prewarm() {
    log('Building ' + POOL_SIZE + ' sessions in parallel...', 'warn');
    for (let i = 1; i <= 5; i++) {
      await refreshPool();
      if (sessionPool.length) {
        log('Pool ready (' + sessionPool.length + ' sessions). Armed.', 'ok');
        return true;
      }
      log('Attempt ' + i + ' failed, retrying in 3s...', 'err');
      await sleep(3000);
    }
    return false;
  }

  // Keepalive: silently refresh pool every KEEPALIVE_MS while waiting
  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(async () => {
      if (aborted || booked) { stopKeepalive(); return; }
      const msLeft = OPEN_AT_MS - Date.now();
      if (msLeft < 5000) { stopKeepalive(); return; } // too close — don't interrupt
      log('Keepalive: refreshing pool...', 'warn');
      await refreshPool();
    }, KEEPALIVE_MS);
  }

  function stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  async function fireStep3UntilBooked() {
    if (aborted) return;
    stopKeepalive();
    setStatus('running', 'Firing!');
    log('🔥 FIRING — ' + sessionPool.length + ' sessions × ' + PARALLEL_SHOTS + ' = ' +
      (sessionPool.length * PARALLEL_SHOTS) + ' simultaneous requests', 'fire');

    const deadline = Date.now() + RETRY_DURATION_MS;
    let salvoNum = 1;

    while (!booked && !aborted && Date.now() < deadline) {
      log('Salvo #' + salvoNum + ' (' + (sessionPool.length * PARALLEL_SHOTS) + ' req)', 'fire');
      const ok = await poolSalvo();
      if (ok || booked) break;
      salvoNum++;
      // If sessions look expired, do one emergency refresh (fast) then keep firing
      if (salvoNum === 3 && !booked) {
        log('Refreshing expired sessions...', 'warn');
        await refreshPool();
      }
    }

    if (booked) {
      onBooked();
    } else if (!aborted) {
      log('❌ No court after 30s', 'err');
      setStatus('failed', 'Failed');
    }
  }

  function onBooked() {
    setStatus('booked', 'Booked!');
    log('✅ BOOKED! Court: ' + (AVAILABLE_ZONES[0] ? AVAILABLE_ZONES[0].Name : ''), 'booked');
    const banner = document.getElementById('kb-booked-banner');
    banner.classList.add('show');
    document.getElementById('kb-booked-court').textContent =
      (AVAILABLE_ZONES[0] ? AVAILABLE_ZONES[0].Name : '') + ' · ' + SLOT_DATE + ' ' + START_TIME.slice(11, 16);
    if (paymentUrl) {
      const btn = document.getElementById('kb-payment-btn');
      btn.href = paymentUrl;
      btn.style.display = 'block';
    } else {
      document.getElementById('kb-payment-btn').style.display = 'none';
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    showTab('run');
    // Make sure panel is visible
    panel.classList.remove('kb-hidden');
    toggleBtn.style.display = 'none';
  }

  function abort() {
    aborted = true;
    if (countdownTimer) clearTimeout(countdownTimer);
    stopKeepalive();
    sessionPool = [];
    setStatus('armed', 'Stopped');
    log('Stopped by user.', 'warn');
    document.getElementById('kb-arm-btn').disabled = false;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function arm() {
    const date     = document.getElementById('kb-date').value;
    const time     = document.getElementById('kb-time').value;
    const userId   = document.getElementById('kb-userId').value;
    const ruleId   = document.getElementById('kb-ruleId').value;
    const duration = document.getElementById('kb-duration').value;
    const token    = document.getElementById('kb-token').value.trim();

    if (!date || !time || !token) { alert('Fill in date, time, and token'); return; }

    // Persist to extension storage
    browser.storage.local.set({ kb_date: date, kb_time: time, kb_userId: userId,
      kb_ruleId: ruleId, kb_duration: duration, kb_token: token });

    START_TIME  = date + 'T' + time + ':00';
    SLOT_DATE   = date;
    OPEN_AT_MS  = new Date(START_TIME).getTime() - 168 * 3600000;
    TOKEN       = token;
    USER_ID     = parseInt(userId);
    RULE_ID     = parseInt(ruleId);
    DURATION    = parseInt(duration);
    SESSION_ID       = null;
    sessionPool      = [];
    aborted          = false;
    booked           = false;
    paymentUrl       = null;

    document.getElementById('kb-arm-btn').disabled = true;
    document.getElementById('kb-booked-banner').classList.remove('show');
    document.getElementById('kb-slot-label').textContent = date + ' ' + time;
    document.getElementById('kb-countdown-date').textContent =
      'Opens: ' + new Date(OPEN_AT_MS).toLocaleString('en-SG', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    clearLog();
    setStatus('armed', 'Armed');
    showTab('run');

    const ok = await prewarm();
    if (!ok) {
      log('Setup failed. Check token.', 'err');
      setStatus('failed', 'Setup failed');
      document.getElementById('kb-arm-btn').disabled = false;
      return;
    }

    const msLeft = OPEN_AT_MS - Date.now();
    if (msLeft <= PREFIRE_MS) {
      log('Window already open — booking now', 'warn');
      await fireStep3UntilBooked();
    } else {
      const h = Math.floor(msLeft / 3600000);
      const m = Math.floor((msLeft % 3600000) / 60000);
      log('Armed. Opens in ' + h + 'h ' + m + 'm. Sessions refresh every 25s.', 'ok');
      startKeepalive();
      tickCountdown();
    }
  }

  // Restore saved values from extension storage
  browser.storage.local.get(['kb_date','kb_time','kb_userId','kb_ruleId','kb_duration','kb_token'])
    .then(vals => {
      if (vals.kb_date)     document.getElementById('kb-date').value     = vals.kb_date;
      if (vals.kb_time)     document.getElementById('kb-time').value     = vals.kb_time;
      if (vals.kb_userId)   document.getElementById('kb-userId').value   = vals.kb_userId;
      if (vals.kb_ruleId)   document.getElementById('kb-ruleId').value   = vals.kb_ruleId;
      if (vals.kb_duration) document.getElementById('kb-duration').value = vals.kb_duration;
      if (vals.kb_token)    document.getElementById('kb-token').value    = vals.kb_token;
      updateOpens();
    });

  // Expose to inline onclick handlers
  window._kb = { showTab, updateOpens, clearLog, arm, abort };

})();
