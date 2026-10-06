// =============================================================================
// PROJECT: F.R.I.D.A. Timer
// FILE: script.js
// PURPOSE: Main application logic for the F.R.I.D.A. Timer
// AUTHOR: Ingo Barke and various local coding agents
// VERSION: V1.70
// =============================================================================

// =============================================================================
// DEBUG CONFIGURATION
// =============================================================================
// Set to true to enable debug logging, false to disable all console output
const DEBUG_ENABLED = false;

// Debug log levels for filtering in DevTools
const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// =============================================================================

// =============================================================================

// ============================================
// DEBUG UTILITY FUNCTIONS
// ============================================
function debugLog(category, level, message, data = null) {
    if (!DEBUG_ENABLED) return;
    
    const levelNames = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${category}] [${levelNames[level]}]`;
    
    if (data !== null) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

function debugError(category, message, error = null) {
    debugLog(category, LOG_LEVELS.ERROR, message, error);
}

function debugWarn(category, message, data = null) {
    debugLog(category, LOG_LEVELS.WARN, message, data);
}

function debugInfo(category, message, data = null) {
    debugLog(category, LOG_LEVELS.INFO, message, data);
}

function debugDebug(category, message, data = null) {
    debugLog(category, LOG_LEVELS.DEBUG, message, data);
}

// State inspection helper for troubleshooting

// ============================================
// APPLICATION CONSTANTS
// ============================================
// Delay values in milliseconds
const CLICKER_DELAY_MS = 200;
const SECTION_CHANGE_DELAY_MS = 100;
const TIMER_UPDATE_INTERVAL_MS = 100;

// UI string literals (German)
const UI_STRINGS = {
    APP_TITLE: 'F.R.I.D.A. Timer',
    SELECT_MODULE: 'Wähle eine Übung',
    SELECT_SESSION: 'Trainingseinheit auswählen',
    SECTION_COUNT: 'Abschnitte',
    APPROX_DURATION: '~',
    BACK: 'Zurück',
    START: 'Start',
    PAUSE: 'Pause',
    RESUME: 'Weiter',
    RESTART: 'Wiederholen',
    STOP: 'Stop',
    PROGRESS: 'Fortschritt',
    TIMELINE_TITLE: 'Zeitplan',
    TIMELINE_RANGE_SUFFIX: ' - ',
    TIMELINE_DURATION_PREFIX: '~',
    SESSION_COMPLETE: 'Training abgeschlossen',
    KEKS: 'KEKS!',
    FERTIG: 'FERTIG!',
    ERROR_LOADING: 'Fehler beim Laden der Einheiten. Stellen Sie sicher, dass ein lokaler Server lauft.',
    BACK_TO_MODULES: '← Zurück zu Übungen'
};


// ============================================
// MAIN APPLICATION (inside DOMContentLoaded)
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Debug: Log all URL parameters on startup
    const allParams = new URLSearchParams(window.location.search);
    debugDebug('App', 'All URL params:', Object.fromEntries(allParams.entries()));
    debugDebug('App', 'DEMO_MODE:', 'N/A');
    
    debugInfo('App', 'Initializing application');
    
    // =============================================================================
    
    // Parse configuration safely at startup
    const TEST_MODE_CONFIG = false;
    
    // DOM Elements
    const moduleSelectionView = document.getElementById('module-selection-view');
    const selectionView = document.getElementById('selection-view');
    const runningView = document.getElementById('running-view');
    

    // Fallback: if no password protection, show module selection directly
    if (!document.getElementById('password-screen')) {
        moduleSelectionView.classList.remove('hidden');
        selectionView.classList.add('hidden');
    }
    const moduleList = document.getElementById('module-list');
    const sessionList = document.getElementById('session-list');
    const countdownElement = document.getElementById('countdown');
    const messageElement = document.getElementById('message');
    // Remove 'show' class when CSS animation ends so next add('show') re-triggers the animation
    messageElement.addEventListener('animationend', () => {
        messageElement.classList.remove('show');
    });
    const timelineContainer = document.getElementById('timeline');
    const progressBarContainer = document.querySelector('.progress-bar');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');

    // Create progress bar fill element
    let progressFill;
    if (progressBarContainer) {
        progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        progressBarContainer.appendChild(progressFill);
    }

    // State - hierarchical structure with modules containing sessions
    let modules = [];  // Array of module objects with sessions nested inside
    let currentModule = null;  // Currently selected module (for navigation)
    let currentSession = null;  // Currently selected session for timer execution

    // Timer state - grouped for clarity
    // Timing model: precomputed-sequence driven (V1.27)
    // - Random times are pre-calculated per section using greedy algorithm
    // - completedDuration tracks sum of completed interval durations (precomputed values)
    // - Progress = (completedDuration + currentIntervalElapsed) / totalPrecomputedDuration
    // - Section completion: queue exhaustion (sectionRandomTimes.length === 0)
    const timerState = {
        currentSectionIndex: 0,
        currentRandomTime: 0,
        sectionStartTime: 0,
        timerInterval: null,
        isPaused: false,
        isTimerRunning: false,
        sectionRandomTimes: [],
        completedDuration: 0,
        totalPrecomputedDuration: 0,
        elapsedOnPause: 0,
        // Transition section state variables
        isTransitionSection: false,
        transitionText: "",
        waitingForUserAcknowledge: false
    };

    // Track the module context when session starts (for proper navigation)
    let activeModuleId = null;


    // Audio context - created once and reused to prevent resource leaks
    // Initialized on first user interaction to comply with autoplay policies
    let audioCtx = null;

    /**
     * Initializes the AudioContext on user interaction.
     * Must be called from a user gesture (e.g., button click) to comply with autoplay policies.
     * After first call, subsequent calls return immediately.
     */
    function initAudioContext() {
        if (audioCtx) return;
        
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            debugInfo('Audio', 'Created new AudioContext on user interaction');
            
            // Ensure context is running (some browsers start suspended)
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
                debugInfo('Audio', 'Resumed suspended AudioContext');
            }
        } catch (error) {
            debugError('Audio', 'Failed to create AudioContext', error);
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Helper to check if a section is a transition type
    function isTransitionSection(section) {
        return section && section.type === "transition";
    }

    // Count only timer sections (excluding transitions) for display
    function countTimerSections(sections) {
        if (!sections || !Array.isArray(sections)) return 0;
        return sections.filter(section => !isTransitionSection(section)).length;
    }

// Display transition section message and wait for user acknowledgment
    function displayTransitionSection() {
        const section = currentSession.sections[timerState.currentSectionIndex];
        if (!section || !isTransitionSection(section)) return;
        
        debugInfo('Timer', `Entering transition section: ${section.text}`);
        
        // Set state flags for transition mode
        timerState.isTransitionSection = true;
        timerState.transitionText = section.text;
        timerState.waitingForUserAcknowledge = true;
        
        // Clear random times queue and section ref to ensure fresh generation after transition
        timerState.sectionRandomTimes = [];
        timerState.totalPrecomputedDuration = 0;
        
        // Hide KEKS! message if visible
        const msgEl = document.getElementById('message');
        if (msgEl) {
            msgEl.classList.remove('show');
        }
        
        // Get or create the transition message element that will replace countdown display
        let transitionMessageEl = document.getElementById('transition-message');
        if (!transitionMessageEl) {
            transitionMessageEl = document.createElement('div');
            transitionMessageEl.id = 'transition-message';
            transitionMessageEl.className = 'transition-message';
            
            // Insert inside timer-container, replacing countdown position
            const timerContainer = document.querySelector('.timer-container');
            if (timerContainer) {
                // Remove any existing transition message first
                const existing = timerContainer.querySelector('.transition-message');
                if (existing) existing.remove();
                
                // Add after countdown element within same container
                const countdownEl = document.getElementById('countdown');
                if (countdownEl) {
                    countdownEl.parentNode.insertBefore(transitionMessageEl, countdownEl.nextSibling);
                } else {
                    timerContainer.appendChild(transitionMessageEl);
                }
            }
        }
        
        // Set message text and handle long text with scroll support
        transitionMessageEl.textContent = section.text;
        transitionMessageEl.classList.remove('scrollable');
        
        // Check if text is too long or complex - add scroll support if needed
        const needsScroll = section.text.length > 100 || 
                            section.text.includes('\n') ||
                            transitionMessageEl.offsetHeight < transitionMessageEl.scrollHeight;
        
        if (needsScroll) {
            transitionMessageEl.classList.add('scrollable');
        }
        
        // Hide countdown element during transition
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.style.display = 'none';
        }
        
        // Add class to timer-panel to hide progress bar via CSS
        const timerPanel = document.querySelector('.timer-panel');
        if (timerPanel) {
            timerPanel.classList.add('transition-mode');
        }
        
        // Show "Weiter" button on pauseBtn for acknowledgment with visual feedback
        const pauseBtnEl = document.getElementById('pause-btn');
        if (pauseBtnEl) {
            pauseBtnEl.textContent = UI_STRINGS.RESUME;  // "Weiter"
            pauseBtnEl.disabled = false;
            pauseBtnEl.classList.add('transition-active');
        }
        
        // Update progress bar to show transition section is active
        updateProgress();  // No elapsed time during transition
        
        debugInfo('Timer', 'Transition section displayed, waiting for user acknowledgment');
    }

    // Handle user pressing "Weiter" button after transition
    function proceedFromTransition() {
        if (!timerState.isTransitionSection || !timerState.waitingForUserAcknowledge) return;
        
        debugInfo('Timer', 'User acknowledged transition section');
        
        // Clear transition state flags
        timerState.isTransitionSection = false;
        timerState.waitingForUserAcknowledge = false;
        timerState.transitionText = "";
        
        // Remove transition message element and show countdown again
        const transitionMessageEl = document.getElementById('transition-message');
        if (transitionMessageEl) {
            transitionMessageEl.remove();
        }
        
        // Show countdown element again
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.style.display = '';  // Use empty string to restore CSS default
        }
        
        // Remove visual feedback from button
        const pauseBtnEl = document.getElementById('pause-btn');
        if (pauseBtnEl) {
            pauseBtnEl.classList.remove('transition-active');
            pauseBtnEl.textContent = UI_STRINGS.PAUSE;  // Reset to "Pause" after transition
        }
        
        // Remove transition-mode class from timer panel to restore progress bar visibility
        const timerPanel = document.querySelector('.timer-panel');
        if (timerPanel) {
            timerPanel.classList.remove('transition-mode');
        }
        
        // Move to next section
        timerState.currentSectionIndex++;
        
        debugInfo('Timer', `Moved to next section: ${timerState.currentSectionIndex + 1}`);
        
        // Start the next section (should be a regular timer section)
        startNextRandomTimer();
    }

    async function loadSessions() {
        try {
            debugInfo('Session', 'Loading sessions from server');
            
            // Determine which data file to load based on test mode config
            let dataFile;
            // Production mode (default)
            dataFile = './sessions.json';
            debugInfo('Session', 'Loading production sessions');
            
            const response = await fetch(dataFile);
            if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to load sessions`);
            const data = await response.json();
            
            // Load modules structure (new hierarchical format)
            modules = data.modules || [];
            
            debugInfo('Session', `Loaded ${modules.length} module(s) with sessions`, { 
                moduleTitles: modules.map(m => m.title),
                totalSessions: modules.reduce((sum, m) => sum + m.sessions.length, 0)
            });
            
            // Show module selection view first
            renderModuleButtons();
            
            // Update heading for module selection
            const moduleHeading = moduleList.parentElement.querySelector('h2');
            if (moduleHeading) {
                moduleHeading.textContent = UI_STRINGS.SELECT_MODULE;
            }
        } catch (error) {
            debugError('Session', 'Failed to load sessions', error);
            moduleList.innerHTML = `<p style="color: white; text-align: center;">${UI_STRINGS.ERROR_LOADING}</p>`;
        }
    }

    /**
     * Renders the list of modules for selection.
     * Displays only module titles (no IDs or session details).
     */
    function renderModuleButtons() {
        debugInfo('Session', 'Rendering module buttons');
        moduleList.innerHTML = '';
        
        if (modules.length === 0) {
            moduleList.innerHTML = '<p style="color: white; text-align: center;">Keine Module gefunden</p>';
            return;
        }

        modules.forEach((module) => {
            const btn = document.createElement('button');
            btn.className = 'session-btn';
            btn.innerHTML = `
                <div class="session-info">
                    <span class="session-name">${module.title}</span>
                    <span class="section-count">${module.sessions.length} Einheiten</span>
                </div>
            `;
            
            btn.addEventListener('click', () => {
                debugInfo('Session', `User selected module: ${module.title}`, { 
                    sessionIdCount: module.sessions.length,
                    sessionIds: module.sessions.map(s => s.id)
                });
                
                // Store selected module and show its sessions
                currentModule = module;
                showSessionSelection();
            });
            
            moduleList.appendChild(btn);
        });
    }

    /**
     * Shows the session selection view for a specific module.
     */
    function showSessionSelection() {
        debugInfo('UI', 'Showing session selection for module');
        
        // Hide module list, show session list
        moduleList.parentElement.classList.add('hidden');
        selectionView.classList.remove('hidden');
        
        renderSessionButtons(currentModule.sessions);
    }

    /**
     * Shows the module selection view (back navigation).
     */
    function showModuleSelection() {
        debugInfo('UI', 'Showing module selection');
        
        // Hide session list, show module list
        selectionView.classList.add('hidden');
        moduleList.parentElement.classList.remove('hidden');
        
        // Clear current module when going back
        currentModule = null;
    }

    function renderSessionButtons(sessions) {
        debugInfo('UI', 'Rendering session buttons', { count: sessions.length });
        sessionList.innerHTML = '';
        
        // Add back button to return to module selection
        const backButton = document.createElement('button');
        backButton.className = 'session-btn';
        backButton.style.width = '100%';
        backButton.style.marginBottom = '20px';
        backButton.innerHTML = `
            <div class="session-info">
                <span class="session-name">${UI_STRINGS.BACK_TO_MODULES}</span>
            </div>
        `;
        backButton.addEventListener('click', () => {
            debugInfo('UI', 'User clicked back to module selection');
            showModuleSelection();
        });
        sessionList.appendChild(backButton);

        sessions.forEach((session) => {
            const btn = document.createElement('button');
            btn.className = 'session-btn';
            btn.innerHTML = `
                <div class="session-info">
                    <span class="session-name">${session.name}</span>
                    <span class="section-count">${countTimerSections(session.sections)} ${UI_STRINGS.SECTION_COUNT}</span>
                </div>
                <span class="session-duration">${UI_STRINGS.APPROX_DURATION}${session.approxDuration}</span>
            `;
            btn.addEventListener('click', () => {
                debugInfo('Session', `User selected session: ${session.name}`, { 
                    sections: countTimerSections(session.sections),
                    duration: session.approxDuration,
                    totalSectionsInConfig: session.sections.length
                });
                startSession(session);
            });
            sessionList.appendChild(btn);
        });
    }

    function startSession(session) {
        debugInfo('Session', `Starting session: ${session.name}`, { 
            totalSections: countTimerSections(session.sections),
            totalSectionsInConfig: session.sections.length,
            approxDuration: session.approxDuration
        });
        
        currentSession = session;
        // Track the active module for proper navigation when pressing "Zurück"
        if (currentModule) {
            activeModuleId = currentModule.id;
            debugInfo('Session', `Tracking active module: ${activeModuleId}`);
        }
        timerState.currentSectionIndex = 0;
        timerState.completedDuration = 0;
        timerState.sectionRandomTimes = [];
        timerState.totalPrecomputedDuration = 0;
        timerState.isTimerRunning = false;
        
        // Reset transition section state to ensure countdown appears properly
        timerState.isTransitionSection = false;
        timerState.waitingForUserAcknowledge = false;
        timerState.transitionText = "";

        // Hide both selection views, show running view
        moduleSelectionView.classList.add('hidden');
        selectionView.classList.add('hidden');
        runningView.classList.remove('hidden');

        // Reset button texts for pre-start state
        stopBtn.textContent = UI_STRINGS.BACK;
        pauseBtn.textContent = UI_STRINGS.START;

        const progressLabel = document.getElementById('section-progress-label');
        if (progressLabel) {
            progressLabel.textContent = `${UI_STRINGS.PROGRESS}: 0%`;
        }

        renderTimeline();

        // Clean up any leftover transition message from previous session
        const existingTransitionMsg = document.getElementById('transition-message');
        if (existingTransitionMsg) {
            existingTransitionMsg.remove();
        }

        // Pre-calculate random times for the first section and display initial time
        const firstSection = currentSession.sections[0];
        const { randomTimes, totalPrecomputedDuration } = calculateSectionRandomTimes(firstSection);
        timerState.sectionRandomTimes = randomTimes;
        timerState.totalPrecomputedDuration = totalPrecomputedDuration;

        debugInfo('Timer', `Pre-calculated section 1 random times`, { 
            count: randomTimes.length,
            totalPrecomputedDuration: totalPrecomputedDuration,
            firstTime: randomTimes[0],
            remainingTimes: randomTimes.slice(1)
        });

        // Display the first random time without starting the countdown
        if (timerState.sectionRandomTimes.length > 0) {
            const firstRandomTime = timerState.sectionRandomTimes.shift();
            timerState.currentRandomTime = firstRandomTime;
            
            // Ensure countdown is visible before displaying time
            countdownElement.style.display = '';
            countdownElement.textContent = formatTime(firstRandomTime);
            
            debugInfo('Timer', `Initial time displayed: ${firstRandomTime}s`, { 
                sectionIndex: 0,
                isRunning: false
            });
        }

        // Ensure progress bar is visible before resetting it
        const progressBarContainer = document.querySelector('.progress-container');
        if (progressBarContainer) {
            progressBarContainer.style.display = '';  // Remove inline style to use CSS default
        }

        // Reset progress bar instantly
        resetProgressInstant();
    }

    function stopSession() {
        debugInfo('Session', 'Stopping session', { 
            sectionIndex: timerState.currentSectionIndex,
            completedDuration: timerState.completedDuration,
            activeModuleId: activeModuleId
        });
        
        if (timerState.timerInterval) clearInterval(timerState.timerInterval);
        timerState.timerInterval = null;
        timerState.isPaused = false;
        timerState.isTimerRunning = false;

        // Close AudioContext to release resources
        if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close();
            audioCtx = null;
        }

        // Return to module selection instead of reloading page
        currentSession = null;
        timerState.currentSectionIndex = 0;
        timerState.completedDuration = 0;
        timerState.sectionRandomTimes = [];
        timerState.totalPrecomputedDuration = 0;
        
        // Reset transition section state and remove any visible transition message
        timerState.isTransitionSection = false;
        timerState.waitingForUserAcknowledge = false;
        timerState.transitionText = "";
        
        const transitionMessageEl = document.getElementById('transition-message');
        if (transitionMessageEl) {
            transitionMessageEl.remove();
        }
        
        // Remove transition mode class from timer-panel to restore normal layout
        const timerPanel = document.querySelector('.timer-panel');
        if (timerPanel) {
            timerPanel.classList.remove('transition-mode');
        }
        
        // Ensure countdown is visible after stopping from transition
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.style.display = '';  // Use empty string to restore CSS default
        }
        
        // Ensure progress bar container is visible after stopping from transition
        const progressBarContainer = document.querySelector('.progress-container');
        if (progressBarContainer) {
            progressBarContainer.style.display = '';  // Remove inline style to use CSS default
        }

        runningView.classList.add('hidden');
        
        // Navigate to session selection if we have an active module, otherwise go to module list
        if (activeModuleId) {
            debugInfo('Session', `Returning to session selection for module ${activeModuleId}`);
            
            // Find the module and show its sessions
            const module = modules.find(m => m.id === activeModuleId);
            if (module) {
                currentModule = module;
                showSessionSelection();
            } else {
                debugWarn('Session', `Active module ${activeModuleId} not found, falling back to module selection`);
                showModuleSelection();
            }
        } else {
            // No active module context - go to module selection
            showModuleSelection();
        }
        
        debugInfo('Session', 'Navigation completed');
    }

    // ============================================
    // TIMER CORE FUNCTIONS
    // ============================================

    /**
     * Creates and starts a timer interval that counts down from the current random time.
     * Uses Date.now() only for the current interval's countdown display.
     * 
     * @param {number} randomTime - The initial countdown time in seconds
     */
    function createTimerInterval(randomTime) {
        timerState.timerInterval = setInterval(() => {
            if (!timerState.isPaused) {
                const elapsed = (Date.now() - timerState.sectionStartTime) / 1000;
                const remainingTimeRaw = randomTime - elapsed;

                if (remainingTimeRaw <= 0) {
                    clearInterval(timerState.timerInterval);
                    timerState.timerInterval = null;

                    // Handle countdown completion
                    handleCountdownComplete();
                } else {
                    // Use ceil() for display to match pre-pause value (e.g., 3.1s remaining shows "04")
                    const displaySeconds = Math.ceil(remainingTimeRaw);
                    countdownElement.textContent = formatTime(Math.max(0, displaySeconds));
                    updateProgress();
                }
            }
        }, TIMER_UPDATE_INTERVAL_MS);
    }

    /**
     * Handles the completion of a countdown interval.
     * Adds the precomputed duration of the completed interval to completedDuration,
     * plays the clicker sound, shows the KEKS! message, and either
     * starts the next random timer or finishes the current section.
     * Section completion is driven by queue exhaustion (no time-based checks).
     */
    function handleCountdownComplete() {
        const section = currentSession.sections[timerState.currentSectionIndex];
        if (!section) return;

        // Add the precomputed duration of the completed interval
        timerState.completedDuration += timerState.currentRandomTime;


        // Play click sound and show KEKS! message when countdown reaches zero
        playClickerSound();
        messageElement.textContent = UI_STRINGS.KEKS;
        messageElement.classList.add('show');

        debugInfo('Timer', `Countdown complete: ${timerState.completedDuration.toFixed(2)}s completed`, { 
            completedDuration: timerState.completedDuration,
            totalPrecomputedDuration: timerState.totalPrecomputedDuration
        });

        // Section completion driven by queue exhaustion
        if (timerState.sectionRandomTimes.length === 0) {
            finishCurrentSection();
        } else {
            startNextRandomTimer();
        }
    }

    /**
     * Starts or resumes the timer from its current state.
     * Handles three scenarios:
     * 1. Starting from pre-start state (first Start button press)
     * 2. Resuming from pause (Weiter button)
     * 3. Restart after session complete (Wiederholen button)
     */
    function pauseResumeSession() {
        // Handle Restart button when session is complete
        if (pauseBtn.textContent === UI_STRINGS.RESTART) {
            debugInfo('UI', 'User clicked Restart');
            startSession(currentSession);
            return;
        }

        // Start the timer from pre-start state
        if (!timerState.isTimerRunning) {
            debugInfo('Timer', 'Starting countdown from pre-start state', { 
                currentTime: timerState.currentRandomTime,
                sectionIndex: timerState.currentSectionIndex
            });
            
            timerState.isTimerRunning = true;
            pauseBtn.textContent = UI_STRINGS.PAUSE;
            
            initAudioContext();

            // Reset completed duration for new run (should already be 0)
            timerState.completedDuration = 0;
            timerState.sectionStartTime = Date.now();

            debugInfo('Timer', `Interval started: ${timerState.currentRandomTime}s`, { 
                startTime: timerState.sectionStartTime
            });

            createTimerInterval(timerState.currentRandomTime);
            return;
        }

        // Guard: prevent multiple consecutive pauses without resume
        if (timerState.isPaused && timerState.timerInterval) {
            debugWarn('Timer', 'Already paused, ignoring pause request');
            return;
        }

        if (timerState.isPaused) {
            // Resume
            debugInfo('Timer', `Resuming from ${timerState.elapsedOnPause}s elapsed`);
            
            timerState.isPaused = false;
            pauseBtn.textContent = UI_STRINGS.PAUSE;

            // Restore sectionStartTime so elapsed time reflects the pause gap
            timerState.sectionStartTime = Date.now() - timerState.elapsedOnPause * 1000;

            debugInfo('Timer', `Resume interval started: ${timerState.currentRandomTime}s`);

            createTimerInterval(timerState.currentRandomTime);
        } else {
            // Pause
            debugInfo('Timer', 'Pausing timer');
            
            timerState.isPaused = true;
            pauseBtn.textContent = UI_STRINGS.RESUME;

            // Save elapsed time of the current interval at pause moment
            timerState.elapsedOnPause = (Date.now() - timerState.sectionStartTime) / 1000;

            debugInfo('Timer', `Paused at ${timerState.elapsedOnPause}s elapsed`, { 
                totalSectionElapsed: timerState.sectionElapsedTotal
            });

            clearInterval(timerState.timerInterval);
            timerState.timerInterval = null;
        }
    }

    function playClickerSound() {
        try {
            // Ensure AudioContext exists and is running
            if (!audioCtx) {
                debugWarn('Audio', 'AudioContext not initialized, skipping sound');
                return;
            }

            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
                debugDebug('Audio', 'Resumed suspended AudioContext');
            }

            // Create short noise burst for "click" sound
            function playClick(time, frequency) {
                const bufferSize = audioCtx.sampleRate * 0.015;  // 15ms buffer
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);

                // Generate white noise with sharp attack and quick decay
                for (let i = 0; i < bufferSize; i++) {
                    const envelope = Math.exp(-i / (bufferSize * 0.3));  // Quick exponential decay
                    data[i] = (Math.random() * 2 - 1) * envelope;
                }

                const noise = audioCtx.createBufferSource();
                noise.buffer = buffer;

                const gainNode = audioCtx.createGain();
                gainNode.gain.setValueAtTime(frequency, time);
                gainNode.connect(audioCtx.destination);
                noise.connect(gainNode);
                noise.start(time);
            }

            // First click - sharper, higher amplitude
            playClick(0, 0.8);

            // Second "clack" - slightly lower/lower amplitude after longer gap
            setTimeout(() => {
                playClick(0, 0.55);
            }, CLICKER_DELAY_MS);
            
            debugDebug('Audio', 'Played clicker sound');
        } catch (error) {
            debugError('Audio', 'Failed to play sound', error);
        }
    }

    function calculateSectionRandomTimes(section) {
        const randomTimes = [];
        let totalDuration = 0;

        while (totalDuration < section.sectionDuration) {
            const randomTime = Math.floor(Math.random() * (section.max - section.min + 1)) + section.min;
            randomTimes.push(randomTime);
            totalDuration += randomTime;
        }

        debugDebug('Session', `Calculated ${randomTimes.length} random times for section`, { 
            min: section.min,
            max: section.max,
            sectionDuration: section.sectionDuration,  // lower limit for greedy generator
            totalPrecomputedDuration: totalDuration,
            times: randomTimes
        });

        return { randomTimes, totalPrecomputedDuration: totalDuration };
    }

    function startNextRandomTimer() {
        if (!currentSession) return;

        // Guard: don't start new timer if session is complete
        const totalSections = currentSession.sections.length;
        if (timerState.currentSectionIndex >= totalSections) {
            debugWarn('Timer', 'Cannot start next timer - session complete');
            return;
        }

        const section = currentSession.sections[timerState.currentSectionIndex];
        if (!section) return;

        // Check if this is a transition section - display message instead of countdown
        if (isTransitionSection(section)) {
            debugInfo('Timer', `Detected transition section at index ${timerState.currentSectionIndex}`);
            displayTransitionSection();
            return;  // Don't start countdown timer for transitions
        }

        // Pre-calculate random times for this section if queue is empty
        // This handles both first section (completedDuration === 0) and sections after transitions
        if (timerState.sectionRandomTimes.length === 0) {
            debugInfo('Timer', `Pre-calculating random times for section ${timerState.currentSectionIndex + 1}`);
            const { randomTimes, totalPrecomputedDuration } = calculateSectionRandomTimes(section);
            timerState.sectionRandomTimes = randomTimes;
            timerState.totalPrecomputedDuration = totalPrecomputedDuration;
        }

        // Get next pre-calculated random time
        const nextRandomTime = timerState.sectionRandomTimes.shift();
        timerState.currentRandomTime = nextRandomTime;
        countdownElement.textContent = formatTime(timerState.currentRandomTime);
        timerState.sectionStartTime = Date.now();

        if (timerState.timerInterval) clearInterval(timerState.timerInterval);

        debugInfo('Timer', `Starting new interval: ${nextRandomTime}s`, { 
            sectionIndex: timerState.currentSectionIndex,
            completedDuration: timerState.completedDuration
        });

        createTimerInterval(nextRandomTime);
    }

    function finishCurrentSection() {
        // Guard: prevent double-call when already at or past last section
        if (timerState.currentSectionIndex >= currentSession.sections.length) {
            debugWarn('Session', 'finishCurrentSection called but already at/past last section');
            return;
        }


        debugInfo('Session', `Finishing section ${timerState.currentSectionIndex + 1}`, { 
            completedDuration: timerState.completedDuration,
            totalPrecomputedDuration: timerState.totalPrecomputedDuration
        });

        if (timerState.timerInterval) clearInterval(timerState.timerInterval);
        timerState.timerInterval = null;

        const totalSections = currentSession.sections.length;

        // Mark completed sections in timeline
        for (let i = 0; i <= timerState.currentSectionIndex; i++) {
            const timelineItem = timelineContainer.children[i];
            if (timelineItem) {
                timelineItem.className = 'timeline-item completed';
            }
        }

        // Move to next section
        timerState.currentSectionIndex++;
        timerState.completedDuration = 0;
        timerState.sectionRandomTimes = [];
        timerState.totalPrecomputedDuration = 0;

        if (timerState.currentSectionIndex < totalSections) {
            debugInfo('Session', `Moving to section ${timerState.currentSectionIndex + 1} of ${totalSections}`);
            
            // Reset progress bar instantly before starting next section
            resetProgressInstant();
            
            const progressLabel = document.getElementById('section-progress-label');
            if (progressLabel) {
                progressLabel.textContent = `${UI_STRINGS.PROGRESS}: 0%`;
            }
            
            // Start next section after brief delay
            setTimeout(() => {
                startNextRandomTimer();
            }, SECTION_CHANGE_DELAY_MS);
        } else {
            // Session complete
            debugInfo('Session', 'Training completed successfully');
            
            // Set progress bar to 100% — the formula (completedDuration + currentIntervalElapsed) / totalPrecomputedDuration
            // is unreliable at this point because completedDuration already includes the last interval
            // and currentIntervalElapsed is still near the full interval duration, causing double-counting.
            if (progressFill) {
                progressFill.style.width = '100%';
            }
            const progressLabel = document.getElementById('section-progress-label');
            if (progressLabel) {
                progressLabel.textContent = `${UI_STRINGS.PROGRESS}: 100%`;
            }
            
            playClickerSound();
            messageElement.textContent = UI_STRINGS.FERTIG;
            messageElement.classList.add('show');
            countdownElement.textContent = UI_STRINGS.FERTIG;
            timelineContainer.innerHTML += `<div class="timeline-item completed" style="background: #a5d6a7; font-weight: bold; color: #0d3b10;">${UI_STRINGS.SESSION_COMPLETE}</div>`;
            stopBtn.textContent = UI_STRINGS.BACK;
            pauseBtn.textContent = UI_STRINGS.RESTART;
        }
    }

    function updateProgress() {
        const section = currentSession.sections[timerState.currentSectionIndex];
        if (!section) return;

        // During transition sections, show "waiting" state instead of percentage
        if (timerState.isTransitionSection && timerState.waitingForUserAcknowledge) {
            debugDebug('UI', 'Updating progress during transition section');
            
            const progressLabel = document.getElementById('section-progress-label');
            if (progressLabel) {
                progressLabel.textContent = `${UI_STRINGS.PROGRESS}: Warte auf Benutzer`;
            }
            
            // Update timeline highlighting for current section
            const timelineItems = Array.from(timelineContainer.children);
            if (timelineItems[timerState.currentSectionIndex]) {
                timelineItems.forEach((item, index) => {
                    if (index < timerState.currentSectionIndex) {
                        item.className = 'timeline-item completed';
                    } else if (index === timerState.currentSectionIndex) {
                        item.className = 'timeline-item current transition-section';
                    } else {
                        item.className = 'timeline-item remaining';
                    }
                });
            }
            
            return;  // Don't update progress bar during transitions
        }

        // Calculate current interval elapsed time (only for the active countdown)
        const currentIntervalElapsed = timerState.sectionStartTime 
            ? (Date.now() - timerState.sectionStartTime) / 1000 
            : 0;

        // Progress = (completedDuration + currentIntervalElapsed) / totalPrecomputedDuration
        const totalProgress = timerState.completedDuration + currentIntervalElapsed;
        const progress = (totalProgress / timerState.totalPrecomputedDuration) * 100;

        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }

        const progressLabel = document.getElementById('section-progress-label');
        if (progressLabel) {
            progressLabel.textContent = `${UI_STRINGS.PROGRESS}: ${Math.round(progress)}%`;
        }

        // Update timeline highlighting
        const timelineItems = Array.from(timelineContainer.children);
        if (timelineItems[timerState.currentSectionIndex]) {
            timelineItems.forEach((item, index) => {
                if (index < timerState.currentSectionIndex) {
                    item.className = 'timeline-item completed';
                } else if (index === timerState.currentSectionIndex) {
                    item.className = 'timeline-item current';
                } else {
                    item.className = 'timeline-item remaining';
                }
            });
        }
        
        debugDebug('UI', `Progress updated: ${Math.round(progress)}%`, { 
            completedDuration: timerState.completedDuration,
            currentIntervalElapsed: currentIntervalElapsed,
            totalPrecomputedDuration: timerState.totalPrecomputedDuration,
            sectionIndex: timerState.currentSectionIndex
        });
    }

    // Helper to instantly reset progress bar (no transition)
    function resetProgressInstant() {
        if (!progressFill) return;
        
        // Temporarily remove transition for instant reset
        const originalTransition = progressFill.style.transition;
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        
        // Force reflow to apply the change immediately
        progressFill.offsetHeight; // trigger reflow
        
        // Restore transition for next increase
        progressFill.style.transition = '';
    }

    function renderTimeline() {
        timelineContainer.innerHTML = '';

        currentSession.sections.forEach((section, index) => {
            const item = document.createElement('div');
            
            // Check if this is a transition section - display "Hinweis" without icons or time info
            if (isTransitionSection(section)) {
                item.className = 'timeline-item remaining transition-section';
                item.innerHTML = `
                    <span class="timeline-range" style="font-style: italic;">Hinweis</span>
                `;
            } else {
                item.className = 'timeline-item remaining';
                item.innerHTML = `
                    <span class="timeline-range">${formatTime(section.min)}${UI_STRINGS.TIMELINE_RANGE_SUFFIX}${formatTime(section.max)}</span>
                    <span class="timeline-duration">${UI_STRINGS.TIMELINE_DURATION_PREFIX}${formatTime(section.sectionDuration)}</span>
                `;
            }
            
            timelineContainer.appendChild(item);
        });

        // Reset progress bar instantly
        resetProgressInstant();

        const progressLabel = document.getElementById('section-progress-label');
        if (progressLabel) {
            progressLabel.textContent = `${UI_STRINGS.PROGRESS}: 0%`;
        }
        
        debugInfo('UI', `Rendered timeline with ${currentSession.sections.length} sections`);
    }

    // Event Listeners
    pauseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Handle transition section acknowledgment first before other actions
        if (timerState.isTransitionSection && timerState.waitingForUserAcknowledge) {
            proceedFromTransition();
            return;
        }
        
        pauseResumeSession();
    });

    stopBtn.addEventListener('click', () => {
        stopSession();
     });



    // Initialize
    loadSessions();
});  // End of DOMContentLoaded
