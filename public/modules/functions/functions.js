// Global variables
let languages = [];
let functions = [];
let selectedTitlesForMerge = [];
let selectedTitles = [];
let allTitles = [];
let currentEditingTitleId = null;
let currentEditingFunctionId = null;
let currentPagination = {
    page: 1,
    limit: 50,
    total: 0
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadLanguages();
    await loadFunctions();
    setupEventListeners();
    handleURLFilters();
    loadFunctionsDisplay();
});

async function loadLanguages() {
    try {
        const response = await fetch('/api/admin/functions/languages');
        if (response.ok) {
            const data = await response.json();
            languages = data.languages || [];
        } else {
            // Fallback to default languages
            languages = [
                { id: 1, name: 'Latin' },
                { id: 2, name: 'English' },
                { id: 3, name: 'French' },
                { id: 4, name: 'Italian' },
                { id: 5, name: 'German' },
                { id: 6, name: 'Spanish' }
            ];
        }
        
        // Populate language dropdowns
        const languageSelects = ['languageFilter', 'bulkLanguageSelect', 'finalLanguage', 'editTitleLanguage'];
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
        languages = [];
    }
}

async function loadFunctions() {
    try {
        const response = await fetch('/api/admin/functions');
        if (response.ok) {
            const data = await response.json();
            functions = data.functions || [];
        } else {
            functions = [];
        }
        
        // Populate function dropdowns
        const functionSelects = ['functionFilter', 'bulkFunctionSelect'];
        functionSelects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                // Keep first option, clear the rest
                while (select.children.length > 1) {
                    select.removeChild(select.lastChild);
                }
                functions.forEach(func => {
                    const option = document.createElement('option');
                    option.value = func.id;
                    option.textContent = func.name;
                    select.appendChild(option);
                });
            }
        });

        // Populate functions table if it exists
        displayFunctions(functions);
    } catch (error) {
        console.error('Error loading functions:', error);
        functions = [];
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
        const grouped = document.getElementById('groupTitles')?.checked || false;

        const params = new URLSearchParams({
            search,
            language,
            function_id,
            similar: similar.toString(),
            grouped: grouped.toString(),
            page: page.toString(),
            limit: currentPagination.limit.toString()
        });

        const response = await fetch(`/api/admin/functions/titles/search?${params}`);
        const data = await response.json();

        if (data.isGrouped) {
            // Handle grouped results
            allTitles = data.titleGroups ? data.titleGroups.flatMap(group => group.titles) : [];
            displayTitleGroups(data.titleGroups || []);
        } else {
            // Handle individual title results
            allTitles = data.titles || [];
            displayTitles(data.titles || []);
        }
        
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

    // Check if we're in bulk selection mode (index.html) or merge mode (functions.js)
    const isBulkMode = document.getElementById('bulkActionsBar') !== null;

    container.innerHTML = titles.map(title => {
        const languageName = languages.find(l => l.id == title.language)?.name || 'Unknown';
        const functionBadges = title.function_names && title.function_names.length > 0 
            ? title.function_names.map(name => `<span class="badge bg-info function-badge me-1">${name}</span>`).join('')
            : '<span class="text-muted">No functions</span>';

        const isSelected = selectedTitles.includes(title.id) || selectedTitlesForMerge.includes(title.id);
        const selectionClass = isSelected ? 'selected' : '';

        if (isBulkMode) {
            // Bulk selection mode (index.html)
            return `
                <div class="col-md-6 col-lg-4 mb-3">
                    <div class="card title-card h-100 ${selectionClass}" onclick="toggleSelection(${title.id})">
                        <div class="card-body">
                            <div class="form-check position-absolute top-0 end-0 m-2">
                                <input class="form-check-input" type="checkbox" ${isSelected ? 'checked' : ''} 
                                       onchange="toggleSelection(${title.id})" onclick="event.stopPropagation()">
                            </div>
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
        } else {
            // Merge selection mode (functions.js)
            return `
                <div class="col-md-6 col-lg-4 mb-3">
                    <div class="card title-card h-100 ${selectionClass}" onclick="selectTitleForMerge(${title.id})">
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
        }
    }).join('');

    // Convert to grid layout
    container.className = 'row';
    
    // Update selection display if in bulk mode
    if (isBulkMode) {
        updateSelectionDisplay();
    } else {
        updateSelectedTitlesDisplay();
    }
}

function displayTitleGroups(titleGroups) {
    const container = document.getElementById('titlesResults');
    if (!container) return;
    
    if (titleGroups.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4">No title groups found</div>';
        return;
    }

    container.innerHTML = titleGroups.map(group => {
        const functionBadges = group.allFunctionNames && group.allFunctionNames.length > 0 
            ? group.allFunctionNames.map(name => `<span class="badge bg-info function-badge me-1">${name}</span>`).join('')
            : '<span class="text-muted">No functions</span>';

        const variantsList = group.titles.map(title => 
            `<li class="small text-muted">${title.text} (${title.composition_count} compositions)</li>`
        ).join('');

        return `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card title-card h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title mb-0">${group.originalBaseText}</h6>
                            <span class="badge bg-secondary">${group.variantCount} variants</span>
                        </div>
                        
                        <div class="mb-2">
                            ${functionBadges}
                        </div>
                        
                        <div class="composition-count mb-2">
                            <i class="bi bi-music-note"></i> ${group.totalCompositions} total compositions
                        </div>
                        
                        <div class="mb-2">
                            <small class="text-muted">Variants:</small>
                            <ul class="mb-0 ps-3">
                                ${variantsList}
                            </ul>
                        </div>
                        
                        <div class="mt-2">
                            <button class="btn btn-sm btn-primary" onclick="editTitleGroup('${encodeURIComponent(group.originalBaseText)}')">
                                <i class="bi bi-pencil"></i> Edit Group
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
    if (!pagination) return;
    
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

// Bulk selection functions (for index.html)
function toggleSelection(titleId) {
    const index = selectedTitles.indexOf(titleId);
    if (index > -1) {
        selectedTitles.splice(index, 1);
    } else {
        selectedTitles.push(titleId);
    }
    updateSelectionDisplay();
    updateSelectedTitlesInDOM();
}

function selectAll() {
    selectedTitles = [...allTitles.map(t => t.id)];
    updateSelectionDisplay();
    updateSelectedTitlesInDOM();
}

function clearSelection() {
    selectedTitles = [];
    updateSelectionDisplay();
    updateSelectedTitlesInDOM();
}

function updateSelectedTitlesInDOM() {
    allTitles.forEach(title => {
        const isSelected = selectedTitles.includes(title.id);
        const card = document.querySelector(`.title-card[onclick*="${title.id}"]`);
        const checkbox = card?.querySelector('input[type="checkbox"]');
        
        if (card) {
            if (isSelected) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        }
        
        if (checkbox) {
            checkbox.checked = isSelected;
        }
    });
}

function updateSelectionDisplay() {
    const count = selectedTitles.length;
    const bulkBar = document.getElementById('bulkActionsBar');
    const countElement = document.getElementById('selectedCount');
    
    if (bulkBar && countElement) {
        if (count > 0) {
            bulkBar.style.display = 'block';
            countElement.textContent = `${count} title${count === 1 ? '' : 's'} selected`;
        } else {
            bulkBar.style.display = 'none';
        }
    }
}

// Merge selection functions (for functions.js)
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

// Modal functions
function showAssignFunctionModal() {
    document.getElementById('functionAssignCount').textContent = selectedTitles.length;
    const modal = new bootstrap.Modal(document.getElementById('assignFunctionModal'));
    modal.show();
}

function showAssignLanguageModal() {
    document.getElementById('languageAssignCount').textContent = selectedTitles.length;
    const modal = new bootstrap.Modal(document.getElementById('assignLanguageModal'));
    modal.show();
}

function showMergeModal() {
    document.getElementById('mergeCount').textContent = selectedTitles.length;
    // Set default text to first selected title
    const firstTitle = allTitles.find(t => t.id === selectedTitles[0]);
    if (firstTitle) {
        document.getElementById('finalTitleText').value = firstTitle.text;
        document.getElementById('finalLanguage').value = firstTitle.language || '';
    }
    const modal = new bootstrap.Modal(document.getElementById('mergeModal'));
    modal.show();
}

async function performBulkFunctionAssign() {
    const functionId = document.getElementById('bulkFunctionSelect').value;
    if (!functionId) {
        alert('Please select a function');
        return;
    }

    try {
        for (const titleId of selectedTitles) {
            await fetch(`/api/admin/functions/titles/${titleId}/functions/${functionId}`, {
                method: 'POST'
            });
        }
        
        bootstrap.Modal.getInstance(document.getElementById('assignFunctionModal')).hide();
        alert(`Function assigned to ${selectedTitles.length} titles`);
        clearSelection();
        searchTitles();
    } catch (error) {
        console.error('Error assigning function:', error);
        alert('Error assigning function. Please try again.');
    }
}

async function performBulkLanguageAssign() {
    const languageId = document.getElementById('bulkLanguageSelect').value;
    if (!languageId) {
        alert('Please select a language');
        return;
    }

    try {
        for (const titleId of selectedTitles) {
            await fetch(`/api/admin/functions/titles/${titleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    text: allTitles.find(t => t.id === titleId)?.text,
                    language: languageId 
                })
            });
        }
        
        bootstrap.Modal.getInstance(document.getElementById('assignLanguageModal')).hide();
        alert(`Language assigned to ${selectedTitles.length} titles`);
        clearSelection();
        searchTitles();
    } catch (error) {
        console.error('Error assigning language:', error);
        alert('Error assigning language. Please try again.');
    }
}

async function performMerge() {
    let titlesToMerge, finalText, finalLanguage;
    
    // Check if we're in bulk mode or merge mode
    if (selectedTitles.length >= 2) {
        // Bulk mode
        titlesToMerge = selectedTitles;
        finalText = document.getElementById('finalTitleText').value.trim();
        finalLanguage = document.getElementById('finalLanguage').value;
    } else if (selectedTitlesForMerge.length >= 2) {
        // Merge mode
        titlesToMerge = selectedTitlesForMerge;
        finalText = document.getElementById('finalTitleText')?.value.trim();
        finalLanguage = document.getElementById('finalLanguage')?.value;
    } else {
        alert('Please select at least 2 titles to merge');
        return;
    }

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
                target_title_id: titlesToMerge[0],
                source_title_ids: titlesToMerge,
                final_text: finalText,
                final_language: finalLanguage || null
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Hide the appropriate modal
            const mergeModal = document.getElementById('mergeModal');
            if (mergeModal) {
                bootstrap.Modal.getInstance(mergeModal)?.hide();
            }
            
            alert(result.message);
            
            // Clear selections
            selectedTitles = [];
            selectedTitlesForMerge = [];
            updateSelectionDisplay();
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
        // Find the title in current results or fetch it
        let title = allTitles.find(t => t.id === titleId);
        
        if (!title) {
            // If not in current results, fetch it
            const response = await fetch(`/api/admin/functions/titles/search?search=&page=1&limit=1000`);
            const data = await response.json();
            title = data.titles.find(t => t.id === titleId);
        }
        
        if (!title) {
            throw new Error('Title not found');
        }

        // Populate form
        const editTitleText = document.getElementById('editTitleText');
        const editTitleLanguage = document.getElementById('editTitleLanguage');
        
        if (editTitleText) editTitleText.value = title.text;
        if (editTitleLanguage) editTitleLanguage.value = title.language || '';

        // Populate function checkboxes (try both possible container IDs)
        const container = document.getElementById('functionCheckboxes') || document.getElementById('editFunctionCheckboxes');
        if (container) {
            container.innerHTML = functions.map(func => {
                const isAssigned = title.function_names && title.function_names.includes(func.name);
                const checkboxId = container.id === 'functionCheckboxes' ? `func_${func.id}` : `edit_func_${func.id}`;
                return `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="${checkboxId}" 
                               value="${func.id}" ${isAssigned ? 'checked' : ''}>
                        <label class="form-check-label" for="${checkboxId}">
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
    return await saveEditedTitle(); // Use the same implementation
}

async function saveEditedTitle() {
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

        // Get currently selected function IDs from checkboxes (try both possible container IDs)
        const checkboxes = document.querySelectorAll('#functionCheckboxes input[type="checkbox"], #editFunctionCheckboxes input[type="checkbox"]');
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

function handleURLFilters() {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get('filter');
    
    if (filter) {
        // Set search term based on filter
        switch (filter) {
            case 'no_functions':
                document.getElementById('titleSearch').value = '*no_functions*';
                showFilterAlert('Showing titles with no functions assigned. You can select multiple titles and assign functions in bulk.');
                searchTitles();
                break;
            case 'no_language':
                document.getElementById('titleSearch').value = '*no_language*';
                showFilterAlert('Showing titles with no language assigned. You can select multiple titles and assign languages in bulk.');
                searchTitles();
                break;
            case 'empty_functions':
                alert('Functions without titles - this feature coming soon');
                break;
        }
    }
}

function showFilterAlert(message) {
    const filterMessage = document.getElementById('filterMessage');
    const filterAlert = document.getElementById('filterAlert');
    if (filterMessage) filterMessage.textContent = message;
    if (filterAlert) filterAlert.style.display = 'block';
}

function clearSpecialFilter() {
    const filterAlert = document.getElementById('filterAlert');
    const titleSearch = document.getElementById('titleSearch');
    const container = document.getElementById('titlesResults');
    
    if (filterAlert) filterAlert.style.display = 'none';
    if (titleSearch) titleSearch.value = '';
    if (container) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-search display-4 text-muted"></i>
                <p>Enter a search term to find titles</p>
            </div>
        `;
    }
    // Clear URL parameters
    window.history.replaceState({}, document.title, window.location.pathname);
}

function loadFunctionsDisplay() {
    const container = document.getElementById('functionsResults');
    if (!container) return;
    
    if (functions.length === 0) {
        container.innerHTML = '<div class="text-center text-muted py-4">No functions found</div>';
        return;
    }

    // Sort functions to show ones with no titles first
    const sortedFunctions = [...functions].sort((a, b) => {
        const aCount = a.title_count || 0;
        const bCount = b.title_count || 0;
        if (aCount === 0 && bCount > 0) return -1;
        if (aCount > 0 && bCount === 0) return 1;
        return a.name.localeCompare(b.name);
    });

    const functionsWithNoTitles = functions.filter(f => (f.title_count || 0) === 0).length;
    
    let headerHTML = '';
    if (functionsWithNoTitles > 0) {
        headerHTML = `
            <div class="alert alert-warning mb-4">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                <strong>Attention:</strong> ${functionsWithNoTitles} function${functionsWithNoTitles === 1 ? ' has' : 's have'} no titles assigned and ${functionsWithNoTitles === 1 ? 'is' : 'are'} highlighted below.
                Consider removing unused functions or assigning them to relevant titles.
            </div>
        `;
    }

    container.innerHTML = headerHTML + sortedFunctions.map(func => {
        const titleCount = func.title_count || 0;
        const hasNoTitles = titleCount === 0;
        const cardClass = hasNoTitles ? 'border-warning border-2 bg-warning bg-opacity-10' : '';
        
        return `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card h-100 ${cardClass}" ${hasNoTitles ? 'style="box-shadow: 0 0 0 2px rgba(255, 193, 7, 0.5);"' : ''}>
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title mb-0 ${hasNoTitles ? 'text-warning-emphasis' : ''}">${func.name}</h6>
                            <div class="dropdown">
                                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
                                    <i class="bi bi-three-dots"></i>
                                </button>
                                <ul class="dropdown-menu">
                                    <li><a class="dropdown-item" href="#" onclick="editFunction(${func.id})"><i class="bi bi-pencil"></i> Edit</a></li>
                                    <li><a class="dropdown-item text-danger" href="#" onclick="deleteFunction(${func.id})"><i class="bi bi-trash"></i> Delete</a></li>
                                </ul>
                            </div>
                        </div>
                        <div class="mb-2">
                            ${hasNoTitles 
                                ? '<span class="badge bg-warning text-dark fs-6"><i class="bi bi-exclamation-triangle-fill me-1"></i> No Titles Assigned</span>'
                                : `<span class="badge bg-primary"><i class="bi bi-card-text"></i> ${titleCount} title${titleCount === 1 ? '' : 's'}</span>`
                            }
                        </div>
                        <div class="text-muted small">
                            <i class="bi bi-hash"></i> ID: ${func.id}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    container.className = 'row';
}

function showAddFunctionModal() {
    const nameField = document.getElementById('newFunctionName');
    if (nameField) nameField.value = '';
    const modal = new bootstrap.Modal(document.getElementById('addFunctionModal'));
    modal.show();
}

async function createFunction() {
    const name = document.getElementById('newFunctionName')?.value.trim();
    
    if (!name) {
        alert('Please enter a function name');
        return;
    }

    try {
        const response = await fetch('/api/admin/functions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('addFunctionModal'));
            modal.hide();
            await loadFunctions();
            loadFunctionsDisplay();
            alert('Function created successfully');
        } else {
            throw new Error('Failed to create function');
        }
    } catch (error) {
        console.error('Error creating function:', error);
        alert('Failed to create function');
    }
}

function editFunction(functionId) {
    const func = functions.find(f => f.id === functionId);
    if (!func) return;

    currentEditingFunctionId = functionId;
    const editField = document.getElementById('editFunctionName');
    if (editField) editField.value = func.name;
    
    const modal = new bootstrap.Modal(document.getElementById('editFunctionModal'));
    modal.show();
}

async function saveFunctionEdit() {
    if (!currentEditingFunctionId) return;

    const name = document.getElementById('editFunctionName')?.value.trim();
    
    if (!name) {
        alert('Please enter a function name');
        return;
    }

    try {
        const response = await fetch(`/api/admin/functions/${currentEditingFunctionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('editFunctionModal'));
            modal.hide();
            await loadFunctions();
            loadFunctionsDisplay();
            alert('Function updated successfully');
        } else {
            throw new Error('Failed to update function');
        }
    } catch (error) {
        console.error('Error updating function:', error);
        alert('Failed to update function');
    }
}

async function deleteFunction(functionId) {
    const func = functions.find(f => f.id === functionId);
    if (!func) return;

    if (!confirm(`Are you sure you want to delete "${func.name}"? This will remove all title associations.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/functions/${functionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadFunctions();
            loadFunctionsDisplay();
            alert('Function deleted successfully');
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

async function editTitleGroup(baseText) {
    try {
        const response = await fetch(`/api/admin/functions/titles/group/${encodeURIComponent(baseText)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch group details');
        }
        
        const data = await response.json();
        
        // Populate modal
        document.getElementById('groupCurrentBaseText').value = data.group.originalBaseText;
        document.getElementById('groupNewBaseText').value = data.group.originalBaseText;
        
        // Populate language dropdown for group modal
        const groupLanguageSelect = document.getElementById('groupLanguage');
        while (groupLanguageSelect.children.length > 1) {
            groupLanguageSelect.removeChild(groupLanguageSelect.lastChild);
        }
        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.id;
            option.textContent = lang.name;
            groupLanguageSelect.appendChild(option);
        });
        
        // Show titles in the group
        const titlesList = document.getElementById('groupTitlesList');
        titlesList.innerHTML = data.titles.map(title => 
            `<div class="small mb-1">
                <strong>${title.text}</strong> 
                <span class="text-muted">(${title.composition_count} compositions)</span>
            </div>`
        ).join('');
        
        // Store the base text for saving
        document.getElementById('editGroupModal').dataset.originalBaseText = data.group.originalBaseText;
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editGroupModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error loading group details:', error);
        alert('Error loading group details. Please try again.');
    }
}

async function saveGroupEdit() {
    try {
        const originalBaseText = document.getElementById('editGroupModal').dataset.originalBaseText;
        const newBaseText = document.getElementById('groupNewBaseText').value.trim();
        const language = document.getElementById('groupLanguage').value || undefined;
        
        if (!newBaseText) {
            alert('Please enter a base text');
            return;
        }
        
        const response = await fetch('/api/admin/functions/titles/group/bulk-update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                originalBaseText,
                newBaseText,
                language
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            bootstrap.Modal.getInstance(document.getElementById('editGroupModal')).hide();
            
            // Create a detailed success message
            let message = result.message;
            
            if (result.hadConflicts) {
                let hasDetails = false;
                
                if (result.internalMerges && result.internalMerges.length > 0) {
                    message += '\n\nInternal merges (within the group):\n';
                    result.internalMerges.forEach(merge => {
                        message += `• "${merge.sourceText}" merged into "${merge.finalText}"\n`;
                    });
                    hasDetails = true;
                }
                
                if (result.mergedTitles && result.mergedTitles.length > 0) {
                    message += '\n\nExternal merges (with existing titles):\n';
                    result.mergedTitles.forEach(merge => {
                        message += `• "${merge.originalText}" merged into existing "${merge.finalText}"\n`;
                    });
                    hasDetails = true;
                }
                
                if (hasDetails) {
                    message += '\nAll compositions and function associations were preserved.';
                }
            }
            
            alert(message);
            searchTitles(); // Refresh results
        } else {
            const error = await response.json();
            alert(`Error updating group: ${error.error}`);
        }
        
    } catch (error) {
        console.error('Error saving group edit:', error);
        alert('Error saving changes. Please try again.');
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
        saveTitleBtn.addEventListener('click', saveEditedTitle);
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

    // Filter changes trigger search
    const languageFilter = document.getElementById('languageFilter');
    if (languageFilter) {
        languageFilter.addEventListener('change', () => {
            if (document.getElementById('titleSearch')?.value.trim()) {
                searchTitles();
            }
        });
    }

    const functionFilter = document.getElementById('functionFilter');
    if (functionFilter) {
        functionFilter.addEventListener('change', () => {
            if (document.getElementById('titleSearch')?.value.trim()) {
                searchTitles();
            }
        });
    }

    const findSimilar = document.getElementById('findSimilar');
    if (findSimilar) {
        findSimilar.addEventListener('change', () => {
            if (document.getElementById('titleSearch')?.value.trim()) {
                searchTitles();
            }
        });
    }
    
    // Group titles checkbox change
    const groupTitles = document.getElementById('groupTitles');
    if (groupTitles) {
        groupTitles.addEventListener('change', () => {
            if (document.getElementById('titleSearch')?.value.trim()) {
                searchTitles();
            }
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
window.saveTitle = saveTitle;
window.saveEditedTitle = saveEditedTitle;
window.deleteFunction = deleteFunction;
window.editFunction = editFunction;
window.toggleSelection = toggleSelection;
window.selectAll = selectAll;
window.clearSelection = clearSelection;
window.showAssignFunctionModal = showAssignFunctionModal;
window.showAssignLanguageModal = showAssignLanguageModal;
window.showMergeModal = showMergeModal;
window.performBulkFunctionAssign = performBulkFunctionAssign;
window.performBulkLanguageAssign = performBulkLanguageAssign;
window.clearSpecialFilter = clearSpecialFilter;
window.showAddFunctionModal = showAddFunctionModal;
window.createFunction = createFunction;
window.saveFunctionEdit = saveFunctionEdit;
window.editTitleGroup = editTitleGroup;
window.saveGroupEdit = saveGroupEdit; 