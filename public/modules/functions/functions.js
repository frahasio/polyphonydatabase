// Global variables
let languages = [];
let functions = [];
let selectedTitlesForMerge = [];
let currentEditingTitleId = null;
let currentPagination = {
    page: 1,
    limit: 20,
    total: 0
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadLanguages();
    loadFunctions();
    searchTitles();
    setupEventListeners();
});

async function loadLanguages() {
    try {
        const response = await fetch('/api/admin/functions/languages');
        const data = await response.json();
        languages = data.languages;
        
        // Populate language dropdowns
        const languageSelects = ['languageFilter', 'editTitleLanguage', 'finalLanguage'];
        languageSelects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                // Clear existing options except the first one
                while (select.children.length > 1) {
                    select.removeChild(select.lastChild);
                }
                
                languages.forEach(lang => {
                    const option = document.createElement('option');
                    option.value = lang.id;
                    option.textContent = lang.name;
                    select.appendChild(option);
                });
            }
        });
    } catch (error) {
        console.error('Error loading languages:', error);
    }
}

async function loadFunctions() {
    try {
        const response = await fetch('/api/admin/functions');
        const data = await response.json();
        functions = data.functions;
        
        // Populate function dropdown
        const functionFilter = document.getElementById('functionFilter');
        functionFilter.innerHTML = '<option value="">All Functions</option>';
        functions.forEach(func => {
            const option = document.createElement('option');
            option.value = func.id;
            option.textContent = func.name;
            functionFilter.appendChild(option);
        });

        // Populate functions table
        displayFunctions(functions);
    } catch (error) {
        console.error('Error loading functions:', error);
    }
}

function displayFunctions(functionsData) {
    const tbody = document.getElementById('functionsList');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    functionsData.forEach(func => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${func.name}</td>
            <td><span class="badge bg-secondary">${func.title_count}</span></td>
            <td>${new Date(func.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-2" onclick="editFunction(${func.id})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteFunction(${func.id})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function searchTitles(page = 1) {
    try {
        const search = document.getElementById('titleSearch')?.value || '';
        const language = document.getElementById('languageFilter')?.value || '';
        const function_id = document.getElementById('functionFilter')?.value || '';
        const similar = document.getElementById('findSimilar')?.checked || false;

        const params = new URLSearchParams({
            search,
            language,
            function_id,
            similar: similar.toString(),
            page: page.toString(),
            limit: currentPagination.limit.toString()
        });

        const response = await fetch(`/api/admin/functions/titles/search?${params}`);
        const data = await response.json();

        displayTitles(data.titles);
        updatePagination(data.pagination);
    } catch (error) {
        console.error('Error searching titles:', error);
    }
}

function displayTitles(titles) {
    const container = document.getElementById('titlesResults');
    if (!container) return;
    
    if (titles.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4">No titles found</div>';
        return;
    }

    container.innerHTML = titles.map(title => {
        const languageName = languages.find(l => l.id == title.language)?.name || 'Unknown';
        const functionBadges = title.function_names && title.function_names.length > 0 
            ? title.function_names.map(name => `<span class="badge bg-info function-badge me-1">${name}</span>`).join('')
            : '<span class="text-muted">No functions</span>';

        return `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card title-card h-100" onclick="selectTitleForMerge(${title.id})">
                    <div class="card-body">
                        <h6 class="card-title">${title.text}</h6>
                        <div class="mb-2">
                            <span class="badge bg-primary language-badge">${languageName}</span>
                        </div>
                        <div class="mb-2">
                            ${functionBadges}
                        </div>
                        <div class="composition-count">
                            <i class="bi bi-music-note"></i> ${title.composition_count} compositions
                        </div>
                        <div class="mt-2">
                            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); editTitle(${title.id})">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Convert to grid layout
    container.className = 'row';
}

function updatePagination(pagination) {
    currentPagination = pagination;
    const nav = document.getElementById('titlesPagination');
    if (!nav) return;
    
    const ul = nav.querySelector('ul');
    
    if (pagination.totalPages <= 1) {
        nav.style.display = 'none';
        return;
    }

    nav.style.display = 'block';
    ul.innerHTML = '';

    // Previous button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${pagination.hasPrevPage ? '' : 'disabled'}`;
    prevLi.innerHTML = `<a class="page-link" href="#" onclick="searchTitles(${pagination.page - 1})">Previous</a>`;
    ul.appendChild(prevLi);

    // Page numbers
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);

    for (let i = start; i <= end; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${i === pagination.page ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#" onclick="searchTitles(${i})">${i}</a>`;
        ul.appendChild(li);
    }

    // Next button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${pagination.hasNextPage ? '' : 'disabled'}`;
    nextLi.innerHTML = `<a class="page-link" href="#" onclick="searchTitles(${pagination.page + 1})">Next</a>`;
    ul.appendChild(nextLi);
}

function selectTitleForMerge(titleId) {
    const card = event.currentTarget;
    
    if (selectedTitlesForMerge.includes(titleId)) {
        // Deselect
        selectedTitlesForMerge = selectedTitlesForMerge.filter(id => id !== titleId);
        card.classList.remove('selected');
    } else {
        // Select
        selectedTitlesForMerge.push(titleId);
        card.classList.add('selected');
    }

    updateSelectedTitlesDisplay();
}

function updateSelectedTitlesDisplay() {
    const container = document.getElementById('mergeSelectedTitles');
    const list = document.getElementById('selectedTitlesList');
    
    if (!container || !list) return;
    
    if (selectedTitlesForMerge.length === 0) {
        container.style.display = 'none';
        const preview = document.getElementById('mergePreview');
        if (preview) preview.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = selectedTitlesForMerge.map(id => {
        const card = document.querySelector(`.title-card[onclick*="${id}"]`);
        const titleText = card ? card.querySelector('.card-title').textContent : `Title ${id}`;
        return `
            <span class="badge bg-primary me-1">
                ${titleText}
                <button class="btn-close btn-close-white ms-1" onclick="deselectTitle(${id})"></button>
            </span>
        `;
    }).join('');

    if (selectedTitlesForMerge.length >= 2) {
        showMergePreview();
    }
}

function deselectTitle(titleId) {
    selectedTitlesForMerge = selectedTitlesForMerge.filter(id => id !== titleId);
    document.querySelector(`.title-card[onclick*="${titleId}"]`)?.classList.remove('selected');
    updateSelectedTitlesDisplay();
}

function showMergePreview() {
    const preview = document.getElementById('mergePreview');
    if (!preview) return;
    
    preview.style.display = 'block';

    // Set default final text to the first selected title
    const firstCard = document.querySelector(`.title-card[onclick*="${selectedTitlesForMerge[0]}"]`);
    const firstTitle = firstCard ? firstCard.querySelector('.card-title').textContent : '';
    const finalTitleText = document.getElementById('finalTitleText');
    if (finalTitleText) finalTitleText.value = firstTitle;
}

async function performMerge() {
    if (selectedTitlesForMerge.length < 2) {
        alert('Please select at least 2 titles to merge');
        return;
    }

    const finalText = document.getElementById('finalTitleText')?.value.trim();
    const finalLanguage = document.getElementById('finalLanguage')?.value;

    if (!finalText) {
        alert('Please enter the final title text');
        return;
    }

    try {
        const response = await fetch('/api/admin/functions/titles/merge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_title_id: selectedTitlesForMerge[0],
                source_title_ids: selectedTitlesForMerge,
                final_text: finalText,
                final_language: finalLanguage || null
            })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            selectedTitlesForMerge = [];
            updateSelectedTitlesDisplay();
            searchTitles();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error merging titles:', error);
        alert('Failed to merge titles: ' + error.message);
    }
}

function cancelMerge() {
    selectedTitlesForMerge = [];
    document.querySelectorAll('.title-card.selected').forEach(card => {
        card.classList.remove('selected');
    });
    updateSelectedTitlesDisplay();
}

async function searchForMerge() {
    const search = document.getElementById('mergeSearch')?.value;
    if (!search || !search.trim()) {
        alert('Please enter a search term');
        return;
    }

    // Switch to titles tab and search with similarity
    const titleSearch = document.getElementById('titleSearch');
    const findSimilar = document.getElementById('findSimilar');
    const titlesTab = document.getElementById('titles-tab');
    
    if (titleSearch) titleSearch.value = search;
    if (findSimilar) findSimilar.checked = true;
    if (titlesTab) titlesTab.click();
    
    searchTitles();
}

// Function management functions
async function searchFunctions() {
    const search = document.getElementById('functionSearch')?.value || '';
    try {
        const response = await fetch(`/api/admin/functions?search=${encodeURIComponent(search)}`);
        const data = await response.json();
        displayFunctions(data.functions);
    } catch (error) {
        console.error('Error searching functions:', error);
    }
}

async function editTitle(titleId) {
    currentEditingTitleId = titleId;
    
    try {
        // Load title details and associated functions
        const [titleResponse, functionsResponse] = await Promise.all([
            fetch(`/api/admin/functions/titles/search?search=&page=1&limit=1000`),
            fetch('/api/admin/functions')
        ]);

        const titleData = await titleResponse.json();
        const functionsData = await functionsResponse.json();

        const title = titleData.titles.find(t => t.id === titleId);
        if (!title) {
            throw new Error('Title not found');
        }

        // Populate form
        const editTitleText = document.getElementById('editTitleText');
        const editTitleLanguage = document.getElementById('editTitleLanguage');
        
        if (editTitleText) editTitleText.value = title.text;
        if (editTitleLanguage) editTitleLanguage.value = title.language || '';

        // Populate function checkboxes
        const container = document.getElementById('functionCheckboxes');
        if (container) {
            container.innerHTML = functionsData.functions.map(func => {
                const isAssigned = title.function_names && title.function_names.includes(func.name);
                return `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="func_${func.id}" 
                               value="${func.id}" ${isAssigned ? 'checked' : ''}>
                        <label class="form-check-label" for="func_${func.id}">
                            ${func.name}
                        </label>
                    </div>
                `;
            }).join('');
        }

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editTitleModal'));
        modal.show();

    } catch (error) {
        console.error('Error loading title for edit:', error);
        alert('Failed to load title details');
    }
}

async function saveTitle() {
    if (!currentEditingTitleId) return;

    const text = document.getElementById('editTitleText')?.value.trim();
    const language = document.getElementById('editTitleLanguage')?.value;

    if (!text) {
        alert('Please enter title text');
        return;
    }

    try {
        // Update title
        const updateResponse = await fetch(`/api/admin/functions/titles/${currentEditingTitleId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                language: language || null
            })
        });

        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            
            // Handle duplicate title error specifically
            if (updateResponse.status === 409 && errorData.error === 'DUPLICATE_TITLE') {
                const existingTitle = errorData.existingTitle;
                const confirmMerge = confirm(
                    `A title with the text "${text}" already exists (ID: ${existingTitle.id}).\n\n` +
                    `Existing title has:\n` +
                    `• ${existingTitle.composition_count} compositions\n` +
                    `• Functions: ${existingTitle.function_names?.join(', ') || 'None'}\n\n` +
                    `Would you like to merge this title with the existing one? This will transfer all compositions and function assignments to the existing title.`
                );
                
                if (confirmMerge) {
                    // Perform merge instead of update
                    await performTitleMerge(currentEditingTitleId, existingTitle.id, text, language);
                    return;
                } else {
                    // User chose not to merge, abort the save
                    return;
                }
            }
            
            // Handle other errors
            throw new Error(errorData.error || 'Failed to update title');
        }

        // Get currently selected function IDs from checkboxes
        const checkboxes = document.querySelectorAll('#functionCheckboxes input[type="checkbox"]');
        const selectedFunctionIds = [];
        
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                selectedFunctionIds.push(parseInt(checkbox.value));
            }
        });

        console.log(`Updating function associations: ${selectedFunctionIds.length} functions selected (using bulk API instead of ${checkboxes.length} individual calls)`);

        // Update all function associations in one bulk API call
        const functionsResponse = await fetch(`/api/admin/functions/titles/${currentEditingTitleId}/functions`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                functionIds: selectedFunctionIds
            })
        });

        if (!functionsResponse.ok) {
            const errorData = await functionsResponse.json();
            throw new Error(errorData.error || 'Failed to update function associations');
        }

        const functionsResult = await functionsResponse.json();

        const modal = bootstrap.Modal.getInstance(document.getElementById('editTitleModal'));
        modal.hide();
        searchTitles();

        // Show success message
        alert(`Title updated successfully! ${functionsResult.message}`);

    } catch (error) {
        console.error('Error saving title:', error);
        alert('Failed to save title: ' + error.message);
    }
}

async function performTitleMerge(sourceId, targetId, finalText, finalLanguage) {
    try {
        const response = await fetch('/api/admin/functions/titles/merge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_title_id: targetId,
                source_title_ids: [sourceId, targetId],
                final_text: finalText,
                final_language: finalLanguage || null
            })
        });

        const result = await response.json();

        if (response.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('editTitleModal'));
            modal.hide();
            searchTitles();
            alert(`Successfully merged titles! ${result.message}`);
        } else {
            throw new Error(result.error || 'Merge failed');
        }
    } catch (error) {
        console.error('Error merging titles:', error);
        alert('Failed to merge titles: ' + error.message);
    }
}

async function deleteFunction(functionId) {
    if (!confirm('Are you sure you want to delete this function? This will remove all title associations.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/functions/${functionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadFunctions();
        } else {
            throw new Error('Failed to delete function');
        }
    } catch (error) {
        console.error('Error deleting function:', error);
        alert('Failed to delete function');
    }
}

async function saveFunction() {
    const form = document.getElementById('addFunctionForm');
    const formData = new FormData(form);
    
    try {
        const response = await fetch('/api/admin/functions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: formData.get('name')
            })
        });

        if (response.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('addFunctionModal'));
            modal.hide();
            form.reset();
            loadFunctions();
        } else {
            throw new Error('Failed to create function');
        }
    } catch (error) {
        console.error('Error creating function:', error);
        alert('Failed to create function');
    }
}

function setupEventListeners() {
    // Save function button
    const saveFunctionBtn = document.getElementById('saveFunctionBtn');
    if (saveFunctionBtn) {
        saveFunctionBtn.addEventListener('click', saveFunction);
    }

    // Save title button
    const saveTitleBtn = document.getElementById('saveTitleBtn');
    if (saveTitleBtn) {
        saveTitleBtn.addEventListener('click', saveTitle);
    }

    // Handle Enter key in search fields
    const titleSearch = document.getElementById('titleSearch');
    if (titleSearch) {
        titleSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchTitles();
        });
    }

    const functionSearch = document.getElementById('functionSearch');
    if (functionSearch) {
        functionSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchFunctions();
        });
    }

    const mergeSearch = document.getElementById('mergeSearch');
    if (mergeSearch) {
        mergeSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchForMerge();
        });
    }
}

// Make functions globally available
window.searchTitles = searchTitles;
window.searchFunctions = searchFunctions;
window.searchForMerge = searchForMerge;
window.selectTitleForMerge = selectTitleForMerge;
window.deselectTitle = deselectTitle;
window.performMerge = performMerge;
window.cancelMerge = cancelMerge;
window.editTitle = editTitle;
window.deleteFunction = deleteFunction;
window.editFunction = function(id) { alert('Edit function feature coming soon'); }; 