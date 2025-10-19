// DOM Element references
const notesList = document.getElementById('notes-list');
const sidebarSearchInput = document.getElementById('sidebar-search');
const introSection = document.getElementById('intro-section');
const noteDetailView = document.getElementById('note-detail-view');
const formattingToolbar = document.getElementById('formatting-toolbar');
const noteTitleInput = document.getElementById('note-title');
const noteSummaryContent = document.getElementById('note-summary-content');
const noteCreationDateSpan = document.getElementById('note-creation-date');
const noteTagsDiv = document.getElementById('note-tags');
const saveStatusSpan = document.getElementById('save-status');
const loadingMessage = document.getElementById('loading-message');
const emptyMessage = document.getElementById('empty-message');
const exitButton = document.getElementById('exit-button');

// State variables
let currentNoteId = null;
let hasUnsavedChanges = false;
let allNotes = []; // Store all fetched notes here
let saveTimeout = null;

// --- Exit Handler ---
function handleExit() {
    // In a real application, this would redirect the user, e.g., to the homepage or dashboard.
    console.log("Exit button clicked. Navigating away from the notes view.");
    // Example of a minimal action if redirection isn't possible:
    noteDetailView.style.display = 'none';
    introSection.style.display = 'flex';
    currentNoteId = null;
    // Optionally redirect to dashboard
    // window.location.href = '/dashboard'; 
}
window.handleExit = handleExit; // Expose to global scope for onclick attribute

// Utility functions
function setHasUnsavedChanges(value) {
    // Status messages updated to reflect saving state
    hasUnsavedChanges = value;
    saveStatusSpan.textContent = value ? 'Unsaved changes...' : 'All changes saved.';
    saveStatusSpan.classList.toggle('text-yellow-600', value);
    saveStatusSpan.classList.toggle('text-green-600', !value);
    // Remove blue saving status
    saveStatusSpan.classList.remove('text-blue-500', 'text-red-600'); 
}

function trackContentChanges() {
    setHasUnsavedChanges(true);
    
    // Clear previous timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    // Set a new timeout to save after 2 seconds of inactivity
    saveTimeout = setTimeout(autoSaveNote, 2000);
}

// --- Auto-Save Function (Real Implementation) ---
async function autoSaveNote() {
    // Only proceed if there is an active note and unsaved changes
    if (!currentNoteId || !hasUnsavedChanges) return;

    // 1. Show Saving Status
    saveStatusSpan.textContent = 'Saving...';
    saveStatusSpan.classList.remove('text-yellow-600', 'text-green-600', 'text-red-600');
    saveStatusSpan.classList.add('text-blue-500');

    const updatedNote = {
        title: noteTitleInput.value,
        summary: noteSummaryContent.innerHTML,
    };

    console.log('Auto-saving note:', currentNoteId, updatedNote);

    try {
        // 2. PATCH request to the API endpoint
        const response = await fetch(`/api/notes/${currentNoteId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedNote)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save note on the server.');
        }
        
        // 3. Success: Update the local state
        setHasUnsavedChanges(false);
        
        // 4. Update the note title and modified date in the local array and sidebar
        const now = new Date().toISOString(); // Get current timestamp
        const localNoteIndex = allNotes.findIndex(n => n._id === currentNoteId);
        if (localNoteIndex !== -1) {
            allNotes[localNoteIndex].title = updatedNote.title;
            allNotes[localNoteIndex].modified_at = now; 
        }
        
        // Update the visible title in the sidebar
        const sidebarLinkTitle = document.querySelector(`#notes-list a[data-id="${currentNoteId}"] div.font-semibold`);
        const sidebarLinkDate = document.querySelector(`#notes-list a[data-id="${currentNoteId}"] div.text-sm`);
        if (sidebarLinkTitle) {
            sidebarLinkTitle.textContent = updatedNote.title;
        }
        if (sidebarLinkDate) {
            sidebarLinkDate.textContent = formatMongoDate(now);
        }


    } catch (error) {
        // 5. Failure: Show error status
        console.error("Save Error:", error.message);
        saveStatusSpan.textContent = 'Save Failed! Check console for details.';
        saveStatusSpan.classList.remove('text-blue-500', 'text-green-600');
        saveStatusSpan.classList.add('text-red-600');
    }
}

// --- Core Functions for Loading and Displaying Notes ---

function formatMongoDate(dateString) {
    if (!dateString) return 'Unknown Date';
    try {
        // dateString is an ISO 8601 string from Python's .isoformat()
        const date = new Date(dateString);
        // Use Intl.DateTimeFormat for a readable, localized format
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } catch (e) {
        console.error("Invalid date format:", dateString, e);
        return 'Invalid Date';
    }
}

// Function to populate the main editor view with a specific note's data
window.loadNote = function(noteId) {
    const note = allNotes.find(n => n._id === noteId);
    
    if (!note) {
        console.error("Note not found:", noteId);
        return;
    }
    
    // 1. Update main view state
    currentNoteId = noteId;
    setHasUnsavedChanges(false); // Reset save state on load
    introSection.style.display = 'none';
    noteDetailView.style.display = 'flex';
    formattingToolbar.style.display = 'flex';
    
    // 2. Update note details
    noteTitleInput.value = note.title;
    // The content is saved as HTML in the 'summary' field
    noteSummaryContent.innerHTML = note.summary; 
    
    // Display the date the note was last modified
    const displayDate = note.modified_at || note.created_at; 
    noteCreationDateSpan.textContent = 'Last Modified: ' + formatMongoDate(displayDate);
    
    // 3. Update tags
    noteTagsDiv.innerHTML = '';
    if (note.tags && Array.isArray(note.tags)) {
        note.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            // Updated tag styling for the new white theme
            tagSpan.className = 'px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full whitespace-nowrap shadow-sm';
            tagSpan.textContent = tag;
            noteTagsDiv.appendChild(tagSpan);
        });
    } else {
         noteTagsDiv.innerHTML = '<span class="text-xs italic text-gray-500">No tags</span>';
    }
    
    // 4. Update sidebar active state
    document.querySelectorAll('#notes-list li a').forEach(link => {
        link.classList.remove('active');
    });
    const activeLink = document.querySelector(`#notes-list a[data-id="${noteId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
    
    // Focus and scroll to the top of the content
    noteSummaryContent.focus();
    noteSummaryContent.scrollTo(0, 0);
}

// Function to fetch all notes and populate the sidebar
function fetchNotesForSidebar() {
    notesList.innerHTML = ''; // Clear notes list
    loadingMessage.classList.remove('hidden'); // Show loading
    notesList.appendChild(loadingMessage); 
    
    allNotes = []; // Clear current notes list

    // Fetch request is now handled by the backend, which returns notes sorted by modified_at
    fetch('/api/notes') 
        .then(response => {
            loadingMessage.classList.add('hidden'); // Hide loading
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            allNotes = data.notes; // Store all notes globally

            if (allNotes && allNotes.length > 0) {
                allNotes.forEach(note => {
                    const noteElement = document.createElement('li');
                    // Display the last modified date
                    const displayDate = note.modified_at ? note.modified_at : note.created_at;
                    noteElement.innerHTML = `
                        <a href="#" data-id="${note._id}" class="flex flex-col transition duration-150 ease-in-out text-gray-800" onclick="event.preventDefault(); loadNote('${note._id}')">
                            <div class="font-semibold text-base truncate">${note.title || 'Untitled Note'}</div>
                            <div class="text-sm text-gray-500 mt-1">${formatMongoDate(displayDate)}</div>
                        </a>
                    `;
                    notesList.appendChild(noteElement);
                });
                
                // Automatically load the newest note upon success
                loadNote(allNotes[0]._id);

            } else {
                // If no notes, ensure intro state is displayed
                introSection.style.display = 'flex';
                noteDetailView.style.display = 'none';
                formattingToolbar.style.display = 'none';
                emptyMessage.classList.remove('hidden');
                notesList.appendChild(emptyMessage);
            }
        })
        .catch(error => {
            console.error("Failed to fetch notes:", error);
            loadingMessage.classList.add('hidden');
            notesList.innerHTML = `<li class="p-4 text-center text-red-500">Failed to load notes. Please check connection and try again.</li>`;
        });
}


// --- Event Listeners and Initial Setup ---

// Input listeners for auto-save
noteTitleInput.addEventListener('input', trackContentChanges);
noteSummaryContent.addEventListener('input', trackContentChanges);

// Formatting Toolbar command execution
 formattingToolbar.addEventListener('click', (event) => {
     const button = event.target.closest('button');
     if (button) {
         const command = button.dataset.command;
         const value = button.dataset.value;
         if (command) {
             // Ensure focus is on the contenteditable area before executing command
             noteSummaryContent.focus(); 
             document.execCommand(command, false, value);
             trackContentChanges(); // Track changes after formatting
         }
     }
 });


// Sidebar search logic
sidebarSearchInput.addEventListener('input', () => {
    const query = sidebarSearchInput.value.toLowerCase();
    const noteElements = notesList.querySelectorAll('li'); // Target the list item
    
    noteElements.forEach(li => {
        const link = li.querySelector('a');
        // Ensure link and title element exist before accessing textContent
        const titleElement = link?.querySelector('div.font-semibold'); 
        
        if (titleElement) {
            const title = titleElement.textContent.toLowerCase();
            if (title.includes(query)) {
                li.style.display = 'block'; // Show the list item
            } else {
                li.style.display = 'none'; // Hide the list item
            }
        }
    });
});

// Initial setup on page load
document.addEventListener('DOMContentLoaded', () => {
    fetchNotesForSidebar();
    introSection.style.display = 'flex'; 
    noteDetailView.style.display = 'none';
    formattingToolbar.style.display = 'none'; 
    setHasUnsavedChanges(false); 
});