// ============================================
//   AUTO TIMELINE — REAL BACKEND CONNECTED
//   Flask API + Playwright Engine
// ============================================

const API_BASE = 'http://localhost:5050/api';
let POLL_INTERVAL = null;
let LOG_POLL_INTERVAL = null;
let lastLogTimestamp = 0;

// ===== LUCIDE ICON HELPER =====
function icon(name, cls = '') {
    return `<i data-lucide="${name}" class="${cls}"></i>`;
}
function refreshIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ===== GLOBAL STATE =====
let state = {
    chapters: [],
    cookies: [],
    models: [],
    currentChapterIndex: -1,
    currentPage: 'dashboard',
    isRunning: false,
    activityLog: [],
    engineStatus: 'disconnected', // disconnected, idle, running, error
    browserReady: false,
    settings: { waitTime: 10, autoRetry: true, maxRetry: 3, namingPattern: 'chapter_prompt', theme: 'default' }
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initLoadingScreen();
    renderAll();
    setupKeyboardShortcuts();
    checkEngineStatus();
    startLogPolling();
});

function initLoadingScreen() {
    setTimeout(() => {
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('appContainer').classList.add('visible');
        refreshIcons();
    }, 1800);
}

// ===== STATE MANAGEMENT =====
function saveState() {
    try {
        const toSave = { ...state };
        delete toSave.activityLog; // Logs come from server
        localStorage.setItem('autoTimeline', JSON.stringify(toSave));
    } catch (e) { console.error('Save failed:', e); }
}

function loadState() {
    try {
        const saved = localStorage.getItem('autoTimeline');
        if (saved) {
            const parsed = JSON.parse(saved);
            state = { ...state, ...parsed };
            if (!Array.isArray(state.models)) state.models = [];
            if (!Array.isArray(state.chapters)) state.chapters = [];
        }

        // Auto-fetch hardcoded accounts from new API
        fetch(`${API_BASE}/cookies`)
            .then(res => res.json())
            .then(data => {
                state.cookies = data;
                renderCookies();
                updateSidebarStats();
            })
            .catch(e => console.warn('Could not load accounts from server', e));

    } catch (e) { console.error('Load failed:', e); }
}

// ===== ENGINE STATUS =====
async function checkEngineStatus() {
    try {
        const resp = await fetch(`${API_BASE}/status`);
        if (!resp.ok) throw new Error('Server not reachable');
        const data = await resp.json();
        state.engineStatus = data.engine_status;
        state.browserReady = data.browser_ready;
        updateEngineStatusUI(data);
    } catch (e) {
        state.engineStatus = 'disconnected';
        state.browserReady = false;
        updateEngineStatusUI({ engine_status: 'disconnected', browser_ready: false });
    }
    // Check again every 3 seconds
    setTimeout(checkEngineStatus, 3000);
}

function updateEngineStatusUI(data) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const engineBtn = document.getElementById('engineToggleBtn');

    if (!dot || !text) return;

    if (data.engine_status === 'disconnected' || !data.browser_ready) {
        dot.style.background = '#ff4444';
        dot.style.boxShadow = '0 0 10px #ff4444';
        text.textContent = data.engine_status === 'disconnected' ? 'Server Offline' : 'Engine Off';
        if (engineBtn) {
            engineBtn.textContent = 'START ENGINE';
            engineBtn.className = 'neon-btn engine-btn engine-off';
        }
    } else if (data.engine_status === 'running') {
        dot.style.background = '#00ff88';
        dot.style.boxShadow = '0 0 10px #00ff88';
        text.textContent = 'Running';
        if (engineBtn) {
            engineBtn.textContent = 'RUNNING';
            engineBtn.className = 'neon-btn engine-btn engine-running';
        }
    } else {
        dot.style.background = '#00f0ff';
        dot.style.boxShadow = '0 0 10px #00f0ff';
        text.textContent = 'Engine Ready';
        if (engineBtn) {
            engineBtn.textContent = 'ENGINE ON';
            engineBtn.className = 'neon-btn engine-btn engine-on';
        }
    }
    refreshIcons();
}

async function toggleEngine() {
    if (state.browserReady) {
        // Stop engine
        showToast('Stopping engine...', 'info');
        try {
            await fetch(`${API_BASE}/engine/stop`, { method: 'POST' });
            showToast('Engine stopped', 'warning');
        } catch (e) {
            showToast('Failed to stop engine', 'error');
        }
    } else {
        // Start engine
        showToast('Starting browser engine...', 'info');
        try {
            const resp = await fetch(`${API_BASE}/engine/start`, { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                showToast('Browser engine started!', 'success');
            } else {
                showToast('Engine starting, please wait...', 'info');
            }
        } catch (e) {
            showToast('Server not running! Start backend_server.py first', 'error');
        }
    }
}

// ===== LOG POLLING =====
function startLogPolling() {
    LOG_POLL_INTERVAL = setInterval(async () => {
        try {
            const resp = await fetch(`${API_BASE}/logs?since=${lastLogTimestamp}`);
            if (!resp.ok) return;
            const logs = await resp.json();
            if (logs.length > 0) {
                logs.forEach(log => {
                    state.activityLog.push(log);
                    lastLogTimestamp = Math.max(lastLogTimestamp, log.timestamp);
                });
                // Keep last 200
                if (state.activityLog.length > 200) {
                    state.activityLog = state.activityLog.slice(-200);
                }
                if (state.currentPage === 'tracking') renderTracking();
            }
        } catch (e) { /* server might be down */ }
    }, 2000);
}

// ===== CHAPTER STATUS POLLING =====
function startChapterPolling() {
    if (POLL_INTERVAL) clearInterval(POLL_INTERVAL);
    POLL_INTERVAL = setInterval(async () => {
        try {
            const resp = await fetch(`${API_BASE}/chapters/status`);
            if (!resp.ok) return;
            const allStatus = await resp.json();

            let anyRunning = false;
            for (const ch of state.chapters) {
                const chId = String(ch.id);
                const serverStatus = allStatus[chId];
                if (!serverStatus) continue;

                // Update chapter prompts with real results
                ch._serverStatus = serverStatus;

                if (serverStatus.status === 'running') anyRunning = true;

                // Update prompt statuses from server
                if (serverStatus.results) {
                    serverStatus.results.forEach(result => {
                        if (ch.prompts[result.index]) {
                            ch.prompts[result.index].status = result.status;
                            ch.prompts[result.index].timeTaken = result.time_taken;
                            ch.prompts[result.index].imagePath = result.image_path;
                            ch.prompts[result.index].imageFilename = result.image_filename;
                        }
                    });
                }

                // Mark current prompt as running
                if (serverStatus.status === 'running' && serverStatus.current >= 0) {
                    for (let i = 0; i < ch.prompts.length; i++) {
                        if (i === serverStatus.current && ch.prompts[i].status === 'pending') {
                            ch.prompts[i].status = 'running';
                        }
                    }
                }

                // Update chapter status
                if (serverStatus.status === 'done') {
                    ch.status = 'done';
                } else if (serverStatus.status === 'error') {
                    ch.status = 'error';
                } else if (serverStatus.status === 'running') {
                    ch.status = 'running';
                }
            }

            state.isRunning = anyRunning;
            saveState();

            // Re-render relevant views
            if (state.currentPage === 'chapter') renderChapterDetail();
            if (state.currentPage === 'dashboard') renderDashboard();
            if (state.currentPage === 'tracking') renderTracking();

            if (!anyRunning && Object.keys(allStatus).length > 0) {
                // All done, slow down polling
                clearInterval(POLL_INTERVAL);
                POLL_INTERVAL = null;
            }
        } catch (e) { /* server offline */ }
    }, 2500);
}

// ===== PAGE NAVIGATION =====
function showPage(pageName) {
    state.currentPage = pageName;
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === pageName));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) targetPage.classList.add('active');
    const titles = {
        dashboard: 'Dashboard',
        chapter: `Chapter ${state.currentChapterIndex + 1}`,
        cookies: 'Login Cookies',
        tracking: 'Live Tracking',
        downloads: 'Downloads',
        settings: 'Settings'
    };
    document.getElementById('pageTitle').textContent = titles[pageName] || pageName;
    document.getElementById('sidebar').classList.remove('open');
    if (pageName === 'dashboard') renderDashboard();
    if (pageName === 'chapter') renderChapterDetail();
    if (pageName === 'cookies') renderCookies();
    if (pageName === 'tracking') renderTracking();
    if (pageName === 'downloads') renderDownloads();
    saveState();
    refreshIcons();
}

function showChapterPage(index) {
    state.currentChapterIndex = index;
    document.querySelectorAll('.chapter-nav-item').forEach((item, i) => item.classList.toggle('active', i === index));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    showPage('chapter');
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ===== RENDER FUNCTIONS =====
function renderAll() { renderSidebarChapters(); renderDashboard(); updateSidebarStats(); refreshIcons(); }

function renderSidebarChapters() {
    const list = document.getElementById('chaptersList');
    list.innerHTML = '';
    state.chapters.forEach((chapter, index) => {
        const btn = document.createElement('button');
        btn.className = `chapter-nav-item ${state.currentChapterIndex === index ? 'active' : ''}`;
        btn.onclick = () => showChapterPage(index);
        btn.innerHTML = `<span class="nav-icon">${icon('book-open', 'icon-sm')}</span><span class="nav-text">${chapter.name || `Chapter ${index + 1}`}</span><span class="chapter-nav-status">${getChapterProgress(chapter)}%</span>`;
        list.appendChild(btn);
    });
    refreshIcons();
}

function renderDashboard() {
    const totals = getTotalStats();
    document.getElementById('dashChapters').textContent = state.chapters.length;
    document.getElementById('dashTotalPrompts').textContent = totals.total;
    document.getElementById('dashModels').textContent = getUsedModelsCount();
    document.getElementById('dashCookies').textContent = state.cookies.length;
    const percent = totals.total > 0 ? Math.round((totals.success / totals.total) * 100) : 0;
    document.getElementById('overallProgress').style.width = percent + '%';
    document.getElementById('overallPercent').textContent = percent + '%';
    document.getElementById('dashSuccess').textContent = totals.success;
    document.getElementById('dashFailed').textContent = totals.failed;
    document.getElementById('dashPending').textContent = totals.pending;
    const grid = document.getElementById('chaptersGrid');
    grid.innerHTML = '';
    if (state.chapters.length === 0) {
        grid.innerHTML = `<div class="glass-card" style="padding: 40px; text-align: center; grid-column: 1 / -1;"><div style="margin-bottom: 15px;">${icon('book-open', 'icon-xl')}</div><h3 style="margin-bottom: 8px;">No Chapters Yet</h3><p style="color: var(--text-muted); margin-bottom: 20px;">Create your first chapter to get started</p><button class="neon-btn-sm" onclick="addNewChapter()">${icon('plus', 'icon-sm')} Add First Chapter</button></div>`;
        refreshIcons();
        return;
    }
    state.chapters.forEach((chapter, index) => {
        const progress = getChapterProgress(chapter);
        const stats = getChapterStats(chapter);
        const serverStatus = chapter._serverStatus;
        const card = document.createElement('div');
        card.className = 'chapter-card glass-card';
        card.onclick = () => showChapterPage(index);

        // Time info
        let timeInfo = '';
        if (serverStatus) {
            const elapsed = formatTime(serverStatus.elapsed);
            const eta = serverStatus.eta > 0 ? formatTime(serverStatus.eta) : '--';
            const avgPer = serverStatus.avg_per_prompt > 0 ? `${serverStatus.avg_per_prompt.toFixed(1)}s/prompt` : '';
            timeInfo = `<div class="chapter-card-time">${icon('clock', 'icon-xs')} ${elapsed} elapsed · ETA: ${eta} ${avgPer ? '· ' + avgPer : ''}</div>`;
        }

        card.innerHTML = `<div class="chapter-card-header"><span class="chapter-card-number">CH ${index + 1}</span><span class="chapter-card-status ${getStatusClass(chapter)}">${getStatusLabel(chapter)}</span></div><div class="chapter-card-name">${chapter.name || `Chapter ${index + 1}`}</div><div class="chapter-card-info">${chapter.prompts.length} prompts · ${chapter.selectedModel || 'No model'} · Cookie: ${chapter.assignedCookie !== null ? state.cookies[chapter.assignedCookie]?.label || 'Set' : 'None'}</div>${timeInfo}<div class="chapter-card-progress"><div class="cyber-progress"><div class="progress-bar" style="width: ${progress}%"><div class="progress-glow"></div></div></div><div class="chapter-card-stats"><span>${stats.success} done</span><span>${stats.failed} failed</span><span>${stats.pending} pending</span><span>${progress}%</span></div></div>`;
        grid.appendChild(card);
    });
    updateSidebarStats();
    refreshIcons();
}

function renderChapterDetail() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    const index = state.currentChapterIndex;
    document.getElementById('chapterBadge').textContent = `CH ${index + 1}`;
    document.getElementById('chapterNameInput').value = chapter.name || `Chapter ${index + 1}`;
    document.getElementById('chapterPromptCount').textContent = `${chapter.prompts.length}/50 Prompts`;
    document.getElementById('chapterStatus').textContent = getStatusLabel(chapter);
    const nameInput = document.getElementById('chapterNameInput');
    nameInput.oninput = () => { chapter.name = nameInput.value; saveState(); renderSidebarChapters(); };
    renderModelSelector(chapter);
    renderCookieSelect(chapter);
    renderPromptsList(chapter);
    renderTimelineGallery(chapter);
    renderChapterTimeInfo(chapter);
    const stats = getChapterStats(chapter);
    const progress = getChapterProgress(chapter);
    document.getElementById('chapterProgressBar').style.width = progress + '%';
    document.getElementById('chSuccess').textContent = stats.success;
    document.getElementById('chFailed').textContent = stats.failed;
    document.getElementById('chPending').textContent = stats.pending;
    document.getElementById('chRetry').textContent = stats.retry;
    refreshIcons();
}

function renderChapterTimeInfo(chapter) {
    const timeEl = document.getElementById('chapterTimeInfo');
    if (!timeEl) return;

    const ss = chapter._serverStatus;
    if (!ss) {
        timeEl.innerHTML = `<div class="time-info-grid"><div class="time-card"><span class="time-label">Elapsed</span><span class="time-value">--:--</span></div><div class="time-card"><span class="time-label">ETA</span><span class="time-value">--:--</span></div><div class="time-card"><span class="time-label">Avg/Prompt</span><span class="time-value">--</span></div><div class="time-card"><span class="time-label">Progress</span><span class="time-value">${chapter.prompts.filter(p => p.status === 'success').length}/${chapter.prompts.length}</span></div></div>`;
        return;
    }

    const elapsed = formatTime(ss.elapsed);
    const eta = ss.eta > 0 ? formatTime(ss.eta) : 'Done';
    const avgPer = ss.avg_per_prompt > 0 ? `${ss.avg_per_prompt.toFixed(1)}s` : '--';
    const done = ss.success + ss.failed;

    timeEl.innerHTML = `
        <div class="time-info-grid">
            <div class="time-card">
                <span class="time-label">${icon('clock', 'icon-xs')} Elapsed</span>
                <span class="time-value">${elapsed}</span>
            </div>
            <div class="time-card">
                <span class="time-label">${icon('timer', 'icon-xs')} ETA</span>
                <span class="time-value ${ss.eta > 0 ? 'eta-active' : ''}">${eta}</span>
            </div>
            <div class="time-card">
                <span class="time-label">${icon('gauge', 'icon-xs')} Avg/Prompt</span>
                <span class="time-value">${avgPer}</span>
            </div>
            <div class="time-card">
                <span class="time-label">${icon('check-circle', 'icon-xs')} Done</span>
                <span class="time-value">${done}/${ss.total}</span>
            </div>
        </div>
    `;
}

function renderModelSelector(chapter) {
    const grid = document.getElementById('modelSelectorGrid');
    grid.innerHTML = '';
    state.models.forEach(model => {
        const div = document.createElement('div');
        div.className = `model-option ${chapter.selectedModel === model.id ? 'selected' : ''}`;
        div.onclick = () => { chapter.selectedModel = model.id; saveState(); renderModelSelector(chapter); showToast(`Model "${model.name}" selected`, 'success'); };
        div.innerHTML = `<div class="model-icon-wrap">${icon('palette')}</div><span class="model-name">${model.name}</span>`;
        grid.appendChild(div);
    });
    if (state.models.length === 0) {
        grid.innerHTML = `<div style="padding: 15px; color: var(--text-muted); font-size: 13px;">No models added yet. Click "Add Custom Model" below.</div>`;
    }
    refreshIcons();
}

function renderCookieSelect(chapter) {
    const select = document.getElementById('chapterCookieSelect');
    select.innerHTML = '<option value="">Select Cookie Account...</option>';
    state.cookies.forEach((cookie, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${cookie.label} (${cookie.status || 'not verified'})`;
        option.selected = chapter.assignedCookie === index;
        select.appendChild(option);
    });
    select.onchange = () => { chapter.assignedCookie = select.value ? parseInt(select.value) : null; saveState(); showToast('Cookie assigned', 'success'); };
}

function renderPromptsList(chapter) {
    const list = document.getElementById('promptsList');
    list.innerHTML = '';
    chapter.prompts.forEach((prompt, index) => {
        const item = document.createElement('div');
        item.className = `prompt-item ${prompt.status === 'running' ? 'prompt-running' : ''}`;
        const statusIcons = { pending: 'clock', running: 'loader', success: 'check-circle', failed: 'x-circle', retry: 'refresh-cw' };
        const statusColors = { pending: 'var(--text-muted)', running: 'var(--accent-primary)', success: 'var(--color-success)', failed: 'var(--color-danger)', retry: 'var(--color-retry)' };
        const iconName = statusIcons[prompt.status] || 'clock';

        // Time taken display
        let timeDisplay = '';
        if (prompt.timeTaken) {
            timeDisplay = `<span class="prompt-time">${prompt.timeTaken.toFixed(1)}s</span>`;
        } else if (prompt.status === 'running') {
            timeDisplay = `<span class="prompt-time pulse-text">generating...</span>`;
        }

        item.innerHTML = `<span class="prompt-num">#${index + 1}</span><span class="prompt-status-icon" style="color:${statusColors[prompt.status] || ''}">${icon(iconName, 'icon-sm')}</span><span class="prompt-text" title="${prompt.text}">${prompt.text}</span>${timeDisplay}<div class="prompt-actions"><button class="prompt-action-btn retry-btn" onclick="event.stopPropagation();retryPrompt(${index})" title="Retry">${icon('refresh-cw', 'icon-sm')}</button><button class="prompt-action-btn" onclick="event.stopPropagation();deletePrompt(${index})" title="Delete">${icon('trash-2', 'icon-sm')}</button></div>`;
        list.appendChild(item);
    });
    document.getElementById('promptCounter').textContent = `(${chapter.prompts.length}/50)`;
    document.getElementById('nextPromptNumber').textContent = `#${chapter.prompts.length + 1}`;
    document.getElementById('addPromptArea').style.display = chapter.prompts.length >= 50 ? 'none' : 'block';
    refreshIcons();
}

function renderTimelineGallery(chapter) {
    const grid = document.getElementById('timelineGalleryGrid');
    grid.innerHTML = '';

    const hasAnyResult = chapter.prompts.some(p => p.status === 'success' || p.status === 'failed' || p.status === 'running');

    if (!hasAnyResult) {
        grid.innerHTML = `<div class="empty-timeline-state">${icon('image', 'icon-xl')}<p style="margin-top:10px">Start generation to see real images here</p></div>`;
        refreshIcons();
        return;
    }

    const chapterDirName = getChapterDirName(chapter);

    chapter.prompts.forEach((prompt, index) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';

        let imgHtml = '';
        if (prompt.status === 'success' && prompt.imageFilename) {
            // Real image from backend!
            const imgUrl = `${API_BASE}/images/${chapterDirName}/${prompt.imageFilename}`;
            imgHtml = `<img src="${imgUrl}" alt="Prompt ${index + 1}" loading="lazy" onerror="this.onerror=null;this.src='';this.parentElement.innerHTML='<div class=\\'timeline-error\\'>Image loading...</div>'">`;
        } else if (prompt.status === 'running') {
            imgHtml = `<div class="timeline-generating"><div class="gen-spinner"></div><span>Generating...</span></div>`;
        } else if (prompt.status === 'failed') {
            imgHtml = `<div class="timeline-failed">${icon('x-circle', 'icon-lg')}<span>Failed</span></div>`;
        } else {
            // pending
            imgHtml = `<div class="timeline-pending">${icon('clock', 'icon-lg')}<span>Pending</span></div>`;
        }

        let timeLabel = '';
        if (prompt.timeTaken) {
            timeLabel = `<span class="timeline-time">${prompt.timeTaken.toFixed(1)}s</span>`;
        }

        item.innerHTML = `
            ${imgHtml}
            <span class="timeline-num">#${index + 1}</span>
            ${timeLabel}
            <div class="timeline-overlay">
                <span class="timeline-prompt-preview">${prompt.text.substring(0, 60)}...</span>
            </div>
        `;
        grid.appendChild(item);
    });
    refreshIcons();
}

function getChapterDirName(chapter) {
    const name = chapter.name || `chapter_${chapter.id}`;
    return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/ /g, '_');
}

function renderCookies() {
    const list = document.getElementById('cookiesList');
    list.innerHTML = '';
    if (state.cookies.length === 0) {
        list.innerHTML = `<div class="glass-card" style="padding: 40px; text-align: center;"><div style="margin-bottom: 15px;">${icon('key-round', 'icon-xl')}</div><h3 style="margin-bottom: 8px;">No Login Cookies</h3><p style="color: var(--text-muted); margin-bottom: 20px;">Add your TAAFT login cookies to start generating real images</p><button class="neon-btn-sm" onclick="openAddCookieModal()">${icon('plus', 'icon-sm')} Add First Cookie</button></div>`;
        refreshIcons(); return;
    }
    state.cookies.forEach((cookie, index) => {
        const assignedChapters = state.chapters.filter(ch => ch.assignedCookie === index).map(ch => ch.name || `Chapter ${state.chapters.indexOf(ch) + 1}`).join(', ');
        const statusBadge = cookie.status === 'valid' ? '<span class="cookie-status-badge valid">✓ Valid</span>' :
            cookie.status === 'invalid' ? '<span class="cookie-status-badge invalid">✗ Invalid</span>' :
                '<span class="cookie-status-badge unknown">? Not verified</span>';
        const item = document.createElement('div');
        item.className = 'cookie-item glass-card';
        item.innerHTML = `<div class="cookie-item-left"><div class="cookie-icon">${icon('key-round')}</div><div class="cookie-info"><span class="cookie-label">${cookie.label} ${statusBadge}</span><span class="cookie-preview">${cookie.value.substring(0, 50)}...</span></div></div><div class="cookie-item-right">${assignedChapters ? `<span class="cookie-assigned">${assignedChapters}</span>` : '<span style="font-size:12px;color:var(--text-muted)">Not assigned</span>'}<button class="neon-btn-sm btn-verify" onclick="verifyCookie(${index})">${icon('shield-check', 'icon-sm')} Verify</button><button class="neon-btn-sm btn-danger" onclick="deleteCookie(${index})">${icon('trash-2', 'icon-sm')}</button></div>`;
        list.appendChild(item);
    });
    refreshIcons();
}

function renderTracking() { renderActivityFeed(); renderTrackingStats(); renderChapterTracking(); refreshIcons(); }

function renderActivityFeed() {
    const feed = document.getElementById('activityFeed');
    feed.innerHTML = '';
    if (state.activityLog.length === 0) {
        feed.innerHTML = `<div class="feed-item feed-info"><span class="feed-time">--:--</span><span class="feed-msg">System ready. Start the engine and a chapter to see live activity.</span></div>`;
        return;
    }
    state.activityLog.slice(-50).reverse().forEach(log => {
        const item = document.createElement('div');
        item.className = `feed-item feed-${log.type.toLowerCase()}`;
        item.innerHTML = `<span class="feed-time">${log.time || '--:--'}</span><span class="feed-msg">${log.message}</span>`;
        feed.appendChild(item);
    });
}

function renderTrackingStats() {
    const totals = getTotalStats();
    document.getElementById('trackSuccess').textContent = totals.success;
    document.getElementById('trackFailed').textContent = totals.failed;
    document.getElementById('trackRetry').textContent = totals.retry;
    document.getElementById('trackPending').textContent = totals.pending;
}

function renderChapterTracking() {
    const list = document.getElementById('chapterTrackingList');
    list.innerHTML = '';
    state.chapters.forEach((chapter, index) => {
        const stats = getChapterStats(chapter);
        const progress = getChapterProgress(chapter);
        const ss = chapter._serverStatus;

        let timeInfo = '';
        if (ss) {
            timeInfo = `<div class="track-time">${icon('clock', 'icon-xs')} ${formatTime(ss.elapsed)} elapsed · ETA: ${ss.eta > 0 ? formatTime(ss.eta) : '--'} · ${ss.avg_per_prompt > 0 ? ss.avg_per_prompt.toFixed(1) + 's/img' : ''}</div>`;
        }

        const card = document.createElement('div');
        card.className = 'chapter-track-card glass-card';
        card.innerHTML = `<span class="chapter-track-badge">CH ${index + 1}</span><div class="chapter-track-info"><div class="track-name">${chapter.name || `Chapter ${index + 1}`}</div>${timeInfo}<div class="cyber-progress"><div class="progress-bar" style="width: ${progress}%"><div class="progress-glow"></div></div></div></div><div class="chapter-track-stats"><span>${stats.success} done</span><span>${stats.failed} fail</span><span>${stats.pending} wait</span><span>${progress}%</span></div>`;
        list.appendChild(card);
    });
    refreshIcons();
}

function renderDownloads() {
    const grid = document.getElementById('downloadsGrid');
    grid.innerHTML = '';
    if (state.chapters.length === 0) {
        grid.innerHTML = `<div class="glass-card" style="padding: 40px; text-align: center; grid-column: 1 / -1;"><div style="margin-bottom: 15px;">${icon('folder-down', 'icon-xl')}</div><h3 style="margin-bottom: 8px;">No Downloads Available</h3><p style="color: var(--text-muted);">Complete chapters to download images</p></div>`;
        refreshIcons(); return;
    }
    state.chapters.forEach((chapter, index) => {
        const stats = getChapterStats(chapter);
        const hasImages = stats.success > 0;
        const chDir = getChapterDirName(chapter);
        const card = document.createElement('div');
        card.className = 'download-card glass-card';
        card.innerHTML = `<div class="download-icon">${icon('folder-down', 'icon-xl')}</div><div class="download-chapter-name">${chapter.name || `Chapter ${index + 1}`}</div><div class="download-info">${stats.success} images · ${chapter.prompts.length} prompts</div><button class="download-btn" ${!hasImages ? 'disabled' : ''} onclick="viewChapterImages('${chDir}')">${hasImages ? icon('eye', 'icon-sm') + ' View Images' : 'No images yet'}</button>`;
        grid.appendChild(card);
    });
    refreshIcons();
}

// ===== CHAPTER MANAGEMENT =====
function addNewChapter() {
    state.chapters.push({ id: Date.now(), name: `Chapter ${state.chapters.length + 1}`, prompts: [], selectedModel: null, assignedCookie: null, status: 'pending' });
    saveState(); renderAll();
    showToast(`Chapter ${state.chapters.length} created!`, 'success');
    showChapterPage(state.chapters.length - 1);
}

function deleteCurrentChapter() {
    const idx = state.currentChapterIndex;
    if (idx < 0 || idx >= state.chapters.length) return;
    const name = state.chapters[idx].name || `Chapter ${idx + 1}`;
    state.chapters.splice(idx, 1);
    state.chapters.forEach(ch => {
        if (ch.assignedCookie !== null && ch.assignedCookie !== undefined) { }
    });
    state.currentChapterIndex = -1;
    saveState(); renderAll();
    showPage('dashboard');
    showToast(`"${name}" deleted`, 'warning');
}

// ===== PROMPT MANAGEMENT =====
function addPrompt() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    const input = document.getElementById('newPromptInput');
    const text = input.value.trim();
    if (!text) { showToast('Please enter a prompt', 'warning'); return; }
    if (chapter.prompts.length >= 50) { showToast('Maximum 50 prompts per chapter!', 'error'); return; }
    chapter.prompts.push({ id: Date.now(), text, status: 'pending', retryCount: 0, timeTaken: null, imagePath: null, imageFilename: null });
    input.value = ''; input.focus();
    saveState(); renderChapterDetail(); updateSidebarStats();
    showToast(`Prompt #${chapter.prompts.length} added`, 'success');
}

function deletePrompt(index) {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    chapter.prompts.splice(index, 1);
    saveState(); renderChapterDetail(); updateSidebarStats();
}

function retryPrompt(index) {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    chapter.prompts[index].status = 'pending';
    chapter.prompts[index].retryCount++;
    chapter.prompts[index].timeTaken = null;
    chapter.prompts[index].imagePath = null;
    chapter.prompts[index].imageFilename = null;
    saveState(); renderChapterDetail();
    showToast(`Prompt #${index + 1} reset for retry`, 'info');
}

function clearAllPrompts() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    if (!confirm('Clear all prompts?')) return;
    chapter.prompts = [];
    saveState(); renderChapterDetail(); updateSidebarStats();
    showToast('All prompts cleared', 'warning');
}

function bulkImportPrompts() { openModal('bulkImportModal'); }

function processBulkImport() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    const input = document.getElementById('bulkPromptInput');
    const lines = input.value.split('\n').filter(line => line.trim());
    if (lines.length === 0) { showToast('No prompts to import', 'warning'); return; }
    const remaining = 50 - chapter.prompts.length;
    const toAdd = lines.slice(0, remaining);
    toAdd.forEach(text => { chapter.prompts.push({ id: Date.now() + Math.random(), text: text.trim(), status: 'pending', retryCount: 0, timeTaken: null, imagePath: null, imageFilename: null }); });
    input.value = '';
    closeModal('bulkImportModal');
    saveState(); renderChapterDetail(); updateSidebarStats();
    showToast(`${toAdd.length} prompts imported!`, 'success');
    if (lines.length > remaining) showToast(`${lines.length - remaining} skipped (50 limit)`, 'warning');
}

function exportPrompts() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter || chapter.prompts.length === 0) { showToast('No prompts to export', 'warning'); return; }
    const text = chapter.prompts.map(p => p.text).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${chapter.name || 'chapter'}_prompts.txt`; a.click();
    showToast('Prompts exported!', 'success');
}

// ===== MODEL MANAGEMENT =====
function openAddModelModal() { openModal('addModelModal'); }

function addCustomModel() {
    const name = document.getElementById('newModelName').value.trim();
    const id = document.getElementById('newModelId').value.trim();
    if (!name || !id) { showToast('Please fill model name and ID', 'warning'); return; }
    if (state.models.find(m => m.id === id)) { showToast('Model ID already exists', 'error'); return; }
    state.models.push({ id, name });
    document.getElementById('newModelName').value = '';
    document.getElementById('newModelId').value = '';
    closeModal('addModelModal'); saveState();
    if (state.currentChapterIndex >= 0) renderModelSelector(state.chapters[state.currentChapterIndex]);
    showToast(`Model "${name}" added!`, 'success');
}

// ===== COOKIE MANAGEMENT (REAL) =====
function openAddCookieModal() { openModal('addCookieModal'); }

async function addCookie() {
    const label = document.getElementById('cookieLabel').value.trim();
    const value = document.getElementById('cookieValue').value.trim();
    if (!label || !value) { showToast('Please fill all fields', 'warning'); return; }

    const cookieId = String(Date.now());

    // Save to backend
    try {
        const resp = await fetch(`${API_BASE}/cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cookieId, label, value })
        });
        const data = await resp.json();
        if (!data.success) {
            showToast(data.message || 'Failed to save cookie', 'error');
            return;
        }
    } catch (e) {
        // If server is down, still save locally
        console.warn('Server not reachable, saving locally only');
    }

    // Save to local state
    state.cookies.push({ id: cookieId, label, value, status: 'not verified' });
    document.getElementById('cookieLabel').value = '';
    document.getElementById('cookieValue').value = '';
    closeModal('addCookieModal'); saveState(); renderCookies(); updateSidebarStats();
    showToast(`Cookie "${label}" saved!`, 'success');
}

async function deleteCookie(index) {
    if (!confirm('Delete this cookie?')) return;
    const cookie = state.cookies[index];

    // Delete from backend
    if (cookie.id) {
        try {
            await fetch(`${API_BASE}/cookies/${cookie.id}`, { method: 'DELETE' });
        } catch (e) { }
    }

    state.chapters.forEach(ch => { if (ch.assignedCookie === index) ch.assignedCookie = null; if (ch.assignedCookie > index) ch.assignedCookie--; });
    state.cookies.splice(index, 1);
    saveState(); renderCookies(); updateSidebarStats();
    showToast('Cookie deleted', 'warning');
}

async function verifyCookie(index) {
    const cookie = state.cookies[index];
    if (!cookie) return;

    if (!state.browserReady) {
        showToast('Start the engine first to verify cookies!', 'warning');
        return;
    }

    showToast(`Verifying ${cookie.label}...`, 'info');

    try {
        const resp = await fetch(`${API_BASE}/cookies/validate/${cookie.id}`, { method: 'POST' });
        const data = await resp.json();
        cookie.status = data.success ? 'valid' : 'invalid';
        saveState(); renderCookies();
        showToast(data.message || 'Verification finished', data.success ? 'success' : 'error');
    } catch (e) {
        showToast('Server crash: Is the script fully running? Wait a few seconds to let Playwright download.', 'error');
    }
}

// ===== CHAPTER ACTIONS (REAL) =====
async function startChapter() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    if (!chapter.selectedModel) { showToast('Select a model first!', 'warning'); return; }
    if (chapter.assignedCookie === null) { showToast('Assign a login cookie first!', 'warning'); return; }
    if (chapter.prompts.length === 0) { showToast('No prompts to process!', 'warning'); return; }

    if (!state.browserReady) {
        showToast('Start the engine first! Click the engine button.', 'warning');
        return;
    }

    const cookie = state.cookies[chapter.assignedCookie];
    if (!cookie) { showToast('Invalid cookie assignment!', 'error'); return; }

    // Get only pending prompts
    const promptTexts = chapter.prompts
        .filter(p => p.status === 'pending' || p.status === 'retry')
        .map(p => p.text);

    if (promptTexts.length === 0) {
        showToast('All prompts are already completed!', 'info');
        return;
    }

    showToast(`Starting ${chapter.name} with ${promptTexts.length} prompts...`, 'info');

    try {
        const resp = await fetch(`${API_BASE}/chapter/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: String(chapter.id),
                name: chapter.name,
                prompts: chapter.prompts.map(p => ({ text: p.text, status: p.status })),
                cookie_id: cookie.id,
                cookie_value: cookie.value,
                max_retries: state.settings.maxRetry,
                wait_between: state.settings.waitTime,
                model_url: chapter.selectedModel,
            })
        });
        const data = await resp.json();

        if (data.success) {
            chapter.status = 'running';
            state.isRunning = true;
            saveState(); renderChapterDetail();
            showToast(`${chapter.name} started! Watch Live Tracking for progress.`, 'success');
            startChapterPolling();
        } else {
            showToast(data.message || 'Failed to start', 'error');
        }
    } catch (e) {
        showToast('Server error! Make sure backend is running.', 'error');
    }
}

async function pauseChapter() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;

    try {
        await fetch(`${API_BASE}/chapter/${chapter.id}/pause`, { method: 'POST' });
        chapter.status = 'paused'; saveState(); renderChapterDetail();
        showToast(`${chapter.name} paused`, 'warning');
    } catch (e) {
        showToast('Failed to pause', 'error');
    }
}

async function startAllChapters() {
    const ready = state.chapters.filter(ch => ch.selectedModel && ch.assignedCookie !== null && ch.prompts.length > 0);
    if (ready.length === 0) { showToast('No chapters ready! Set model + cookie + prompts first.', 'warning'); return; }
    if (!state.browserReady) { showToast('Start the engine first!', 'warning'); return; }

    showToast(`Starting ${ready.length} chapters sequentially...`, 'info');

    for (const chapter of ready) {
        const cookie = state.cookies[chapter.assignedCookie];
        if (!cookie) continue;

        try {
            await fetch(`${API_BASE}/chapter/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: String(chapter.id),
                    name: chapter.name,
                    prompts: chapter.prompts.map(p => ({ text: p.text, status: p.status })),
                    cookie_id: cookie.id,
                    cookie_value: cookie.value,
                    max_retries: state.settings.maxRetry,
                    wait_between: state.settings.waitTime,
                    model_url: chapter.selectedModel,
                })
            });
            chapter.status = 'running';
        } catch (e) { }
    }

    state.isRunning = true;
    saveState(); renderDashboard();
    startChapterPolling();
}

function viewChapterImages(chDir) {
    window.open(`${API_BASE}/images/${chDir}`, '_blank');
}

// ===== DOWNLOADS =====
function downloadChapterZip(index) {
    showToast(`Preparing ZIP for ${state.chapters[index]?.name}...`, 'info');
}
function downloadAllZip() {
    showToast('Preparing all chapters ZIP...', 'info');
}

// ===== HELPERS =====
function getChapterStats(ch) {
    const s = { success: 0, failed: 0, pending: 0, retry: 0, running: 0 };
    ch.prompts.forEach(p => { if (s[p.status] !== undefined) s[p.status]++; });
    return s;
}
function getChapterProgress(ch) {
    return ch.prompts.length === 0 ? 0 : Math.round((ch.prompts.filter(p => p.status === 'success').length / ch.prompts.length) * 100);
}
function getTotalStats() {
    const t = { success: 0, failed: 0, pending: 0, retry: 0, running: 0, total: 0 };
    state.chapters.forEach(ch => { const s = getChapterStats(ch); Object.keys(s).forEach(k => t[k] += s[k]); t.total += ch.prompts.length; });
    return t;
}
function getUsedModelsCount() { return new Set(state.chapters.filter(c => c.selectedModel).map(c => c.selectedModel)).size; }
function getStatusLabel(ch) {
    return { pending: 'Pending', running: 'Running', paused: 'Paused', done: 'Done', error: 'Error' }[ch.status] || 'Pending';
}
function getStatusClass(ch) {
    return { pending: 'status-pending', running: 'status-running', paused: 'status-pending', done: 'status-done', error: 'status-error' }[ch.status] || 'status-pending';
}
function updateSidebarStats() {
    const t = getTotalStats();
    document.getElementById('totalChapters').textContent = state.chapters.length;
    document.getElementById('totalPrompts').textContent = t.total;
    document.getElementById('totalDone').textContent = t.success;
}

function formatTime(seconds) {
    if (!seconds || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return `${h}h ${rm}m ${s}s`;
    }
    return `${m}m ${s}s`;
}

// ===== ACTIVITY LOG =====
function addActivityLog(type, message) {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    state.activityLog.push({ type, message, time, timestamp: now.getTime() / 1000 });
    if (state.activityLog.length > 200) state.activityLog = state.activityLog.slice(-200);
    if (state.currentPage === 'tracking') renderTracking();
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(o => { o.addEventListener('click', e => { if (e.target === o) o.classList.remove('active'); }); });

// ===== TOAST =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconMap = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
    toast.innerHTML = `${icon(iconMap[type] || 'info', 'icon-sm')}<span>${message}</span>`;
    container.appendChild(toast);
    refreshIcons();
    setTimeout(() => { toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 300); }, 3500);
}

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && document.activeElement.id === 'newPromptInput') { e.preventDefault(); addPrompt(); }
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        if (e.ctrlKey && e.key === 'd') { e.preventDefault(); showPage('dashboard'); }
    });
}

// ===== SETTINGS AUTO-SAVE =====
document.addEventListener('change', e => {
    if (e.target.id === 'waitTime') state.settings.waitTime = parseInt(e.target.value);
    if (e.target.id === 'autoRetry') state.settings.autoRetry = e.target.checked;
    if (e.target.id === 'maxRetry') state.settings.maxRetry = parseInt(e.target.value);
    if (e.target.id === 'namingPattern') state.settings.namingPattern = e.target.value;
    saveState();
});
