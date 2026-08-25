<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solvit - SLA & Communications Compliance Admin Portal</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <!-- SheetJS for Excel Exports -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    [x-cloak] { display: none !important; }
  </style>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">

  <!-- TOP NAVIGATION / HEADER -->
  <header class="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      
      <!-- Brand & Status -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-[#ff353e] flex items-center justify-center text-white font-black text-xl shadow-inner">
          S
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-bold tracking-tight text-white">Solvit</h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span> PHP Admin Portal
            </span>
          </div>
          <p class="text-xs text-slate-400">Master SLA Turnaround & Communication Compliance Engine</p>
        </div>
      </div>

      <!-- Live Clock & Controls -->
      <div class="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
        <div class="bg-slate-800/80 px-3 py-1.5 rounded-lg text-xs border border-slate-700/60 flex items-center gap-2 text-slate-300">
          <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-400"></i>
          <span id="live-clock">Nairobi: --:--:--</span>
        </div>

        <!-- Date Range Filter -->
        <div class="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
          <input type="date" id="start-date" class="bg-transparent text-xs text-white px-2 py-1 focus:outline-none" />
          <span class="text-slate-500 text-xs px-1">to</span>
          <input type="date" id="end-date" class="bg-transparent text-xs text-white px-2 py-1 focus:outline-none" />
          <button onclick="fetchComplianceData()" class="bg-[#ff353e] hover:bg-[#e02831] text-white font-semibold px-2.5 py-1 rounded text-xs transition ml-1">
            Apply
          </button>
        </div>

        <!-- Action Modals Triggers -->
        <button onclick="openSettingsModal()" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition" title="SLA Settings">
          <i data-lucide="sliders" class="w-4 h-4"></i>
        </button>
        <button onclick="openInternalContactsModal()" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition" title="Excluded Contacts">
          <i data-lucide="shield-alert" class="w-4 h-4"></i>
        </button>
        <button onclick="triggerSeedData()" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-[#ff353e] rounded-lg border border-slate-700 text-xs font-semibold transition" title="Seed Demo Records">
          Seed Data
        </button>
      </div>

    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

    <!-- 1. HEADLINE CARDS: 3 CORE OBLIGATION COMPLIANCE METRICS -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      
      <!-- Card 1: Missed Incoming Callbacks -->
      <div onclick="openDrilldown('MISSED_INCOMING_CALLBACK')" class="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm hover:shadow-md hover:border-blue-300 transition cursor-pointer relative overflow-hidden group">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <i data-lucide="phone-incoming" class="w-5 h-5"></i>
              </span>
              <div>
                <h3 class="font-bold text-slate-900 text-base">Incoming Calls</h3>
                <p class="text-xs text-slate-500 font-medium">Callback Compliance SLA</p>
              </div>
            </div>
          </div>
          <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100/70 text-blue-700 border border-blue-200">
            30m SLA
          </span>
        </div>

        <div class="mt-4 flex items-baseline justify-between">
          <div>
            <span id="kpi-incoming-pct" class="text-3xl font-extrabold text-slate-900">--%</span>
            <span class="text-xs text-slate-500 ml-1">in SLA</span>
          </div>
          <div class="text-right">
            <span id="kpi-incoming-met-total" class="text-xs font-semibold text-slate-700">0 / 0</span>
            <p class="text-[10px] text-slate-400">Met / Total Evaluated</p>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div id="kpi-incoming-bar" class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Open Obligations: <strong id="kpi-incoming-open" class="text-slate-800">0</strong></span>
          <span class="text-blue-600 group-hover:translate-x-0.5 transition font-semibold flex items-center gap-1">
            Drilldown <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </span>
        </div>
      </div>

      <!-- Card 2: Outgoing Call Reconnections -->
      <div onclick="openDrilldown('OUTGOING_RECONNECTION')" class="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm hover:shadow-md hover:border-emerald-300 transition cursor-pointer relative overflow-hidden group">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <i data-lucide="phone-outgoing" class="w-5 h-5"></i>
              </span>
              <div>
                <h3 class="font-bold text-slate-900 text-base">Outgoing Calls</h3>
                <p class="text-xs text-slate-500 font-medium">Reconnection Compliance SLA</p>
              </div>
            </div>
          </div>
          <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100/70 text-emerald-700 border border-emerald-200">
            24h SLA
          </span>
        </div>

        <div class="mt-4 flex items-baseline justify-between">
          <div>
            <span id="kpi-outgoing-pct" class="text-3xl font-extrabold text-slate-900">--%</span>
            <span class="text-xs text-slate-500 ml-1">in SLA</span>
          </div>
          <div class="text-right">
            <span id="kpi-outgoing-met-total" class="text-xs font-semibold text-slate-700">0 / 0</span>
            <p class="text-[10px] text-slate-400">Met / Total Evaluated</p>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div id="kpi-outgoing-bar" class="bg-emerald-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Open Obligations: <strong id="kpi-outgoing-open" class="text-slate-800">0</strong></span>
          <span class="text-emerald-600 group-hover:translate-x-0.5 transition font-semibold flex items-center gap-1">
            Drilldown <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </span>
        </div>
      </div>

      <!-- Card 3: SMS Follow-ups for Unconnected Calls -->
      <div onclick="openDrilldown('SMS_FOLLOWUP')" class="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm hover:shadow-md hover:border-purple-300 transition cursor-pointer relative overflow-hidden group">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <i data-lucide="message-square" class="w-5 h-5"></i>
              </span>
              <div>
                <h3 class="font-bold text-slate-900 text-base">SMS Follow-Up</h3>
                <p class="text-xs text-slate-500 font-medium">Unconnected Call Follow-up</p>
              </div>
            </div>
          </div>
          <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100/70 text-purple-700 border border-purple-200">
            30m SLA
          </span>
        </div>

        <div class="mt-4 flex items-baseline justify-between">
          <div>
            <span id="kpi-sms-pct" class="text-3xl font-extrabold text-slate-900">--%</span>
            <span class="text-xs text-slate-500 ml-1">in SLA</span>
          </div>
          <div class="text-right">
            <span id="kpi-sms-met-total" class="text-xs font-semibold text-slate-700">0 / 0</span>
            <p class="text-[10px] text-slate-400">Met / Total Evaluated</p>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div id="kpi-sms-bar" class="bg-purple-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Open Obligations: <strong id="kpi-sms-open" class="text-slate-800">0</strong></span>
          <span class="text-purple-600 group-hover:translate-x-0.5 transition font-semibold flex items-center gap-1">
            Drilldown <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </span>
        </div>
      </div>

    </div>

    <!-- 2. SPEED & TURNAROUND TIME (TAT) BENCHMARK SUMMARY -->
    <div class="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
            <i data-lucide="timer" class="w-4 h-4"></i>
          </span>
          <h3 class="font-bold text-slate-900 text-sm">Turnaround Time (TAT) Operational Benchmarks</h3>
        </div>
        <span class="text-xs text-slate-500">Company-wide Medians & SLA Targets</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
          <p class="text-xs text-slate-500 font-medium">Missed Callback TAT</p>
          <div class="mt-1 flex items-baseline justify-center gap-1.5">
            <span id="tat-callback-median" class="text-xl font-bold text-slate-900">-- min</span>
            <span class="text-[11px] text-slate-400">(Target: ≤30m)</span>
          </div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
          <p class="text-xs text-slate-500 font-medium">Outgoing Reconnection TAT</p>
          <div class="mt-1 flex items-baseline justify-center gap-1.5">
            <span id="tat-reconnect-median" class="text-xl font-bold text-slate-900">-- min</span>
            <span class="text-[11px] text-slate-400">(Target: ≤24h)</span>
          </div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
          <p class="text-xs text-slate-500 font-medium">Time-to-SMS Follow-up</p>
          <div class="mt-1 flex items-baseline justify-center gap-1.5">
            <span id="tat-sms-median" class="text-xl font-bold text-slate-900">-- min</span>
            <span class="text-[11px] text-slate-400">(Target: ≤30m)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. ACTIONABLE OPEN OBLIGATIONS QUEUE -->
    <div id="open-obligations-panel" class="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm hidden">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
            <i data-lucide="alert-circle" class="w-4 h-4"></i>
          </span>
          <h3 class="font-bold text-slate-900 text-sm">Actionable Outstanding SLA Obligations</h3>
          <span id="open-obligations-count-badge" class="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">0</span>
        </div>
        <span class="text-xs text-slate-400">Live countdown against working hours</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th class="py-2.5 px-3 font-semibold">Target Phone</th>
              <th class="py-2.5 px-3 font-semibold">Type</th>
              <th class="py-2.5 px-3 font-semibold">Originating Agent</th>
              <th class="py-2.5 px-3 font-semibold">Triggered At</th>
              <th class="py-2.5 px-3 font-semibold">SLA Deadline</th>
              <th class="py-2.5 px-3 font-semibold">Time Remaining</th>
              <th class="py-2.5 px-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody id="open-obligations-tbody" class="divide-y divide-slate-100">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- 4. AGENT COMPLIANCE LEADERBOARD / TABLE -->
    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 class="font-bold text-slate-900 text-base">Agent Performance & SLA Compliance Matrix</h3>
          <p class="text-xs text-slate-500">Individual scores, total volume, and direct timeline drill-down</p>
        </div>

        <div class="flex items-center gap-2.5 w-full sm:w-auto">
          <!-- Search -->
          <div class="relative w-full sm:w-64">
            <i data-lucide="search" class="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400"></i>
            <input type="text" id="agent-search" oninput="renderAgentsTable()" placeholder="Search agent name or tag..." class="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-slate-400" />
          </div>

          <!-- Tag Filter -->
          <select id="agent-tag-filter" onchange="renderAgentsTable()" class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none">
            <option value="ALL">All Departments</option>
          </select>

          <!-- Export Table -->
          <button onclick="exportAgentsExcel()" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> Export
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="bg-slate-50/80 text-slate-500 border-b border-slate-200 font-semibold">
              <th class="py-3 px-4">Agent Name</th>
              <th class="py-3 px-3">Department</th>
              <th class="py-3 px-3 text-center">Inbound Callback</th>
              <th class="py-3 px-3 text-center">Outgoing Reconnect</th>
              <th class="py-3 px-3 text-center">SMS Follow-up</th>
              <th class="py-3 px-3 text-center font-bold text-slate-900">Combined SLA</th>
              <th class="py-3 px-3 text-center">Open Tasks</th>
              <th class="py-3 px-3 text-center">Breaches</th>
              <th class="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="agent-table-tbody" class="divide-y divide-slate-100 text-slate-700">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
    </div>

  </main>

  <!-- ------------------------------------------------------------- -->
  <!-- MODAL 1: CARD DRILLDOWN (Agent-Level Details & Raw Data)       -->
  <!-- ------------------------------------------------------------- -->
  <div id="modal-drilldown" class="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      
      <!-- Drilldown Header -->
      <div class="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <h2 id="drilldown-title" class="font-bold text-base">Drilldown Breakdown</h2>
            <span id="drilldown-badge" class="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300">SLA Matrix</span>
          </div>
          <p id="drilldown-subtitle" class="text-xs text-slate-400 mt-0.5">Agent performance breakdown and obligations audit</p>
        </div>
        <button onclick="closeDrilldown()" class="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 transition">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <!-- Drilldown Tabs -->
      <div class="px-5 pt-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button id="tab-btn-agents" onclick="switchDrilldownTab('agents')" class="px-3.5 py-1.5 text-xs font-semibold border-b-2 border-slate-900 text-slate-900">
            Agent Breakdown
          </button>
          <button id="tab-btn-obligations" onclick="switchDrilldownTab('obligations')" class="px-3.5 py-1.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-900">
            Obligations Audit Log
          </button>
        </div>
        <button onclick="exportDrilldownExcel()" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded border border-slate-200 flex items-center gap-1">
          <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5 text-emerald-600"></i> Export Excel
        </button>
      </div>

      <!-- Drilldown Content Body -->
      <div class="p-5 overflow-y-auto flex-1 text-xs">
        
        <!-- View A: Agents Matrix -->
        <div id="drilldown-view-agents" class="space-y-4">
          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th class="py-2.5 px-3">Agent</th>
                  <th class="py-2.5 px-3">Department</th>
                  <th id="drilldown-col-trigger" class="py-2.5 px-3 text-center">Triggers / Missed</th>
                  <th id="drilldown-col-met" class="py-2.5 px-3 text-center">Met in SLA</th>
                  <th id="drilldown-col-pct" class="py-2.5 px-3 text-center font-bold">Compliance %</th>
                  <th class="py-2.5 px-3 text-center">Median TAT</th>
                </tr>
              </thead>
              <tbody id="drilldown-agents-tbody" class="divide-y divide-slate-100 text-slate-700">
                <!-- Rendered by JS -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- View B: Obligations Audit Log -->
        <div id="drilldown-view-obligations" class="space-y-4 hidden">
          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th class="py-2.5 px-3">Client Phone</th>
                  <th class="py-2.5 px-3">Originating Agent</th>
                  <th class="py-2.5 px-3">Trigger Time</th>
                  <th class="py-2.5 px-3">SLA Deadline</th>
                  <th class="py-2.5 px-3 text-center">Status</th>
                  <th class="py-2.5 px-3 text-center">TAT</th>
                  <th class="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody id="drilldown-obligations-tbody" class="divide-y divide-slate-100 text-slate-700">
                <!-- Rendered by JS -->
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  </div>

  <!-- ------------------------------------------------------------- -->
  <!-- MODAL 2: CONTACT TIMELINE / THREAD INSPECTOR                  -->
  <!-- ------------------------------------------------------------- -->
  <div id="modal-contact-history" class="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <h2 class="font-bold text-base flex items-center gap-2">
            <i data-lucide="history" class="w-4 h-4 text-amber-400"></i>
            <span>Timeline Audit: <span id="inspect-phone" class="text-amber-400 font-mono">--</span></span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Chronological communication event trail and SLA obligations</p>
        </div>
        <button onclick="closeContactInspector()" class="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 transition">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="p-5 overflow-y-auto flex-1 text-xs">
        <div id="timeline-container" class="space-y-3 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          <!-- Rendered by JS -->
        </div>
      </div>
    </div>
  </div>

  <!-- ------------------------------------------------------------- -->
  <!-- MODAL 3: MASTER SLA SETTINGS & WORKING HOURS                  -->
  <!-- ------------------------------------------------------------- -->
  <div id="modal-settings" class="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <h2 class="font-bold text-base flex items-center gap-2">
            <i data-lucide="sliders" class="w-4 h-4 text-amber-400"></i> Master SLA Thresholds
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Configure turnaround deadlines and business operating hours</p>
        </div>
        <button onclick="closeSettingsModal()" class="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 transition">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="p-5 overflow-y-auto flex-1 text-xs space-y-4">
        
        <!-- Thresholds -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Incoming Callback SLA (mins)</label>
            <input type="number" id="setting-callback-mins" class="w-full border border-slate-300 rounded-lg p-2 font-semibold text-slate-900" />
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Outgoing Reconnect SLA (mins)</label>
            <input type="number" id="setting-reconnect-mins" class="w-full border border-slate-300 rounded-lg p-2 font-semibold text-slate-900" />
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">SMS Follow-up SLA (mins)</label>
            <input type="number" id="setting-sms-mins" class="w-full border border-slate-300 rounded-lg p-2 font-semibold text-slate-900" />
          </div>
        </div>

        <!-- Clock Mode & Min Connection -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Calculation Clock Mode</label>
            <select id="setting-clock-mode" class="w-full border border-slate-300 rounded-lg p-2 text-slate-900 font-medium">
              <option value="working_hours">Working Hours Only (Pause Outside Business Hours)</option>
              <option value="continuous_24_7">Continuous 24/7 Calendar Time</option>
            </select>
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Min Connected Call Duration (sec)</label>
            <input type="number" id="setting-min-duration" class="w-full border border-slate-300 rounded-lg p-2 font-semibold text-slate-900" />
          </div>
        </div>

        <!-- Working Hours Schedule -->
        <div class="pt-3 border-t border-slate-200">
          <h4 class="font-bold text-slate-900 mb-2">Weekly Business Hours (Nairobi Time)</h4>
          <div id="schedule-days-container" class="space-y-2">
            <!-- Rendered by JS -->
          </div>
        </div>

      </div>

      <div class="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
        <button onclick="closeSettingsModal()" class="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition">Cancel</button>
        <button onclick="saveSettings()" class="px-4 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- ------------------------------------------------------------- -->
  <!-- MODAL 4: INTERNAL CONTACTS EXCLUSIONS                         -->
  <!-- ------------------------------------------------------------- -->
  <div id="modal-internal-contacts" class="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div>
          <h2 class="font-bold text-base flex items-center gap-2">
            <i data-lucide="shield-alert" class="w-4 h-4 text-amber-400"></i> Excluded Internal Phone Numbers
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Calls to/from these numbers are excluded from SLA obligations</p>
        </div>
        <button onclick="closeInternalContactsModal()" class="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 transition">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="p-5 overflow-y-auto flex-1 text-xs space-y-4">
        <!-- Add Form -->
        <div class="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <input type="text" id="new-internal-phone" placeholder="e.g. +254711000000" class="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
          <input type="text" id="new-internal-label" placeholder="Staff Label" class="w-32 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
          <button onclick="addInternalContact()" class="bg-slate-900 hover:bg-slate-800 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition">Add</button>
        </div>

        <div class="border border-slate-200 rounded-xl overflow-hidden">
          <table class="w-full text-left">
            <thead class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th class="py-2 px-3">Phone Number</th>
                <th class="py-2 px-3">Label</th>
                <th class="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody id="internal-contacts-tbody" class="divide-y divide-slate-100">
              <!-- Rendered by JS -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- JAVASCRIPT LOGIC -->
  <script>
    // State Store
    let complianceData = null;
    let activeDrilldownType = null;
    let activeDrilldownTab = 'agents';
    let currentSettings = null;

    // Initialize Dates
    window.addEventListener('DOMContentLoaded', () => {
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('start-date').value = today;
      document.getElementById('end-date').value = today;

      // Start Clock
      updateClock();
      setInterval(updateClock, 1000);

      // Initial Fetch
      fetchComplianceData();
      lucide.createIcons();
    });

    function updateClock() {
      const options = { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
      const formatter = new Intl.DateTimeFormat([], options);
      document.getElementById('live-clock').textContent = `Nairobi: ${formatter.format(new Date())}`;
    }

    // 1. Fetch Main Compliance Data
    async function fetchComplianceData() {
      const start = document.getElementById('start-date').value;
      const end = document.getElementById('end-date').value;

      try {
        const res = await fetch(`api.php?action=compliance-stats&startDate=${start}&endDate=${end}`);
        if (!res.ok) throw new Error('Failed to load stats');
        complianceData = await res.json();
        currentSettings = complianceData.settings;

        renderHeadlines();
        renderTATSummary();
        renderOpenObligations();
        renderAgentsTable();
        populateTagFilter();
        lucide.createIcons();
      } catch (err) {
        console.error(err);
      }
    }

    // 2. Render Headline KPI Cards
    function renderHeadlines() {
      const h = complianceData.headline_stats;

      // Card 1: Incoming
      const inPct = h.incoming_callback_compliance_pct !== null ? `${h.incoming_callback_compliance_pct}%` : 'N/A';
      document.getElementById('kpi-incoming-pct').textContent = inPct;
      document.getElementById('kpi-incoming-met-total').textContent = `${h.incoming_callback_met} / ${h.incoming_callback_total}`;
      document.getElementById('kpi-incoming-bar').style.width = inPct !== 'N/A' ? inPct : '0%';
      document.getElementById('kpi-incoming-open').textContent = h.open_incoming_count;

      // Card 2: Outgoing
      const outPct = h.outgoing_reconnect_compliance_pct !== null ? `${h.outgoing_reconnect_compliance_pct}%` : 'N/A';
      document.getElementById('kpi-outgoing-pct').textContent = outPct;
      document.getElementById('kpi-outgoing-met-total').textContent = `${h.outgoing_reconnect_met} / ${h.outgoing_reconnect_total}`;
      document.getElementById('kpi-outgoing-bar').style.width = outPct !== 'N/A' ? outPct : '0%';
      document.getElementById('kpi-outgoing-open').textContent = h.open_outgoing_count;

      // Card 3: SMS
      const smsPct = h.sms_followup_compliance_pct !== null ? `${h.sms_followup_compliance_pct}%` : 'N/A';
      document.getElementById('kpi-sms-pct').textContent = smsPct;
      document.getElementById('kpi-sms-met-total').textContent = `${h.sms_followup_met} / ${h.sms_followup_total}`;
      document.getElementById('kpi-sms-bar').style.width = smsPct !== 'N/A' ? smsPct : '0%';
      document.getElementById('kpi-sms-open').textContent = h.open_sms_count;
    }

    // 3. Render TAT Benchmark Summary
    function renderTATSummary() {
      const cw = complianceData.turnaround_report?.company_wide;
      if (!cw) return;

      const formatTAT = (m) => m !== null && m !== undefined ? `${m}m` : 'N/A';
      document.getElementById('tat-callback-median').textContent = formatTAT(cw.overall_callback_turnaround?.median);
      document.getElementById('tat-reconnect-median').textContent = formatTAT(cw.failed_outgoing_to_connection?.median);
      document.getElementById('tat-sms-median').textContent = formatTAT(cw.failed_outgoing_to_sms?.median);
    }

    // 4. Render Open Obligations Queue
    function renderOpenObligations() {
      const obls = complianceData.open_obligations || [];
      const panel = document.getElementById('open-obligations-panel');
      const tbody = document.getElementById('open-obligations-tbody');
      const badge = document.getElementById('open-obligations-count-badge');

      if (obls.length === 0) {
        panel.classList.add('hidden');
        return;
      }

      panel.classList.remove('hidden');
      badge.textContent = obls.length;
      tbody.innerHTML = '';

      obls.forEach(obl => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition';
        const rem = obl.remaining_minutes !== undefined ? `${obl.remaining_minutes}m remaining` : '--';
        const urgentClass = obl.is_urgent ? 'text-rose-600 font-bold animate-pulse' : 'text-slate-600 font-medium';

        tr.innerHTML = `
          <td class="py-2.5 px-3 font-mono font-semibold text-slate-900">${obl.target_phone}</td>
          <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${obl.obligation_type}</span></td>
          <td class="py-2.5 px-3">${obl.originating_agent_name || 'Unknown'}</td>
          <td class="py-2.5 px-3 text-slate-500">${obl.trigger_timestamp}</td>
          <td class="py-2.5 px-3 text-slate-500">${obl.deadline_timestamp}</td>
          <td class="py-2.5 px-3 ${urgentClass}">${rem}</td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="inspectContact('${obl.target_phone}')" class="px-2.5 py-1 bg-slate-900 text-white rounded hover:bg-slate-800 text-[11px] font-semibold">Inspect</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // 5. Render Agent Matrix Table
    function renderAgentsTable() {
      const agents = complianceData.agent_summaries || [];
      const tbody = document.getElementById('agent-table-tbody');
      const search = (document.getElementById('agent-search')?.value || '').toLowerCase();
      const tagFilter = document.getElementById('agent-tag-filter')?.value || 'ALL';

      tbody.innerHTML = '';

      const filtered = agents.filter(a => {
        const matchSearch = a.agent_name.toLowerCase().includes(search) || (a.tag || '').toLowerCase().includes(search);
        const matchTag = tagFilter === 'ALL' || a.tag === tagFilter;
        return matchSearch && matchTag;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-400">No agents match your filter criteria</td></tr>`;
        return;
      }

      filtered.forEach(ag => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition';

        const fmtPct = (pct) => pct !== null && pct !== undefined ? `${pct}%` : '<span class="text-slate-400">--</span>';
        const colorPct = (pct) => {
          if (pct === null || pct === undefined) return 'text-slate-400';
          if (pct >= 90) return 'text-emerald-600 font-bold';
          if (pct >= 75) return 'text-amber-600 font-bold';
          return 'text-rose-600 font-bold';
        };

        tr.innerHTML = `
          <td class="py-3 px-4 font-semibold text-slate-900">
            <div>${ag.agent_name}</div>
            <div class="text-[10px] font-normal text-slate-400 font-mono">${ag.phone_number || 'No phone'}</div>
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">${ag.tag || 'Uncategorised'}</span>
          </td>
          <td class="py-3 px-3 text-center ${colorPct(ag.incoming_callback_compliance_pct)}">
            ${fmtPct(ag.incoming_callback_compliance_pct)}
            <div class="text-[10px] font-normal text-slate-400">${ag.incoming_callback_met}/${ag.incoming_callback_total}</div>
          </td>
          <td class="py-3 px-3 text-center ${colorPct(ag.outgoing_reconnect_compliance_pct)}">
            ${fmtPct(ag.outgoing_reconnect_compliance_pct)}
            <div class="text-[10px] font-normal text-slate-400">${ag.outgoing_reconnect_met}/${ag.outgoing_reconnect_total}</div>
          </td>
          <td class="py-3 px-3 text-center ${colorPct(ag.sms_followup_compliance_pct)}">
            ${fmtPct(ag.sms_followup_compliance_pct)}
            <div class="text-[10px] font-normal text-slate-400">${ag.sms_followup_met}/${ag.sms_followup_total}</div>
          </td>
          <td class="py-3 px-3 text-center ${colorPct(ag.combined_compliance_pct)} bg-slate-50/50">
            ${fmtPct(ag.combined_compliance_pct)}
          </td>
          <td class="py-3 px-3 text-center">
            ${ag.open_obligations_count > 0 ? `<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">${ag.open_obligations_count}</span>` : '<span class="text-slate-400">0</span>'}
          </td>
          <td class="py-3 px-3 text-center">
            ${ag.breaches_attributed_count > 0 ? `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">${ag.breaches_attributed_count}</span>` : '<span class="text-slate-400">0</span>'}
          </td>
          <td class="py-3 px-4 text-right">
            <button onclick="promptEditTag(${ag.agent_id}, '${ag.tag || ''}')" class="p-1 hover:bg-slate-200 rounded text-slate-500 mr-1" title="Edit Department Tag">
              <i data-lucide="tag" class="w-3.5 h-3.5"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      lucide.createIcons();
    }

    function populateTagFilter() {
      const select = document.getElementById('agent-tag-filter');
      const tags = complianceData.tag_summaries?.map(t => t.tag) || [];
      const current = select.value;
      select.innerHTML = '<option value="ALL">All Departments</option>';
      tags.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
      });
      select.value = current;
    }

    // 6. Drilldown Modal Handling
    function openDrilldown(type) {
      activeDrilldownType = type;
      const modal = document.getElementById('modal-drilldown');
      const title = document.getElementById('drilldown-title');
      const badge = document.getElementById('drilldown-badge');

      if (type === 'MISSED_INCOMING_CALLBACK') {
        title.textContent = 'Incoming Calls & Callback Compliance Drilldown';
        badge.textContent = '30m SLA Target';
      } else if (type === 'OUTGOING_RECONNECTION') {
        title.textContent = 'Outgoing Unconnected & Reconnection Drilldown';
        badge.textContent = '24h SLA Target';
      } else if (type === 'SMS_FOLLOWUP') {
        title.textContent = 'SMS Follow-up Compliance Drilldown';
        badge.textContent = '30m SLA Target';
      }

      renderDrilldownData();
      modal.classList.remove('hidden');
      lucide.createIcons();
    }

    function closeDrilldown() {
      document.getElementById('modal-drilldown').classList.add('hidden');
    }

    function switchDrilldownTab(tab) {
      activeDrilldownTab = tab;
      const btnA = document.getElementById('tab-btn-agents');
      const btnO = document.getElementById('tab-btn-obligations');
      const viewA = document.getElementById('drilldown-view-agents');
      const viewO = document.getElementById('drilldown-view-obligations');

      if (tab === 'agents') {
        btnA.className = 'px-3.5 py-1.5 text-xs font-semibold border-b-2 border-slate-900 text-slate-900';
        btnO.className = 'px-3.5 py-1.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-900';
        viewA.classList.remove('hidden');
        viewO.classList.add('hidden');
      } else {
        btnO.className = 'px-3.5 py-1.5 text-xs font-semibold border-b-2 border-slate-900 text-slate-900';
        btnA.className = 'px-3.5 py-1.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-900';
        viewO.classList.remove('hidden');
        viewA.classList.add('hidden');
      }
    }

    function renderDrilldownData() {
      const type = activeDrilldownType;
      const agents = complianceData.agent_summaries || [];
      const obls = (complianceData.all_obligations || []).filter(o => o.obligation_type === type);
      const tatByAgent = complianceData.turnaround_report?.by_agent || {};

      // Agents View
      const tbodyA = document.getElementById('drilldown-agents-tbody');
      tbodyA.innerHTML = '';
      agents.forEach(ag => {
        let met = 0, total = 0, pct = null, tat = 'N/A';
        const agTAT = tatByAgent[ag.agent_id];

        if (type === 'MISSED_INCOMING_CALLBACK') {
          met = ag.incoming_callback_met;
          total = ag.incoming_callback_total;
          pct = ag.incoming_callback_compliance_pct;
          tat = agTAT?.missed_to_connection?.median !== undefined ? `${agTAT.missed_to_connection.median}m` : 'N/A';
        } else if (type === 'OUTGOING_RECONNECTION') {
          met = ag.outgoing_reconnect_met;
          total = ag.outgoing_reconnect_total;
          pct = ag.outgoing_reconnect_compliance_pct;
          tat = agTAT?.failed_outgoing_to_connection?.median !== undefined ? `${agTAT.failed_outgoing_to_connection.median}m` : 'N/A';
        } else if (type === 'SMS_FOLLOWUP') {
          met = ag.sms_followup_met;
          total = ag.sms_followup_total;
          pct = ag.sms_followup_compliance_pct;
          tat = agTAT?.failed_outgoing_to_sms?.median !== undefined ? `${agTAT.failed_outgoing_to_sms.median}m` : 'N/A';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="py-2.5 px-3 font-semibold text-slate-900">${ag.agent_name}</td>
          <td class="py-2.5 px-3 text-slate-500">${ag.tag || 'Uncategorised'}</td>
          <td class="py-2.5 px-3 text-center">${total}</td>
          <td class="py-2.5 px-3 text-center text-emerald-600 font-semibold">${met}</td>
          <td class="py-2.5 px-3 text-center font-bold">${pct !== null ? `${pct}%` : '--'}</td>
          <td class="py-2.5 px-3 text-center text-slate-600">${tat}</td>
        `;
        tbodyA.appendChild(tr);
      });

      // Obligations View
      const tbodyO = document.getElementById('drilldown-obligations-tbody');
      tbodyO.innerHTML = '';
      if (obls.length === 0) {
        tbodyO.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No obligations recorded in this range</td></tr>`;
      } else {
        obls.forEach(obl => {
          const tr = document.createElement('tr');
          const isMet = obl.status === 'MET';
          const isBreached = obl.status === 'BREACHED';
          const badgeClass = isMet ? 'bg-emerald-100 text-emerald-700' : isBreached ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';

          tr.innerHTML = `
            <td class="py-2.5 px-3 font-mono font-semibold text-slate-900">${obl.target_phone}</td>
            <td class="py-2.5 px-3">${obl.originating_agent_name || 'Unknown'}</td>
            <td class="py-2.5 px-3 text-slate-500">${obl.trigger_timestamp}</td>
            <td class="py-2.5 px-3 text-slate-500">${obl.deadline_timestamp}</td>
            <td class="py-2.5 px-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}">${obl.status}</span></td>
            <td class="py-2.5 px-3 text-center">${obl.turnaround_minutes !== undefined ? `${obl.turnaround_minutes}m` : '--'}</td>
            <td class="py-2.5 px-3 text-right">
              <button onclick="inspectContact('${obl.target_phone}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-[10px]">Inspect</button>
            </td>
          `;
          tbodyO.appendChild(tr);
        });
      }
    }

    // 7. Contact Timeline Inspector
    async function inspectContact(phone) {
      document.getElementById('inspect-phone').textContent = phone;
      const modal = document.getElementById('modal-contact-history');
      const timeline = document.getElementById('timeline-container');
      timeline.innerHTML = '<p class="text-slate-400 py-4 text-center">Loading chronological events...</p>';
      modal.classList.remove('hidden');

      try {
        const res = await fetch(`api.php?action=contact-history&phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
        timeline.innerHTML = '';

        if (!data.events || data.events.length === 0) {
          timeline.innerHTML = '<p class="text-slate-400 py-4 text-center">No communication history found for this phone.</p>';
          return;
        }

        data.events.forEach(ev => {
          const item = document.createElement('div');
          item.className = 'relative pl-8 pb-3';

          const isCall = ev.type === 'CALL';
          const iconColor = ev.status === 'CONNECTED' ? 'bg-emerald-500 text-white' : ev.status === 'MISSED' ? 'bg-rose-500 text-white' : 'bg-blue-500 text-white';

          item.innerHTML = `
            <div class="absolute left-2 top-0 w-3.5 h-3.5 rounded-full ${iconColor} flex items-center justify-center text-[8px] font-bold ring-4 ring-white"></div>
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-900">${ev.type}: ${ev.status}</span>
                <span class="text-slate-400 text-[10px]">${ev.timestamp}</span>
              </div>
              <p class="text-slate-600 mt-1">Agent: <strong>${ev.agent_name}</strong> (${ev.agent_tag}) ${ev.duration > 0 ? `• Duration: ${ev.duration}s` : ''}</p>
            </div>
          `;
          timeline.appendChild(item);
        });
      } catch (err) {
        timeline.innerHTML = `<p class="text-rose-500 py-4 text-center">${err.message}</p>`;
      }
    }

    function closeContactInspector() {
      document.getElementById('modal-contact-history').classList.add('hidden');
    }

    // 8. Settings Modal
    function openSettingsModal() {
      if (!currentSettings) return;
      document.getElementById('setting-callback-mins').value = currentSettings.callback_window_minutes;
      document.getElementById('setting-reconnect-mins').value = currentSettings.reconnection_window_minutes;
      document.getElementById('setting-sms-mins').value = currentSettings.sms_deadline_minutes;
      document.getElementById('setting-clock-mode').value = currentSettings.clock_mode || 'working_hours';
      document.getElementById('setting-min-duration').value = currentSettings.min_connection_duration || 0;

      const schedule = currentSettings.working_hours_schedule || {};
      const container = document.getElementById('schedule-days-container');
      container.innerHTML = '';

      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
        const d = schedule[day] || { enabled: false, open: '09:00', close: '17:00' };
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100';
        row.innerHTML = `
          <label class="flex items-center gap-2 font-medium capitalize text-slate-800 w-28">
            <input type="checkbox" id="sched-enable-${day}" ${d.enabled ? 'checked' : ''} class="rounded text-amber-500" /> ${day}
          </label>
          <div class="flex items-center gap-2">
            <input type="time" id="sched-open-${day}" value="${d.open || '09:00'}" class="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
            <span class="text-slate-400">to</span>
            <input type="time" id="sched-close-${day}" value="${d.close || '17:00'}" class="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
          </div>
        `;
        container.appendChild(row);
      });

      document.getElementById('modal-settings').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeSettingsModal() {
      document.getElementById('modal-settings').classList.add('hidden');
    }

    async function saveSettings() {
      const schedule = {};
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
        schedule[day] = {
          enabled: document.getElementById(`sched-enable-${day}`).checked,
          open: document.getElementById(`sched-open-${day}`).value,
          close: document.getElementById(`sched-close-${day}`).value,
        };
      });

      const payload = {
        callback_window_minutes: parseInt(document.getElementById('setting-callback-mins').value),
        reconnection_window_minutes: parseInt(document.getElementById('setting-reconnect-mins').value),
        sms_deadline_minutes: parseInt(document.getElementById('setting-sms-mins').value),
        clock_mode: document.getElementById('setting-clock-mode').value,
        min_connection_duration: parseInt(document.getElementById('setting-min-duration').value),
        working_hours_schedule: schedule,
      };

      await fetch('api.php?action=settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      closeSettingsModal();
      fetchComplianceData();
    }

    // 9. Internal Contacts Modal
    async function openInternalContactsModal() {
      const modal = document.getElementById('modal-internal-contacts');
      modal.classList.remove('hidden');
      loadInternalContacts();
      lucide.createIcons();
    }

    function closeInternalContactsModal() {
      document.getElementById('modal-internal-contacts').classList.add('hidden');
    }

    async function loadInternalContacts() {
      const res = await fetch('api.php?action=internal-contacts');
      const contacts = await res.json();
      const tbody = document.getElementById('internal-contacts-tbody');
      tbody.innerHTML = '';

      contacts.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="py-2 px-3 font-mono font-semibold text-slate-900">${c.phone_number}</td>
          <td class="py-2 px-3 text-slate-600">${c.label}</td>
          <td class="py-2 px-3 text-right">
            <button onclick="deleteInternalContact(${c.id})" class="text-rose-600 hover:text-rose-700 p-1 font-semibold text-[11px]">Remove</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    async function addInternalContact() {
      const phone = document.getElementById('new-internal-phone').value;
      const label = document.getElementById('new-internal-label').value;
      if (!phone) return;

      await fetch('api.php?action=internal-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, label: label })
      });

      document.getElementById('new-internal-phone').value = '';
      document.getElementById('new-internal-label').value = '';
      loadInternalContacts();
    }

    async function deleteInternalContact(id) {
      await fetch('api.php?action=delete-internal-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      loadInternalContacts();
    }

    // 10. Update Agent Department Tag
    async function promptEditTag(agentId, currentTag) {
      const newTag = prompt("Enter new department/tag for this agent:", currentTag);
      if (newTag !== null) {
        await fetch('api.php?action=update-agent-tag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, tag: newTag.trim() })
        });
        fetchComplianceData();
      }
    }

    // 11. Seed Demo Data
    async function triggerSeedData() {
      if (confirm('This will seed realistic sample communication events. Proceed?')) {
        const res = await fetch('api.php?action=seed-data', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Seeding complete!');
        fetchComplianceData();
      }
    }

    // 12. Excel Exports
    function exportAgentsExcel() {
      if (!complianceData?.agent_summaries) return;
      const rows = complianceData.agent_summaries.map(a => ({
        "Agent Name": a.agent_name,
        "Department / Tag": a.tag,
        "Phone": a.phone_number,
        "Incoming Callback %": a.incoming_callback_compliance_pct ?? 'N/A',
        "Incoming Met": a.incoming_callback_met,
        "Incoming Total": a.incoming_callback_total,
        "Outgoing Reconnect %": a.outgoing_reconnect_compliance_pct ?? 'N/A',
        "Outgoing Met": a.outgoing_reconnect_met,
        "Outgoing Total": a.outgoing_reconnect_total,
        "SMS Follow-up %": a.sms_followup_compliance_pct ?? 'N/A',
        "SMS Met": a.sms_followup_met,
        "SMS Total": a.sms_followup_total,
        "Combined Compliance %": a.combined_compliance_pct ?? 'N/A',
        "Open Obligations": a.open_obligations_count,
        "Attributed Breaches": a.breaches_attributed_count
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Agent Compliance");
      XLSX.writeFile(wb, `Solvit_Agent_Compliance_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    function exportDrilldownExcel() {
      if (!activeDrilldownType || !complianceData) return;
      const obls = (complianceData.all_obligations || []).filter(o => o.obligation_type === activeDrilldownType);
      const rows = obls.map(o => ({
        "Client Phone": o.target_phone,
        "Type": o.obligation_type,
        "Originating Agent": o.originating_agent_name,
        "Department": o.originating_agent_tag,
        "Trigger Time": o.trigger_timestamp,
        "SLA Deadline": o.deadline_timestamp,
        "Status": o.status,
        "Resolution Time": o.resolution_timestamp || 'N/A',
        "Resolving Agent": o.resolving_agent_name || 'N/A',
        "Turnaround (mins)": o.turnaround_minutes ?? 'N/A'
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Drilldown Audit");
      XLSX.writeFile(wb, `Solvit_${activeDrilldownType}_Drilldown.xlsx`);
    }
  </script>
</body>
</html>
