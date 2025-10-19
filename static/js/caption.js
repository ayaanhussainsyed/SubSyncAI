// Global variables
let transcriptionSegments = [];
let currentHighlightedSegment = null;
let emotionChartInstance = null;
let srtDownloadUrl = ''; // Note: SRT download was removed in the app.py but kept here just in case.
let studyNotesCache = null; // NEW: Cache for study notes
let saveNotesButton = null; // Reference to the save button
let cognitiveMapButton = null; // NEW: Reference to the map button
let saveFeedback = null; // Reference to the feedback div
let semanticSearchButton = null; // Reference to the semantic search button

// EMOTION MAPS (omitted for brevity)
const EMOTION_MAP = {
    'LOVE': 5,
    'JOY': 4,
    'SURPRISE': 3,
    'NEUTRAL': 2,
    'SADNESS': 1,
    'FEAR': 0,
    'ANGER': -1
};
const EMOTION_LABELS = {
    '-1': 'Anger',
    '0': 'Fear',
    '1': 'Sadness',
    '2': 'Neutral',
    '3': 'Surprise',
    '4': 'Joy',
    '5': 'Love'
};
const EMOTION_COLORS = {
    'LOVE': '#ff69b4',
    'JOY': '#ffa500',
    'SURPRISE': '#ffff00',
    'NEUTRAL': '#ccc',
    'SADNESS': '#4682b4',
    'FEAR': '#800080',
    'ANGER': '#ff0000'
};


function formatTime(seconds) {
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(minutes)}:${pad(remainingSeconds)}`; 
}

/**
 * Toggles the UI state (loading, disabled buttons).
 */
 function toggleUI(loading, processing) {
try {
document.getElementById('loading-indicator').style.display = loading ? 'block' : 'none';

const fileSelected = !!document.getElementById('audioFileInput').files[0];

const captionButton = document.getElementById('captionModeButton');
const studyButton = document.getElementById('studyModeButton');
const analyzeButton = document.getElementById('analyzeButton');
const viewStudyButton = document.getElementById('viewStudyButton');
const searchButton = document.getElementById('semanticSearchButton');

const downloadSrtButton = document.getElementById('downloadSrtButton');

// compute transcription state early
const transcriptionDone = Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0;
const studyAvailable = !!studyNotesCache;

// Caption Mode button only requires file to be selected and not processing
if (captionButton) captionButton.disabled = processing || !fileSelected;

// Study Mode requires a file (it will ask for caption if none)
if (studyButton) studyButton.disabled = processing || !fileSelected;

// Action buttons depend on whether transcription or study notes exist
if (analyzeButton) analyzeButton.disabled = processing || !transcriptionDone;
if (viewStudyButton) viewStudyButton.disabled = processing || !studyAvailable;
if (searchButton) searchButton.disabled = processing || !transcriptionDone;
if (downloadSrtButton) downloadSrtButton.disabled = processing || !transcriptionDone;

// Save and Cognitive Map buttons inside modal
if (saveNotesButton) {
    saveNotesButton.disabled = processing || !studyAvailable;
}
if (cognitiveMapButton) {
    cognitiveMapButton.disabled = processing || !studyAvailable;
}

// Hide results while processing/resetting
if (loading && processing) {
    const mediaArea = document.getElementById('media-player-area');
    const transcriptArea = document.getElementById('transcript-area');
    if (mediaArea) {
        mediaArea.style.opacity = '0';
        mediaArea.style.display = 'none';
    }
    if (transcriptArea) {
        transcriptArea.style.opacity = '0';
        transcriptArea.style.display = 'none';
    }
    const fileErr = document.getElementById('file-error-message');
    if (fileErr) fileErr.style.display = 'none';

    const player = document.getElementById('media-player');
    if (player) {
        player.src = '';
        Array.from(player.querySelectorAll('track')).forEach(track => track.remove());
    }

    // Clear state
    transcriptionSegments = [];
    currentHighlightedSegment = null;
    studyNotesCache = null;
}

// After successful initial processing
if (!loading && !processing && transcriptionDone) {
    if (studyButton) studyButton.disabled = false;
    if (downloadSrtButton) downloadSrtButton.disabled = false;
    if (analyzeButton) analyzeButton.disabled = false;
    if (searchButton) searchButton.disabled = false;
}

} catch (err) {
// Fail-safe: log error to console but don't break the rest of the script
console.error('toggleUI error:', err);
}
}

function syncTranscript() {
    // ... (existing logic for transcript synchronization)
    const player = document.getElementById('media-player');
    const currentTime = player.currentTime;
    
    for (let i = 0; i < transcriptionSegments.length; i++) {
        const segment = transcriptionSegments[i];
        if (currentTime >= segment.start && currentTime < segment.end) {
            const segmentElement = document.getElementById(`segment-${i}`);
            
            if (currentHighlightedSegment !== segmentElement) {
                if (currentHighlightedSegment) {
                    currentHighlightedSegment.classList.remove('highlighted-segment');
                    const prevIndex = parseInt(currentHighlightedSegment.id.split('-')[1]);
                    const prevSegment = transcriptionSegments[prevIndex];
                    if (prevSegment && prevSegment.emotion) {
                        currentHighlightedSegment.classList.add(`emotion-${prevSegment.emotion.toUpperCase()}`);
                    }
                }
                
                segmentElement.classList.add('highlighted-segment');
                const currentEmotion = segment.emotion;
                segmentElement.classList.remove(`emotion-${currentEmotion.toUpperCase()}`);
                
                currentHighlightedSegment = segmentElement;
                segmentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return; 
        }
    }

    if (currentHighlightedSegment && (player.paused || currentTime >= player.duration)) {
        currentHighlightedSegment.classList.remove('highlighted-segment');
        const segmentIndex = parseInt(currentHighlightedSegment.id.split('-')[1]);
        const segment = transcriptionSegments[segmentIndex];
        if (segment && segment.emotion) {
            currentHighlightedSegment.classList.add(`emotion-${segment.emotion.toUpperCase()}`);
        }
        currentHighlightedSegment = null;
    }
}

function jumpToTime(timeInSeconds) {
    const player = document.getElementById('media-player');
    if (player && timeInSeconds !== undefined && timeInSeconds !== null) {
        player.currentTime = timeInSeconds;
        player.play();
        
        // For the transcript view to jump to the correct place immediately
        const segmentToHighlight = transcriptionSegments.find(segment => 
            timeInSeconds >= segment.start && timeInSeconds < segment.end
        );
        
        if (segmentToHighlight) {
            const index = transcriptionSegments.indexOf(segmentToHighlight);
            const segmentElement = document.getElementById(`segment-${index}`);
            if (segmentElement) {
                // Manually trigger highlight and scroll if the video update hasn't caught up yet
                if (currentHighlightedSegment) {
                    currentHighlightedSegment.classList.remove('highlighted-segment');
                    const prevIndex = parseInt(currentHighlightedSegment.id.split('-')[1]);
                    const prevSegment = transcriptionSegments[prevIndex];
                    if (prevSegment && prevSegment.emotion) {
                        currentHighlightedSegment.classList.add(`emotion-${prevSegment.emotion.toUpperCase()}`);
                    }
                }
                segmentElement.classList.add('highlighted-segment');
                const currentEmotion = segmentToHighlight.emotion;
                segmentElement.classList.remove(`emotion-${currentEmotion.toUpperCase()}`);
                currentHighlightedSegment = segmentElement;
                segmentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

// Overloaded jumpToTime for transcript segment click compatibility
function jumpToSegment(segmentIndex) {
    const segment = transcriptionSegments[segmentIndex];
    if (segment) {
        jumpToTime(segment.start);
    }
}


// --- NEW: Semantic Search Functions (Existing) ---

/**
 * Opens the semantic search modal.
 */
function openSemanticSearchModal() {
    if (transcriptionSegments.length === 0) {
         // Should be disabled but as a fallback
        alert('Please run Caption Mode first to generate the transcript before searching.');
        return;
    }
    // Clear previous results and input
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResultsArea').innerHTML = '<small class="text-secondary">Click on a result to jump the video to that moment.</small>';
    
    const searchModal = new bootstrap.Modal(document.getElementById('semanticSearchModal'));
    searchModal.show();
}

/**
 * Executes the semantic search logic (simulated with a fetch to backend).
 */
async function executeSemanticSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const resultsArea = document.getElementById('searchResultsArea');
    const searchButton = document.getElementById('executeSearchButton');
    const searchSpinner = document.getElementById('searchSpinner');

    if (query.length < 3) {
        resultsArea.innerHTML = '<p class="text-danger mt-3">Please enter a keyword or phrase of at least 3 characters.</p>';
        return;
    }
    
    // Set loading state
    searchButton.disabled = true;
    searchSpinner.style.display = 'inline';
    resultsArea.innerHTML = '<p class="text-secondary mt-3"><span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Searching for relevance...</p>';

    try {
        // Fetch the search results from the backend
        const response = await fetch('/semantic-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }
        
        // Display results
        displaySearchResults(data.results, resultsArea); 

    } catch (e) {
        console.error('Semantic Search failed:', e);
        resultsArea.innerHTML = `<p class="text-danger mt-3">Search Error: ${e.message}</p>`;

    } finally {
        // Reset loading state
        searchButton.disabled = false;
        searchSpinner.style.display = 'none';
    }
}

/**
 * Populates the search results area in the modal.
 */
function displaySearchResults(results, resultsArea) {
     resultsArea.innerHTML = '';
     
     if (results.length === 0) {
         resultsArea.innerHTML = '<p class="text-info mt-3">No relevant segments found for your query.</p>';
         return;
     }
     
     resultsArea.innerHTML = '<small class="text-secondary">Click on a result to jump the video to that moment.</small><hr style="border-color:#333;">';

     results.forEach(result => {
         const resultElement = document.createElement('div');
         resultElement.className = 'search-result-item';
         
         // Display timestamp and segment text
         const timestamp = formatTime(result.start_time);
         const speakerLabel = result.speaker ? `<strong>${result.speaker}: </strong>` : '';
         const relevanceScore = result.relevance ? ` (${(result.relevance * 100).toFixed(1)}% Match)` : '';
         
         resultElement.innerHTML = `<span class="result-timestamp">[${timestamp}]</span> ${speakerLabel}${result.text}${relevanceScore}`;
         
         // Add click listener to jump video
         resultElement.onclick = () => {
             jumpToTime(result.start_time);
             // Optionally close modal
             const searchModal = bootstrap.Modal.getInstance(document.getElementById('semanticSearchModal'));
             searchModal.hide();
         };
         
         resultsArea.appendChild(resultElement);
     });
}

// --- END: Semantic Search Functions ---


// --- NEW: Study Mode Functions (Existing) ---

/**
 * Triggers the study mode processing on the backend.
 */
async function processStudyMode() {
    if (transcriptionSegments.length === 0) {
         // Trigger the Study Modal to show the error
        const studyModal = new bootstrap.Modal(document.getElementById('studyModal'));
        studyModal.show();
        document.getElementById('studySummaryResult').innerHTML = '<span class="text-danger">Error: Please run "Caption Mode" first to generate the transcript.</span>';
        document.getElementById('studyTagsResult').innerHTML = '';
        if (saveNotesButton) saveNotesButton.disabled = true;
        if (cognitiveMapButton) cognitiveMapButton.disabled = true; // NEW
        return;
    }

    // Show loading feedback in the modal
    const studyModal = new bootstrap.Modal(document.getElementById('studyModal'));
    studyModal.show();
    document.getElementById('studySummaryResult').innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Analyzing video visuals and transcript...';
    document.getElementById('studyTagsResult').innerHTML = '';
    document.getElementById('studyModeButton').disabled = true;
    if (saveNotesButton) saveNotesButton.disabled = true;
    if (cognitiveMapButton) cognitiveMapButton.disabled = true; // NEW
    if (saveFeedback) saveFeedback.innerHTML = '';
    
    // Set default view
    openStudyNotesModal(false); // Open without triggering the modal again

    try {
        const response = await fetch('/process-study-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }
        
        studyNotesCache = data.study_notes;
        displayStudyNotes(studyNotesCache);
        document.getElementById('viewStudyButton').disabled = false;
        if (saveNotesButton) saveNotesButton.disabled = false;
        if (cognitiveMapButton) cognitiveMapButton.disabled = false; // NEW


    } catch (e) {
        console.error('Study Mode failed:', e);
        document.getElementById('studySummaryResult').innerHTML = `<span class="text-danger">Study Mode Error: ${e.message}</span>`;
        document.getElementById('studyTagsResult').innerHTML = '<span class="text-danger">Failed to generate tags.</span>';
        if (saveNotesButton) saveNotesButton.disabled = true;
        if (cognitiveMapButton) cognitiveMapButton.disabled = true; // NEW

    } finally {
        // Re-enable the Study Mode button if processing failed or finished
        if (transcriptionSegments.length > 0) {
             document.getElementById('studyModeButton').disabled = false;
        }
    }
}

/**
 * Opens the study notes modal and populates it.
 */
function openStudyNotesModal(showModal = true) {
     if (!studyNotesCache) {
         document.getElementById('studySummaryResult').innerHTML = '<span class="text-danger">No study notes found. Please click "Study Mode" first.</span>';
         document.getElementById('studyTagsResult').innerHTML = '';
     } else {
         displayStudyNotes(studyNotesCache);
     }
     if (saveFeedback) saveFeedback.innerHTML = '';
     
     // NEW: Ensure default view is summary/tags
     document.getElementById('studyNotesArea').style.display = 'block';
     document.getElementById('cognitiveMapArea').style.display = 'none';

     if (showModal) {
         const studyModal = new bootstrap.Modal(document.getElementById('studyModal'));
         studyModal.show();
     }
}

/**
 * Populates the study notes modal with the results.
 */
function displayStudyNotes(notes) {
    document.getElementById('studySummaryResult').innerText = notes.summary;
    
    const tagsContainer = document.getElementById('studyTagsResult');
    tagsContainer.innerHTML = '';
    notes.tags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag';
        tagElement.innerText = tag;
        tagsContainer.appendChild(tagElement);
    });
    
    // Enable buttons after notes are successfully loaded
    if (saveNotesButton) saveNotesButton.disabled = false;
    if (cognitiveMapButton) cognitiveMapButton.disabled = false; // NEW
}
async function downloadSrtServer(filename = 'transcript.srt') {
if (!transcriptionSegments || transcriptionSegments.length === 0) {
alert('No transcript available. Run Caption Mode first.');
return;
}
try {
const resp = await fetch('/download-srt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: transcriptionSegments, filename })
});
if (!resp.ok) {
    const err = await resp.json().catch(()=>({error:'unknown'}));
    throw new Error(err.error || 'Server error');
}
const blob = await resp.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(url), 1000);
} catch (e) {
console.error('SRT download failed:', e);
alert('SRT download failed: ' + e.message);
}
}

/**
 * Calls the API to save the generated study notes to the database.
 */
async function saveStudyNotes() {
     if (!studyNotesCache) {
         if (saveFeedback) saveFeedback.innerHTML = '<div class="alert alert-danger" role="alert">Error: No notes to save. Run Study Mode first.</div>';
         return;
     }

     if (saveNotesButton) {
         saveNotesButton.disabled = true;
         saveNotesButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Saving & Generating Title...`;
     }
     if (saveFeedback) saveFeedback.innerHTML = '';

     try {
        const response = await fetch('/save-study-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }
        
        // Success feedback
        if (saveFeedback) {
            saveFeedback.innerHTML = `<div class="alert alert-success" role="alert">
                <strong>Saved!</strong> Title: "${data.generated_title}" (ID: ${data.note_id})
            </div>`;
        }


     } catch (e) {
        console.error('Save Notes failed:', e);
        if (saveFeedback) {
            saveFeedback.innerHTML = `<div class="alert alert-danger" role="alert">
                Failed to save notes: ${e.message}
            </div>`;
        }

     } finally {
        if (saveNotesButton) {
            saveNotesButton.disabled = false;
            saveNotesButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-save" viewBox="0 0 16 16">
                    <path d="M.5 1a.5.5 0 0 0 0 1h.5v12a.5.5 0 0 0 1 0V2h12a.5.5 0 0 0 0-1H.5z"/>
                    <path d="M14.5 3a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h13zM14 4H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/>
                </svg>
                Save Notes`;
        }
     }
}

// --- NEW: Cognitive Map Functions ---

/**
 * Switches the modal view to the map and fetches map data.
 */
async function openCognitiveMap() {
    // 1. Switch view
    document.getElementById('studyNotesArea').style.display = 'none';
    
    const mapArea = document.getElementById('cognitiveMapArea');
    mapArea.style.display = 'block';
    
    const mapVisualization = document.getElementById('mapVisualization');
    
    // 2. Set loading state
    cognitiveMapButton.disabled = true;
    mapVisualization.innerHTML = '<p class="text-info"><span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Generating cognitive map from study notes...</p>';

    try {
        // 3. Call backend API
        const response = await fetch('/get-cognitive-map', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }
        
        // 4. Display the map
        displayCognitiveMap(data.map_data, mapVisualization);

    } catch (e) {
        console.error('Cognitive Map generation failed:', e);
        mapVisualization.innerHTML = `<p class="text-danger mt-3">Map Generation Error: ${e.message}</p>`;

    } finally {
        // Re-enable the map button on completion
        cognitiveMapButton.disabled = false;
    }
}

/**
 * Renders the cognitive map data (nodes and edges) as a simple HTML list.
 * Assumes mapData has {nodes: [{id, label}], edges: [{source, target, relationship}]}.
 */
function displayCognitiveMap(mapData, container) {
    if (!mapData || !mapData.nodes || !mapData.edges) {
        container.innerHTML = '<p class="text-warning">The map generator returned an invalid structure (missing nodes or edges).</p>';
        return;
    }
    
    let html = `<div style="max-height: 400px; overflow-y: auto;">`;
    
    // Nodes
    html += `<h6 class="text-light mt-3">Nodes (Key Concepts):</h6><div class="d-flex flex-wrap gap-2 mb-4">`;
    mapData.nodes.forEach(node => {
        const nodeText = node.label || node.id || 'N/A';
        html += `<span class="tag" style="background-color: #8a2be2; border-color: #8a2be2;">${nodeText}</span>`;
    });
    html += `</div>`;
    
    // Edges
    html += `<h6 class="text-light mt-4">Edges (Relationships):</h6><ul class="list-unstyled">`;
    mapData.edges.forEach(edge => {
        html += `<li style="margin-bottom: 5px;"><span class="text-warning">${edge.source || '?'}</span> 
                 <span class="text-secondary">--(${edge.relationship || 'relates to'})--></span> 
                 <span class="text-success">${edge.target || '?'}</span></li>`;
    });
    html += `</ul></div>`;

    container.innerHTML = html;
}

// --- END: Cognitive Map Functions ---

async function analyzeEmotion() {
    // ... (existing logic for emotion analysis)
    if (transcriptionSegments.length === 0) {
        document.getElementById('overallEmotionResult').innerHTML = '<span class="text-danger">No Transcript Data</span>';
        const emotionModal = new bootstrap.Modal(document.getElementById('emotionModal'));
        emotionModal.show();
        return;
    }
    // ... (rest of analyzeEmotion logic unchanged) ...
    document.getElementById('overallEmotionResult').innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Analyzing...';
    const emotionModal = new bootstrap.Modal(document.getElementById('emotionModal'));
    emotionModal.show();
    
    try {
        const response = await fetch('/get-emotion-chart-data', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }
        
        const overallEmotion = data.overall_emotion || "Neutral";
        const segments = data.segments || [];

        // 1. Prepare Chart Data (omitted for brevity)
        const chartDataPoints = [];
        const chartLabels = [];
        const chartColors = [];
        
        segments.forEach(segment => {
            const emotionKey = (segment.emotion || 'NEUTRAL').toUpperCase();
            const emotionValue = EMOTION_MAP[emotionKey] || EMOTION_MAP['NEUTRAL'];
            const timePoint = segment.start + (segment.end - segment.start) / 2; 

            chartDataPoints.push({ x: timePoint, y: emotionValue });
            chartLabels.push(formatTime(segment.start));
            chartColors.push(EMOTION_COLORS[emotionKey]);
        });
        
        // 2. Update Overall Emotion Text
        document.getElementById('overallEmotionResult').innerHTML = overallEmotion;
        document.getElementById('overallEmotionResult').style.color = EMOTION_COLORS[overallEmotion.toUpperCase()] || '#00ff73';

        // 3. Render Chart (omitted for brevity)
        if (emotionChartInstance) { emotionChartInstance.destroy(); }

        const ctx = document.getElementById('emotionChart').getContext('2d');
        emotionChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Segment Emotion',
                    data: chartDataPoints,
                    fill: false,
                    tension: 0.1,
                    borderColor: '#00ff73',
                    pointBackgroundColor: chartColors,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointStyle: 'circle'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { 
                        callbacks: { 
                            title: (context) => formatTime(context[0].parsed.x),
                            label: (context) => `Emotion: ${EMOTION_LABELS[String(context.parsed.y)]}`
                        } 
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Time (Seconds)', color: '#ccc' },
                        ticks: { callback: function(value, index, ticks) { return formatTime(value); }, color: '#999' }
                    },
                    y: {
                        min: -1.5, max: 5.5,
                        title: { display: true, text: 'Emotion', color: '#ccc' },
                        ticks: { callback: function(value, index, ticks) { return EMOTION_LABELS[String(value)] || ''; }, stepSize: 1, color: '#999' },
                        grid: { color: '#333' }
                    }
                }
            }
        });


    } catch (e) {
        console.error('Emotion analysis failed:', e);
        document.getElementById('overallEmotionResult').innerHTML = `<span class="text-danger">Error: ${e.message}</span>`;
    }
}

function secondsToSrtTime(totalSeconds) {
const totalMs = Math.round(totalSeconds * 1000); // integer ms
const hours = Math.floor(totalMs / 3600000);
const minutes = Math.floor((totalMs % 3600000) / 60000);
const seconds = Math.floor((totalMs % 60000) / 1000);
const ms = totalMs % 1000;
const pad2 = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');
return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(ms)}`;
}

/**
* Build SRT text from transcriptionSegments array.
* Each segment expected: { start: float_seconds, end: float_seconds, speaker: str?, text: str }
*/
function generateSrtFromSegments(segments) {
if (!Array.isArray(segments) || segments.length === 0) return '';
let srt = '';
for (let i = 0; i < segments.length; i++) {
const seg = segments[i];
const index = i + 1;
const start = secondsToSrtTime(seg.start || 0);
const end = secondsToSrtTime(seg.end || (seg.start + 2 || 0));
// include speaker label if present
const speaker = seg.speaker ? `${seg.speaker}: ` : '';
// replace any CRLFs with single linebreaks for SRT safety
const text = (seg.text || '').replace(/\r\n|\r|\n/g, ' ');
srt += `${index}\n${start} --> ${end}\n${speaker}${text}\n\n`;
}
return srt;
}

/**
* Trigger client-side download of generated SRT
*/
function downloadSrtClient(filename = 'transcript.srt') {
if (!transcriptionSegments || transcriptionSegments.length === 0) {
alert('No transcript available. Run Caption Mode first.');
return;
}
const srtText = generateSrtFromSegments(transcriptionSegments);
const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Handles file upload and initial transcription/caption processing (Caption Mode).
 */
async function uploadAndProcessAudio() {
    const fileInput = document.getElementById('audioFileInput');
    const file = fileInput.files[0];

    if (!file) {
        document.getElementById('file-error-message').style.display = 'block';
        return;
    }

    toggleUI(true, true); // Start loading state
    
    const formData = new FormData();
    formData.append('audioFile', file);

    try {
        const response = await fetch('/upload-audio', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Server returned an error.');
        }

        // 1. Store and prepare data
        const transcriptData = data.transcript_data;
        transcriptionSegments = transcriptData.segments; 
        const mediaUrl = data.media_url;
        const vttUrl = data.vtt_url;

        // 2. Setup Media Player
        const player = document.getElementById('media-player');
        player.src = mediaUrl;
        player.load();
        player.removeEventListener('timeupdate', syncTranscript);
        player.addEventListener('timeupdate', syncTranscript);

        // Add the WebVTT track
        const trackElement = document.createElement('track');
        trackElement.kind = 'subtitles';
        trackElement.label = 'English';
        trackElement.srclang = 'en';
        trackElement.src = vttUrl;
        trackElement.default = true;
        
        // Clear existing tracks before appending
        Array.from(player.querySelectorAll('track')).forEach(track => track.remove());
        player.appendChild(trackElement);
        
        // 3. Construct Segmented Transcript
        const transcriptContentElement = document.getElementById('transcript-content');
        transcriptContentElement.innerHTML = '';

        let transcriptHTML = '';
        transcriptionSegments.forEach((segment, index) => {
            const speakerLabel = segment.speaker ? `${segment.speaker}: ` : '';
            const timestamp = formatTime(segment.start); 
            const emotionClass = segment.emotion ? `emotion-${segment.emotion.toUpperCase()}` : 'emotion-NEUTRAL';

            transcriptHTML += `<span 
                id="segment-${index}" 
                class="time-segment ${emotionClass}" 
                data-start="${segment.start}" 
                data-end="${segment.end}"
                onclick="jumpToSegment(${index})"
            >
                <span class="timestamp">[${timestamp}]</span>
                <strong>${speakerLabel}</strong>${segment.text}
            </span>`;
        });
        transcriptContentElement.innerHTML = transcriptHTML;


        // 4. Reveal results
        setTimeout(() => {
            document.getElementById('media-player-area').style.display = 'block';
            document.getElementById('transcript-area').style.display = 'block';
            
            document.getElementById('media-player-area').style.opacity = '1';
            document.getElementById('transcript-area').style.opacity = '1';

        }, 50);

    } catch (e) {
        console.error('Processing failed:', e);
        const errorMessage = (e.message.includes("OpenAI API Error")) ? e.message : `An error occurred during transcription: ${e.message}`;
         document.getElementById('studySummaryResult').innerHTML = `<span class="text-danger">Caption Mode Error: ${errorMessage}</span>`;
        const studyModal = new bootstrap.Modal(document.getElementById('studyModal'));
        studyModal.show();

    } finally {
        // 5. Hide loading state and re-enable buttons
        toggleUI(false, false);
    }
}

// Initialize and setup event listeners on page load
document.addEventListener('DOMContentLoaded', () => {
    saveNotesButton = document.getElementById('saveNotesButton');
    cognitiveMapButton = document.getElementById('cognitiveMapButton'); // NEW
    saveFeedback = document.getElementById('save-feedback');
    semanticSearchButton = document.getElementById('semanticSearchButton'); // NEW
    const fileInput = document.getElementById('audioFileInput');
    
    // Listener to enable the buttons when a file is selected
    fileInput.addEventListener('change', () => {
        const errorMessage = document.getElementById('file-error-message');
        if (fileInput.files.length > 0) {
            document.getElementById('captionModeButton').disabled = false;
            document.getElementById('studyModeButton').disabled = false;
            errorMessage.style.display = 'none';
        } else {
            document.getElementById('captionModeButton').disabled = true;
            document.getElementById('studyModeButton').disabled = true;
        }
    });
    
    // Set initial state
    toggleUI(false, false);
    document.getElementById('captionModeButton').innerText = 'Caption Mode'; 
    document.getElementById('studyModeButton').innerText = 'Study Mode';
});
