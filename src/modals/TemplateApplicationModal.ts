import { App, Modal, Notice, TFile, TextComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
// Import directly from source files - NOT from src/index.ts
import type { TemplateNode } from '../interfaces';
import { formatValuePreview } from '../propertyFormatters';
import type { PropertyWithType } from '../PropertyTypeService';
import { BrowserModal } from './BrowserModal';

export class TemplateApplicationModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    targetFiles: TFile[];
    selectedTemplate: TFile | null = null;
    selectedProperties: string[] = [];
    overrideValueProperties: string[] = []; // Changed from preservePropertyValues
    overrideAllValues: boolean = false; // Changed from preserveAllValues
    propertyPositioning: 'below' | 'above' | 'remove' = 'below';
    templateTree: TemplateNode = { type: 'folder', name: 'Root', path: '', children: [] };
    allTemplates: TFile[] = [];
    searchResults: TFile[] = [];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, targetFiles: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.targetFiles = targetFiles;
    }

    // Helper method to get SVG icon HTML
    private getSvgIcon(type: 'file' | 'search' | 'warning' | 'check' | 'x' | 'chevron-down' | 'chevron-up' | 'info' | 'folder-search'): string {
        switch(type) {
            case 'file':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg>';
            case 'search':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-search"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>';
            case 'warning':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>';
            case 'check':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-check"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            case 'x':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
            case 'chevron-down':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg>';
            case 'chevron-up':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-up"><path d="m18 15-6-6-6 6"></path></svg>';
            case 'info':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-info"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>';
            case 'folder-search':
                return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder-search"><path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1"></path><path d="m21 21-1.9-1.9"></path><circle cx="17" cy="17" r="3"></circle></svg>';
            default:
                return '';
        }
    }

    // Helper method to get checkbox icon SVG HTML
    private getCheckboxIconSvg(state: 'checked' | 'unchecked' | 'indeterminate'): string {
        if (state === 'checked') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="svg-icon yaml-checkbox-svg"><path d="M20 6L9 17l-5-5"/></svg>';
        } else if (state === 'indeterminate') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="svg-icon yaml-checkbox-svg"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        } else {
            return ''; // Empty for unchecked state
        }
    }

    // Helper to create a custom checkbox
    private createCustomCheckbox(isChecked: boolean, className: string): HTMLElement {
        // Container for checkbox
        const checkboxContainer = document.createElement('span');
        checkboxContainer.addClass('yaml-custom-checkbox-container');
        
        // Create the custom checkbox element
        const checkbox = document.createElement('div');
        checkbox.addClass('yaml-custom-checkbox');
        checkbox.addClass(className);
        
        // Set initial state
        if (isChecked) {
            checkbox.addClass('is-checked');
            checkbox.innerHTML = this.getCheckboxIconSvg('checked');
        }
        
        // Add to container
        checkboxContainer.appendChild(checkbox);
        return checkboxContainer;
    }

    // Helper to update checkbox state
    private updateCheckboxState(checkbox: HTMLElement, state: 'checked' | 'unchecked' | 'indeterminate'): void {
        // Remove existing states
        checkbox.removeClass('is-checked');
        checkbox.removeClass('is-indeterminate');
        checkbox.empty();
        
        if (state === 'checked') {
            checkbox.addClass('is-checked');
            checkbox.innerHTML = this.getCheckboxIconSvg('checked');
        } else if (state === 'indeterminate') {
            checkbox.addClass('is-indeterminate');
            checkbox.innerHTML = this.getCheckboxIconSvg('indeterminate');
        }
        // For unchecked, just leave it empty
    }

    // Helper to create a custom radio button (styled like checkbox)
    private createCustomRadio(isSelected: boolean, groupName: string, className: string): HTMLElement {
        // Container for the radio-checkbox
        const radioContainer = document.createElement('span');
        radioContainer.addClass('yaml-custom-checkbox-container');
        
        // Create the custom element (looks like checkbox but acts like radio)
        const radio = document.createElement('div');
        radio.addClass('yaml-custom-checkbox');
        radio.addClass('yaml-custom-radio');
        radio.addClass(className);
        
        // Set data attribute for group name (radio behavior)
        radio.setAttribute('data-radio-group', groupName);
        
        // Set initial state
        if (isSelected) {
            radio.addClass('is-checked');
            radio.innerHTML = this.getCheckboxIconSvg('checked');
        }
        
        // Add to container
        radioContainer.appendChild(radio);
        return radioContainer;
    }

    // Helper to set radio selection in a group
    private setRadioSelection(selectedRadio: HTMLElement): void {
        // Get the group name
        const groupName = selectedRadio.getAttribute('data-radio-group');
        if (!groupName) return;
        
        // Find all radios in the same group
        document.querySelectorAll(`.yaml-custom-radio[data-radio-group="${groupName}"]`).forEach((radio: HTMLElement) => {
            // Deselect all radios in this group
            this.updateCheckboxState(radio, 'unchecked');
            radio.setAttribute('aria-checked', 'false');
        });
        
        // Select the clicked radio
        this.updateCheckboxState(selectedRadio, 'checked');
        selectedRadio.setAttribute('aria-checked', 'true');
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__template-application');
        
        // Main header (left-aligned per requirements)
        contentEl.createEl('h2', { text: 'Select Template File' });
        
        // Loading templates indicator
        const loadingEl = contentEl.createDiv({ cls: 'yaml-templates-loading' });
        loadingEl.createEl('p', { text: 'Loading templates...' });
        loadingEl.createEl('div', { cls: 'yaml-spinner' });
        
        // Load templates asynchronously
        await this.loadAllTemplates();
        
        // Remove loading indicator
        loadingEl.remove();
        
        // Add search bar with flex layout container
        const searchContainer = contentEl.createDiv({ cls: 'yaml-search-container' });

        // Create a wrapper for the search input to maintain proper spacing
        const searchInputWrapper = searchContainer.createDiv({ cls: 'yaml-search-input-wrapper' });

        // Create the input element
        const searchInput = searchInputWrapper.createEl('input', {
            type: 'text',
            cls: 'setting-search-input',
            attr: {
                placeholder: 'Search templates...'
            }
        });

        // Add browse button to the search container (not the wrapper)
        const browseButton = searchContainer.createEl('button', { 
            text: 'Browse'
        });

        // Handle input changes
        searchInput.addEventListener('input', (event) => {
            const target = event.target as HTMLInputElement;
            const value = target.value;
            this.filterTemplates(value);
        });

        // Add clear functionality with a click handler outside the input
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchInput.value = '';
                this.filterTemplates('');
            }
        });

        // Handle browse button click
        browseButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Open a simplified version of TemplateFileSelectorModal
            new BrowserModal(
                this.app,
                (result) => {
                    // We only care about single file selection for this use case
                    if (result.files && result.files.length > 0) {
                        // Process the first selected file as the template
                        this.selectedTemplate = result.files[0];
                        this.loadTemplateProperties();
                    }
                },
                {
                    existingPathsToHighlight: [], // No existing template paths to highlight
                    singleFileSelectionMode: true, // Set to true to indicate single file selection mode
                    title: "Select a Template File",
                    description: "Choose any file to use as a one-time template.",
                    confirmButtonText: "Use Selected File"
                }
            ).open();
        });

        // Add hint text below search container (not inside it)
        const hintText = contentEl.createEl('p', { 
            text: 'Search to filter your saved templates. Use Browse to select any file as a template for this operation only (won\'t be added to your templates list).',
            cls: 'yaml-hint-text'
        });
        
        // Template results container
        const templateResultsContainer = contentEl.createDiv({ cls: 'yaml-template-results' });
        
        // If no templates found
        if (this.allTemplates.length === 0) {
            const emptyContainer = templateResultsContainer.createDiv({ cls: 'yaml-empty-state-container' });
            
            // Add folder icon
            const emptyIcon = emptyContainer.createDiv({ cls: 'yaml-empty-state-icon' });
            emptyIcon.innerHTML = this.getSvgIcon('folder-search');
            
            // Add title and message
            emptyContainer.createEl('h4', { 
                text: 'No Template Files Found',
                cls: 'yaml-empty-state-title'
            });
            
            emptyContainer.createEl('p', { 
                text: 'Configure template files or directories in the plugin settings.',
                cls: 'yaml-empty-state-message'
            });
            
            // Add action button
            const actionButton = emptyContainer.createEl('button', {
                text: 'Open Settings',
                cls: 'mod-cta yaml-empty-state-action'
            });
            
            actionButton.addEventListener('click', () => {
                // Close this modal
                this.close();
                // Show a notice guiding the user
                new Notice('Please go to Settings → Plugin Options → YAML Property Manager to configure templates', 5000);
            });
        } else {
            // Initialize search results with all templates
            this.searchResults = [...this.allTemplates];
            this.renderSearchResults(templateResultsContainer);
        }

        const validationMessage = contentEl.createDiv({ 
            cls: 'yaml-validation-message',
            attr: { id: 'validation-message' }
        });
        
        const validationIcon = validationMessage.createSpan({ cls: 'yaml-validation-icon' });
        validationIcon.innerHTML = this.getSvgIcon('warning');
        
        validationMessage.createSpan({ 
            text: 'Select template to apply properties.',
            cls: 'yaml-validation-text'
        });

        // 1. Create the properties section header (initially hidden)
        const propertiesSectionHeader = contentEl.createEl('h2', { 
            text: 'Select Properties to Apply',
            cls: 'yaml-properties-section-header yaml-element--hidden'
        });
        
        // 3. Create "Select All Properties" checkbox container (initially hidden)
        const selectAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-select-all--primary yaml-element--hidden',
            attr: { id: 'select-all-container' }
        });

        const selectAllCustomCheckbox = this.createCustomCheckbox(false, 'yaml-select-all__checkbox');
        selectAllContainer.appendChild(selectAllCustomCheckbox);
        const selectAllCheckbox = selectAllCustomCheckbox.querySelector('.yaml-custom-checkbox') as HTMLElement;
        selectAllCheckbox.setAttribute('id', 'select-all-properties');
        selectAllCheckbox.setAttribute('role', 'checkbox');
        selectAllCheckbox.setAttribute('aria-checked', 'false');
        selectAllCheckbox.setAttribute('tabindex', '0');

        selectAllContainer.createEl('label', {
            text: 'Select All Properties',
            attr: { for: 'select-all-properties' }
        });

        // 4. Create "Override All Values" checkbox container (initially hidden)
        const overrideAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-select-all--secondary yaml-element--hidden yaml-select-all--disabled',
            attr: { id: 'override-all-container' }
        });

        const overrideAllCustomCheckbox = this.createCustomCheckbox(false, 'yaml-select-all__checkbox');
        overrideAllContainer.appendChild(overrideAllCustomCheckbox);
        const overrideAllCheckbox = overrideAllCustomCheckbox.querySelector('.yaml-custom-checkbox') as HTMLElement;
        overrideAllCheckbox.setAttribute('id', 'override-all-values');
        overrideAllCheckbox.setAttribute('role', 'checkbox');
        overrideAllCheckbox.setAttribute('aria-checked', 'false');
        overrideAllCheckbox.setAttribute('tabindex', '0');

        overrideAllContainer.createEl('label', {
            text: 'Override All Values (use template values instead of existing)',
            attr: { for: 'override-all-values' }
        });

        // Add event listener to Override All checkbox
        overrideAllCheckbox.addEventListener('click', () => {
            // Skip if disabled
            if (overrideAllCheckbox.hasClass('is-disabled')) {
                return;
            }
            
            const isCurrentlyChecked = overrideAllCheckbox.hasClass('is-checked');
            const newState = !isCurrentlyChecked;
            
            // Update checkbox state
            this.updateCheckboxState(overrideAllCheckbox, newState ? 'checked' : 'unchecked');
            overrideAllCheckbox.setAttribute('aria-checked', newState.toString());
            
            // Update class state
            this.overrideAllValues = newState;
            
            if (newState) {
                // Add visual indication that this option is active
                overrideAllContainer.addClass('active');
                
                // Update all individual value checkboxes
                const valueCheckboxes = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-value-checkbox:not(.is-disabled)');
                valueCheckboxes.forEach((checkbox: HTMLElement) => {
                    this.updateCheckboxState(checkbox, 'checked');
                    checkbox.setAttribute('aria-checked', 'true');
                    
                    // Get property key from checkbox id
                    const key = checkbox.id.replace('override-value-', '');
                    if (key && !this.overrideValueProperties.includes(key)) {
                        this.overrideValueProperties.push(key);
                    }
                });
            } else {
                overrideAllContainer.removeClass('active');
                
                // Uncheck all individual value checkboxes
                const valueCheckboxes = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-value-checkbox:not(.is-disabled)');
                valueCheckboxes.forEach((checkbox: HTMLElement) => {
                    this.updateCheckboxState(checkbox, 'unchecked');
                    checkbox.setAttribute('aria-checked', 'false');
                    
                    // Get property key from checkbox id
                    const key = checkbox.id.replace('override-value-', '');
                    if (key) {
                        this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                    }
                });
            }
        });
        
        // Buttons container
        const buttonContainer = this.modalEl.createDiv({ cls: 'modal-button-container' });

        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Template', 
            cls: 'mod-cta'
        });

        applyButton.disabled = true;

        applyButton.addEventListener('click', async () => {
            if (this.selectedTemplate && this.selectedProperties.length > 0) {
                // Apply template with preservation information
                await this.applyTemplateToFilesWithPreservation(
                    this.selectedTemplate,
                    this.targetFiles,
                    this.selectedProperties,
                    this.overrideValueProperties,
                    this.overrideAllValues
                );
                
                // Add to recent templates
                this.plugin.addToRecentTemplates(this.selectedTemplate.path);
                
                this.close();
            } else {
                // Show custom validation message with updated text based on what's missing
                const validationMessage = document.getElementById('validation-message');
                if (validationMessage) {
                    // Update message text based on what's missing
                    const validationText = validationMessage.querySelector('.yaml-validation-text');
                    if (validationText) {
                        if (!this.selectedTemplate) {
                            validationText.textContent = 'Select a template file.';
                        } else if (this.selectedProperties.length === 0) {
                            validationText.textContent = 'Select at least one property to apply.';
                        } else {
                            validationText.textContent = 'Select template to apply properties.';
                        }
                    }
                    
                    // Show the message
                    validationMessage.removeClass('yaml-validation-message--hidden');
                    
                    // Make sure it's visible in the viewport
                    validationMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });

        cancelButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
    }

    // Load all template files
    async loadAllTemplates() {
        this.allTemplates = await this.plugin.getAllTemplateFiles();
        
        // Sort templates by name for better usability
        this.allTemplates.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // Filter templates based on search query
    filterTemplates(query: string) {
        if (!query || query.trim() === '') {
            this.searchResults = [...this.allTemplates];
        } else {
            // Split the search query by spaces to implement AND operator
            const searchTerms = query.toLowerCase().trim().split(/\s+/);
            
            // Filter templates - only include those that match ALL terms (AND operator)
            this.searchResults = this.allTemplates.filter(file => {
                const fileName = file.name.toLowerCase();
                const filePath = file.path.toLowerCase();
                
                // Check if ALL search terms are found in either the name or path
                return searchTerms.every(term => 
                    fileName.includes(term) || filePath.includes(term)
                );
            });
        }
        
        // Re-render search results
        const resultsContainer = this.contentEl.querySelector('.yaml-template-results') as HTMLElement;
        if (resultsContainer) {
            this.renderSearchResults(resultsContainer);
        }
    }
    
    // Render search results
    renderSearchResults(container: HTMLElement) {
        // Clear existing results
        container.empty();
        
        if (this.searchResults.length === 0) {
            const emptyContainer = container.createDiv({ cls: 'yaml-empty-state-container' });
            
            // Add search icon
            const emptyIcon = emptyContainer.createDiv({ cls: 'yaml-empty-state-icon' });
            emptyIcon.innerHTML = this.getSvgIcon('search');
            
            // Add title and message
            emptyContainer.createEl('h4', { 
                text: 'No Matching Templates',
                cls: 'yaml-empty-state-title'
            });
            
            emptyContainer.createEl('p', { 
                text: 'Try adjusting your search term or browse for a file instead.',
                cls: 'yaml-empty-state-message'
            });
            
            return;
        }
        
        // Create results list
        const resultsList = container.createDiv({ cls: 'yaml-template-list' });
        
        // Create element for each template in search results
        for (const file of this.searchResults) {
            // Create a template item container
            const templateItem = resultsList.createDiv({ cls: 'yaml-template-item' });
            
            // Determine if this template is currently selected
            const isSelected = this.selectedTemplate !== null && 
            this.selectedTemplate.path === file.path;

            // Create the custom radio with proper selection state
            const radioContainer = this.createCustomRadio(isSelected, 'template', 'yaml-template-radio');
            templateItem.appendChild(radioContainer);

            // Get the actual radio element
            const radioBtn = radioContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
            radioBtn.setAttribute('id', `template-${file.path.replace(/\//g, '-')}`);
            radioBtn.setAttribute('data-path', file.path);
            radioBtn.setAttribute('role', 'radio');
            radioBtn.setAttribute('aria-checked', isSelected.toString());
            radioBtn.setAttribute('tabindex', '0');
            
            // Add file icon
            const fileIcon = templateItem.createSpan({ cls: 'yaml-template-icon' });
            fileIcon.innerHTML = this.getSvgIcon('file');
            
            // Add template info container
            const templateInfo = templateItem.createDiv({ cls: 'yaml-template-info' });
            
            // Add template name with normal font weight
            templateInfo.createEl('div', {
                text: file.name,
                cls: 'yaml-template-name'
            });
            
            // Add file path underneath
            if (file.parent && file.parent.path) {
                templateInfo.createEl('div', {
                    text: file.parent.path,
                    cls: 'yaml-template-path'
                });
            }
            
            // Add keyboard support
            radioBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    radioBtn.click();
                }
            });
            
            // Handle selection
            radioBtn.addEventListener('click', () => {
                // Update radio selection state
                this.setRadioSelection(radioBtn);
                
                // Update selected template
                this.selectedTemplate = file;
                
                // Hide the validation message when a template is selected
                const validationMessage = document.getElementById('validation-message');
                if (validationMessage) {
                    validationMessage.addClass('yaml-validation-message--hidden');
                }
                
                // Load template properties
                this.loadTemplateProperties();
            });
            
            // Make whole item clickable
            templateItem.addEventListener('click', (e) => {
                // Check if the target is an Element and not the radio button
                if (e.target instanceof Element && e.target !== radioBtn && !e.target.closest('.yaml-custom-checkbox-container')) {
                    // Simulate a click on the radio button
                    radioBtn.click();
                }
            });
        }
    }
    
    // Load and display properties from the selected template
    async loadTemplateProperties() {
        if (!this.selectedTemplate) {
            return;
        }
        
        const { contentEl } = this;
        
        // Show properties section header
        const propertiesSectionHeader = contentEl.querySelector('.yaml-properties-section-header') as HTMLElement;
        if (propertiesSectionHeader) {
            propertiesSectionHeader.removeClass('yaml-element--hidden');
        }
        
        // Add the template header directly to content element
        // First, remove any existing direct template elements
        contentEl.querySelectorAll('.yaml-direct-template-header, .yaml-direct-path-container').forEach(el => el.remove());
        
        // Add the template header directly to content element
        const directTemplateHeader = contentEl.createEl('h3', {
            text: 'Selected Template',
            cls: 'yaml-direct-template-header'
        });
        
        // Insert after properties section header
        if (propertiesSectionHeader) {
            propertiesSectionHeader.after(directTemplateHeader);
        }
        
        // Add the path container directly to content element
        const directPathContainer = contentEl.createDiv({
            cls: 'yaml-direct-path-container'
        });
        
        // Insert after the direct template header
        directTemplateHeader.after(directPathContainer);
        
        // Add the path text to the container
        directPathContainer.createSpan({
            text: this.selectedTemplate.path,
            cls: 'yaml-direct-path-text'
        });
        
        // Add Property List header (same style as Selected Template)
        const propertyListHeader = contentEl.createEl('h3', {
            text: 'Property List',
            cls: 'yaml-direct-template-header'
        });

        // Move the Select All and Override All containers under the Property List header
        const selectAllContainer = document.getElementById('select-all-container');
        const overrideAllContainer = document.getElementById('override-all-container');

        if (selectAllContainer) {
            propertyListHeader.after(selectAllContainer);
            selectAllContainer.removeClass('yaml-element--hidden');
        }

        if (overrideAllContainer && selectAllContainer) {
            selectAllContainer.after(overrideAllContainer);
            overrideAllContainer.removeClass('yaml-element--hidden');
        }
        
        // Add advanced positioning options section
        if (overrideAllContainer) {
            // First, remove any existing positioning options to prevent duplication
            contentEl.querySelectorAll('.yaml-options-header, .yaml-positioning-options').forEach(el => el.remove());
            
            // Create header for positioning options (h4)
            const positioningHeader = contentEl.createEl('h4', {
                text: 'Property Positioning Options',
                cls: 'yaml-options-header'
            });

            // Position after the override container
            overrideAllContainer.after(positioningHeader);

            // Create options container
            const positioningOptions = contentEl.createDiv({
                cls: 'yaml-positioning-options'
            });

            // Position after the header
            positioningHeader.after(positioningOptions);

            // Option 1: Position below - custom radio
            const belowOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const belowRadioContainer = this.createCustomRadio(true, 'positioning', 'yaml-position-radio');
            belowOption.appendChild(belowRadioContainer);
            const belowRadio = belowRadioContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
            belowRadio.setAttribute('id', 'position-below');
            belowRadio.setAttribute('role', 'radio');
            belowRadio.setAttribute('aria-checked', 'true');
            belowRadio.setAttribute('tabindex', '0');
            belowRadio.setAttribute('data-value', 'below');

            belowOption.createEl('label', {
                text: 'Position new properties below existing ones',
                attr: { for: 'position-below' }
            });

            // Option 2: Position above - custom radio
            const aboveOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const aboveRadioContainer = this.createCustomRadio(false, 'positioning', 'yaml-position-radio');
            aboveOption.appendChild(aboveRadioContainer);
            const aboveRadio = aboveRadioContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
            aboveRadio.setAttribute('id', 'position-above');
            aboveRadio.setAttribute('role', 'radio');
            aboveRadio.setAttribute('aria-checked', 'false');
            aboveRadio.setAttribute('tabindex', '0');
            aboveRadio.setAttribute('data-value', 'above');

            aboveOption.createEl('label', {
                text: 'Position new properties above existing ones',
                attr: { for: 'position-above' }
            });

            // Option 3: Remove others - custom radio
            const removeOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const removeRadioContainer = this.createCustomRadio(false, 'positioning', 'yaml-position-radio');
            removeOption.appendChild(removeRadioContainer);
            const removeRadio = removeRadioContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
            removeRadio.setAttribute('id', 'remove-others');
            removeRadio.setAttribute('role', 'radio');
            removeRadio.setAttribute('aria-checked', 'false');
            removeRadio.setAttribute('tabindex', '0');
            removeRadio.setAttribute('data-value', 'remove');

            removeOption.createEl('label', {
                text: 'Remove properties not in template',
                attr: { for: 'remove-others' }
            });

            // Add event listeners for the radio buttons
            belowRadio.addEventListener('click', () => {
                this.setRadioSelection(belowRadio);
                this.propertyPositioning = 'below';
                
                // Add a visual indication for the selected option
                belowOption.addClass('yaml-position-option--selected');
                aboveOption.removeClass('yaml-position-option--selected');
                removeOption.removeClass('yaml-position-option--selected');
            });

            aboveRadio.addEventListener('click', () => {
                this.setRadioSelection(aboveRadio);
                this.propertyPositioning = 'above';
                
                // Add a visual indication for the selected option
                belowOption.removeClass('yaml-position-option--selected');
                aboveOption.addClass('yaml-position-option--selected');
                removeOption.removeClass('yaml-position-option--selected');
            });

            removeRadio.addEventListener('click', () => {
                this.setRadioSelection(removeRadio);
                this.propertyPositioning = 'remove';
                
                // Add a visual indication for the selected option
                belowOption.removeClass('yaml-position-option--selected');
                aboveOption.removeClass('yaml-position-option--selected');
                removeOption.addClass('yaml-position-option--selected');
            });

            // Set initial selected state based on propertyPositioning
            if (this.propertyPositioning === 'below') {
                belowOption.addClass('yaml-position-option--selected');
            } else if (this.propertyPositioning === 'above') {
                aboveOption.addClass('yaml-position-option--selected');
            } else if (this.propertyPositioning === 'remove') {
                removeOption.addClass('yaml-position-option--selected');
            }

            // Initialize the selected state
            belowOption.addClass('yaml-position-option--selected');

            // Set default value
            this.propertyPositioning = 'below';
        }

        // Add informational message about value checkboxes
        const valueInfoContainer = contentEl.createDiv({
            cls: 'yaml-direct-path-container yaml-preserve-info-container'
        });

        // Add the info text
        valueInfoContainer.createSpan({
            text: 'Check property value to use template value (unchecked preserves existing value).',
            cls: 'yaml-direct-path-text'
        });

        // Check initial state of Select All checkbox to set visibility
        const infoSelectAllCheckbox = document.getElementById('select-all-properties');
        if (infoSelectAllCheckbox && infoSelectAllCheckbox.hasClass('is-checked')) {
            valueInfoContainer.addClass('yaml-element--hidden');
        }
        
        if (selectAllContainer) {
            selectAllContainer.removeClass('yaml-element--hidden');
        }
        
        if (overrideAllContainer) {
            overrideAllContainer.removeClass('yaml-element--hidden');
        }
        
        // Add to loadTemplateProperties method after showing the option containers
        const mainSelectAllCheckbox = selectAllContainer?.querySelector('.yaml-custom-checkbox') as HTMLElement;
        if (mainSelectAllCheckbox) {
            // Enable/disable secondary options based on initial Select All state
            if (!mainSelectAllCheckbox.hasClass('is-checked')) {
                if (overrideAllContainer) {
                    overrideAllContainer.addClass('yaml-select-all--disabled');
                }
            }
        }
        
        // Load properties from template
        const properties = await this.plugin.parseFileProperties(this.selectedTemplate);
        const propertyKeys = Object.keys(properties);
        
        // Clear any existing property items
        contentEl.querySelectorAll('.yaml-properties-list').forEach(el => el.remove());
        
        if (propertyKeys.length === 0) {
            const emptyContainer = contentEl.createDiv({ cls: 'yaml-empty-state-container' });
            
            // Add info icon
            const emptyIcon = emptyContainer.createDiv({ cls: 'yaml-empty-state-icon' });
            emptyIcon.innerHTML = this.getSvgIcon('info');
            
            // Add title and message
            emptyContainer.createEl('h4', { 
                text: 'No Properties Found',
                cls: 'yaml-empty-state-title'
            });
            
            emptyContainer.createEl('p', { 
                text: 'The selected template file does not have any YAML properties in its frontmatter.',
                cls: 'yaml-empty-state-message'
            });
            
            return;
        }
        
        // Create a separate properties list area directly in the content
        const propertiesList = contentEl.createDiv({ cls: 'yaml-properties-list' });
        
        // Create elements for each property
        for (const key of propertyKeys) {
            const value = properties[key];
            
            // Create property item directly in properties list
            const propertyItem = propertiesList.createDiv({ cls: 'yaml-property-item' });

            // Create property header with checkbox and name
            const propertyHeader = propertyItem.createDiv({ cls: 'yaml-property-header' });

            // Include checkbox
            const includeCustomCheckbox = this.createCustomCheckbox(false, 'yaml-property-include-checkbox');
            propertyHeader.appendChild(includeCustomCheckbox);
            const includeCheckbox = includeCustomCheckbox.querySelector('.yaml-custom-checkbox') as HTMLElement;
            includeCheckbox.setAttribute('id', `include-${key}`);
            includeCheckbox.setAttribute('role', 'checkbox');
            includeCheckbox.setAttribute('aria-checked', 'false');
            includeCheckbox.setAttribute('tabindex', '0');

            // Property name (bold)
            propertyHeader.createEl('span', { 
                text: key, 
                cls: 'yaml-property-name' 
            });

            // Detect property type based on value
            // Detect property type using unified system
            const obsidianType = this.plugin.propertyTypeService.getValuePropertyType(key, value);
            const internalType = this.plugin.getInternalPropertyType(key, value);
            const typeDisplayName = this.plugin.propertyTypeService.getPropertyTypeDisplayName(internalType);

            // Property type box FIRST
            const typeBox = propertyItem.createDiv({ cls: 'yaml-property-type-box' });

            // Create type info container
            const typeInfoContainer = typeBox.createDiv({ cls: 'yaml-property-type-info' });

            // Type text - simple format
            typeInfoContainer.createSpan({ 
                text: `Type: ${typeDisplayName}`, 
                cls: 'yaml-property-type-text' 
            });

            // Special handling for list type - show count and add toggle button if needed
            if (internalType === "list" && Array.isArray(value)) {
                // Only show array count for arrays with 3 or fewer items
                if (value.length <= 3) {
                    typeInfoContainer.createSpan({
                        text: ` ${value.length} ${value.length === 1 ? 'item' : 'items'}`, 
                        cls: 'yaml-property-array-count'
                    });
                } 
                // Only add toggle and "more" indicator for arrays with more than 3 items
                else if (value.length > 3) {
                    // Create a container for the right side elements
                    const rightSideControls = typeBox.createDiv({ cls: 'yaml-property-type-controls' });
                    
                    // Add the "X more" text first
                    rightSideControls.createSpan({
                        text: `${value.length - 3} more`,
                        cls: 'yaml-property-array-more-count'
                    });
                    
                    // Then add toggle button
                    const toggleButton = rightSideControls.createEl('button', {
                        cls: 'yaml-property-toggle-button',
                        attr: { 
                            id: `toggle-${key}`,
                            'aria-label': 'Toggle array items',
                            'aria-expanded': 'false'
                        }
                    });
                    
                    // Use a consistent chevron-down icon that we'll rotate with CSS
                    toggleButton.innerHTML = this.getSvgIcon('chevron-down').replace('width="18"', 'width="14"').replace('height="18"', 'height="14"');
                    
                    // Add event listener for toggle
                    toggleButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isExpanding = !propertyItem.classList.contains('yaml-property-item--expanded');
                        propertyItem.classList.toggle('yaml-property-item--expanded');
                        
                        // Set the appropriate aria-expanded state
                        toggleButton.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
                        
                        // Instead of changing the icon, we'll add/remove a class to rotate it
                        if (isExpanding) {
                            toggleButton.addClass('yaml-property-toggle-button--expanded');
                        } else {
                            toggleButton.removeClass('yaml-property-toggle-button--expanded');
                        }
                    });
                }
            }

            // Property value box SECOND
            const valueBox = propertyItem.createDiv({ cls: 'yaml-property-value-box' });

            // Value checkbox - custom implementation
            const valueCustomCheckbox = this.createCustomCheckbox(false, 'yaml-property-value-checkbox');
            valueBox.appendChild(valueCustomCheckbox);
            const valueCheckbox = valueCustomCheckbox.querySelector('.yaml-custom-checkbox') as HTMLElement;
            valueCheckbox.setAttribute('id', `override-value-${key}`);
            valueCheckbox.setAttribute('role', 'checkbox');
            valueCheckbox.setAttribute('aria-checked', 'false');
            valueCheckbox.setAttribute('tabindex', '0');
            valueCheckbox.setAttribute('title', 'Check to use template value (unchecked preserves existing value)');

            // Set initial disabled state
            if (!includeCheckbox.hasClass('is-checked')) {
                valueCheckbox.addClass('is-disabled');
            }

            if (Array.isArray(value)) {
                // Create container for array items directly in the value box
                const arrayItemsContainer = valueBox.createDiv({ cls: 'yaml-property-array-items' });
                
                // Add all array items horizontally without numbering
                value.forEach((item, index) => {
                    // Format the display value
                    let displayValue = String(item);
                    const itemEl = arrayItemsContainer.createEl('div', {
                        cls: 'yaml-property-array-item'
                    });
                    
                    // Items beyond the third one get the expanded class
                    if (index >= 3) {
                        itemEl.addClass('yaml-property-array-item--expanded');
                    }
                    
                    // Handle different types of array items
                    if (typeof item === 'string') {
                        // Check if it's a file link [[file]]
                        const fileMatch = item.match(/^\[\[(.+?)\]\]$/);
                        if (fileMatch) {
                            // This is a file link
                            itemEl.addClass('yaml-property-array-item--clickable');
                            itemEl.textContent = fileMatch[1];
                            
                            const fileName = fileMatch[1];
                            const file = this.app.metadataCache.getFirstLinkpathDest(fileName, '');
                            
                            if (file) {
                                if (file.extension === 'md') {
                                    itemEl.setAttribute('data-link-type', 'markdown');
                                } else {
                                    itemEl.setAttribute('data-link-type', 'file');
                                }
                            } else {
                                // File not found but still a link
                                itemEl.setAttribute('data-link-type', 'markdown');
                            }
                            
                            // Make it clickable
                            itemEl.addEventListener('click', (event) => {
                                event.preventDefault();
                                const file = this.app.metadataCache.getFirstLinkpathDest(fileName, '');
                                
                                if (file) {
                                    if (file.extension === 'md') {
                                        // It's a markdown file - open in Obsidian
                                        const leaf = this.app.workspace.getLeaf('window');
                                        leaf.openFile(file);
                                    } else {
                                        // For non-markdown files
                                        // Get the URL for the file - this works for both desktop and mobile
                                        const fileUrl = this.app.vault.getResourcePath(file);
                                        
                                        // Open the URL - this will use the appropriate system handler
                                        window.open(fileUrl, '_blank');
                                    }
                                }
                            });
                        } else if (item.startsWith('http://') || item.startsWith('https://')) {
                            // External URL
                            itemEl.addClass('yaml-property-array-item--clickable');
                            itemEl.textContent = item;
                            itemEl.setAttribute('data-link-type', 'external');
                            
                            // Make it clickable to open in browser
                            itemEl.addEventListener('click', (event) => {
                                event.preventDefault();
                                window.open(item, '_blank', 'noopener,noreferrer');
                            });
                        } else {
                            // Regular string with quotation cleanup
                            displayValue = displayValue.replace(/^["'](.*)["']$/, '$1');
                            if (displayValue.length > 40) {
                                displayValue = displayValue.substring(0, 37) + '...';
                            }
                            itemEl.textContent = displayValue;
                        }
                    } else {
                        // For non-string items
                        itemEl.textContent = displayValue;
                    }
                });
            } else {
                // Check if value is empty
                const isEmpty = value === null || value === undefined || value === '' || 
                               (typeof value === 'object' && Object.keys(value).length === 0);
                
                if (isEmpty) {
                    // Display "No value" text for empty values
                    valueBox.createEl('span', { 
                        text: 'No value', 
                        cls: 'yaml-property-empty-value' 
                    });
                } else {
                    // Original implementation for non-empty values
                    valueBox.createEl('span', { 
                        text: formatValuePreview(value), 
                        cls: 'yaml-property-value-text' 
                    });
                }
            }
            
            includeCheckbox.addEventListener('click', () => {
                const isCurrentlyChecked = includeCheckbox.hasClass('is-checked');
                
                if (!isCurrentlyChecked) {
                    // Update to checked state
                    this.updateCheckboxState(includeCheckbox, 'checked');
                    includeCheckbox.setAttribute('aria-checked', 'true');
                    
                    // Add to selected properties
                    if (!this.selectedProperties.includes(key)) {
                        this.selectedProperties.push(key);
                    }
                    
                    // Enable value checkbox
                    valueCheckbox.removeClass('is-disabled');
                    
                    // Apply global settings 
                    if (this.overrideAllValues) {
                        this.updateCheckboxState(valueCheckbox, 'checked');
                        valueCheckbox.setAttribute('aria-checked', 'true');
                        
                        if (!this.overrideValueProperties.includes(key)) {
                            this.overrideValueProperties.push(key);
                        }
                    } else {
                        this.updateCheckboxState(valueCheckbox, 'unchecked');
                        valueCheckbox.setAttribute('aria-checked', 'false');
                    }
                } else {
                    // Update to unchecked state
                    this.updateCheckboxState(includeCheckbox, 'unchecked');
                    includeCheckbox.setAttribute('aria-checked', 'false');
                    
                    // Remove from selected properties
                    this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                    
                    // Remove from override values and disable checkbox
                    this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                    this.updateCheckboxState(valueCheckbox, 'unchecked');
                    valueCheckbox.setAttribute('aria-checked', 'false');
                    valueCheckbox.addClass('is-disabled');
                    
                    // Auto-deselect the "Select All Properties" checkbox
                    const selectAllCheckbox = document.getElementById('select-all-properties');
                    if (selectAllCheckbox && selectAllCheckbox.hasClass('is-checked')) {
                        this.updateCheckboxState(selectAllCheckbox, 'unchecked');
                        selectAllCheckbox.setAttribute('aria-checked', 'false');
                    }
                }
                
                // Check if all property checkboxes are checked
                const allPropertyCheckboxes = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-include-checkbox');
                const allPropsChecked = Array.from(allPropertyCheckboxes).every((checkbox: HTMLElement) => checkbox.hasClass('is-checked'));

                // Update the "Select All Properties" checkbox state
                const selectAllCheckbox = document.getElementById('select-all-properties');
                if (selectAllCheckbox) {
                    if (allPropsChecked && !selectAllCheckbox.hasClass('is-checked')) {
                        this.updateCheckboxState(selectAllCheckbox, 'checked');
                        selectAllCheckbox.setAttribute('aria-checked', 'true');
                    } else if (!allPropsChecked && selectAllCheckbox.hasClass('is-checked')) {
                        this.updateCheckboxState(selectAllCheckbox, 'unchecked');
                        selectAllCheckbox.setAttribute('aria-checked', 'false');
                    }
                }
                
                // Update apply button state
                const applyButton = this.contentEl.querySelector('button.mod-cta') as HTMLButtonElement;
                const validationMessage = document.getElementById('validation-message');
            
                if (applyButton) {
                    const hasSelectedProperties = this.selectedProperties.length > 0;
                    applyButton.disabled = !hasSelectedProperties;
                    
                    if (hasSelectedProperties) {
                        // Hide validation message if we have properties selected
                        if (validationMessage) {
                            validationMessage.addClass('yaml-validation-message--hidden');
                        }
                    } else {
                        // Show validation message if we have no properties selected
                        if (validationMessage) {
                            const validationText = validationMessage.querySelector('.yaml-validation-text');
                            if (validationText) {
                                validationText.textContent = 'Select at least one property to apply changes.';
                            }
                            validationMessage.removeClass('yaml-validation-message--hidden');
                        }
                    }
                }
            });
            
            // Event handler for the value checkbox
            valueCheckbox.addEventListener('click', () => {
                // Skip if disabled
                if (valueCheckbox.hasClass('is-disabled')) {
                    return;
                }
                
                const isCurrentlyChecked = valueCheckbox.hasClass('is-checked');
                
                if (!isCurrentlyChecked) {
                    // Update to checked state
                    this.updateCheckboxState(valueCheckbox, 'checked');
                    valueCheckbox.setAttribute('aria-checked', 'true');
                    
                    // Add to override values properties (use template value)
                    if (!this.overrideValueProperties.includes(key)) {
                        this.overrideValueProperties.push(key);
                    }
                } else {
                    // Update to unchecked state
                    this.updateCheckboxState(valueCheckbox, 'unchecked');
                    valueCheckbox.setAttribute('aria-checked', 'false');
                    
                    // Remove from override values properties (preserve existing value)
                    this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                    
                    // If any checkbox is unchecked, uncheck and update the "Override All Values" checkbox
                    const overrideAllCheckbox = document.getElementById('override-all-values');
                    const overrideAllContainer = document.getElementById('override-all-container');
                    
                    if (overrideAllCheckbox && overrideAllCheckbox.hasClass('is-checked')) {
                        this.updateCheckboxState(overrideAllCheckbox, 'unchecked');
                        overrideAllCheckbox.setAttribute('aria-checked', 'false');
                        this.overrideAllValues = false;
                        
                        if (overrideAllContainer) {
                            overrideAllContainer.removeClass('active');
                        }
                    }
                }
                
                // Check if all enabled value checkboxes are checked
                const allEnabled = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-value-checkbox:not(.is-disabled)');
                const allChecked = Array.from(allEnabled).every((checkbox: HTMLElement) => checkbox.hasClass('is-checked'));
                
                // Update the "override all" visual state and checkbox state
                const overrideAllContainer = document.getElementById('override-all-container');
                const overrideAllCheckbox = document.getElementById('override-all-values');
                if (overrideAllContainer && overrideAllCheckbox) {
                    if (allChecked) {
                        overrideAllContainer.addClass('active');
                        
                        // Also update the checkbox state if it's not already checked
                        if (!overrideAllCheckbox.hasClass('is-checked') && !overrideAllCheckbox.hasClass('is-disabled')) {
                            this.updateCheckboxState(overrideAllCheckbox, 'checked');
                            overrideAllCheckbox.setAttribute('aria-checked', 'true');
                            this.overrideAllValues = true;
                        }
                    } else {
                        overrideAllContainer.removeClass('active');
                        
                        // Also update the checkbox state if it's currently checked
                        if (overrideAllCheckbox.hasClass('is-checked')) {
                            this.updateCheckboxState(overrideAllCheckbox, 'unchecked');
                            overrideAllCheckbox.setAttribute('aria-checked', 'false');
                            this.overrideAllValues = false;
                        }
                    }
                }
            });
        }
        
        // "select all" checkbox handler to work with the new structure
        if (mainSelectAllCheckbox) {
            mainSelectAllCheckbox.addEventListener('click', () => {
                const isCurrentlyChecked = mainSelectAllCheckbox.hasClass('is-checked');
                const newState = !isCurrentlyChecked;
                
                // Update this checkbox state
                this.updateCheckboxState(mainSelectAllCheckbox, newState ? 'checked' : 'unchecked');
                mainSelectAllCheckbox.setAttribute('aria-checked', newState.toString());
                
                // Find all property include checkboxes
                const checkboxes = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-include-checkbox');
                
                // Only change checkboxes that need to be changed
                checkboxes.forEach((checkbox: HTMLElement) => {
                    const checkboxIsChecked = checkbox.hasClass('is-checked');
                    
                    // Only dispatch a click if we need to change state
                    if (checkboxIsChecked !== newState) {
                        // Let the click handler handle the state change
                        const clickEvent = new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        });
                        checkbox.dispatchEvent(clickEvent);
                    }
                });
                
                // Toggle value info message visibility
                const valueInfoContainer = this.contentEl.querySelector('.yaml-preserve-info-container');
                if (valueInfoContainer) {
                    if (newState) {
                        valueInfoContainer.addClass('yaml-element--hidden');
                    } else {
                        valueInfoContainer.removeClass('yaml-element--hidden');
                    }
                }
                
                // Enable/disable secondary options based on Select All state
                if (overrideAllContainer) {
                    if (newState) {
                        overrideAllContainer.removeClass('yaml-select-all--disabled');
                        
                        // Get override all checkbox and enable it
                        const overrideAllCheckbox = overrideAllContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
                        if (overrideAllCheckbox) {
                            overrideAllCheckbox.removeClass('is-disabled');
                        }
                    } else {
                        overrideAllContainer.addClass('yaml-select-all--disabled');
                        
                        // Get override all checkbox, uncheck and disable it
                        const overrideAllCheckbox = overrideAllContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
                        if (overrideAllCheckbox) {
                            this.updateCheckboxState(overrideAllCheckbox, 'unchecked');
                            overrideAllCheckbox.setAttribute('aria-checked', 'false');
                            overrideAllCheckbox.addClass('is-disabled');
                            this.overrideAllValues = false;
                            
                            // Reset all value checkboxes
                            const valueCheckboxes = this.contentEl.querySelectorAll('.yaml-custom-checkbox.yaml-property-value-checkbox:not(.is-disabled)');
                            valueCheckboxes.forEach((checkbox: HTMLElement) => {
                                this.updateCheckboxState(checkbox, 'unchecked');
                                checkbox.setAttribute('aria-checked', 'false');
                            });
                        }
                    }
                }
            });
        }
        
        // Enable apply button
        const applyButton = this.modalEl.querySelector('button.mod-cta') as HTMLButtonElement;
        if (applyButton) {
            applyButton.disabled = this.selectedProperties.length === 0;
        }
    }
    
    async applyTemplateToFilesWithPreservation(
    templateFile: TFile, 
    targetFiles: TFile[],
    propertiesToApply: string[], 
    overrideValueProperties: string[],
    overrideAllValues: boolean
) {
    try {
        // Get template properties
        const templateProperties = await this.plugin.parseFileProperties(templateFile);
        const templatePropertiesWithType = this.plugin.propertyCache.get(templateFile.path) || this.plugin.propertyTypeService.preservePropertyTypes(templateProperties);
        
        // Filter to only include specified properties
        const filteredProperties: Record<string, any> = {};
        const filteredPropertiesWithType: Record<string, PropertyWithType> = {};
        
        for (const key of propertiesToApply) {
            if (key in templateProperties) {
                filteredProperties[key] = templateProperties[key];
                filteredPropertiesWithType[key] = templatePropertiesWithType[key];
            }
        }
        
        // Apply to each target file
        let successCount = 0;
        for (const file of targetFiles) {
            // Skip the template file itself if it's in the target list
            if (file.path === templateFile.path) continue;
            
            // Get existing properties with type information
            const existingProperties = await this.plugin.parseFileProperties(file);
            const existingPropertiesWithType = this.plugin.propertyCache.get(file.path) || this.plugin.propertyTypeService.preservePropertyTypes(existingProperties);
            
            // Create properties to apply based on positioning option
            let propertiesToApplyToFile: Record<string, PropertyWithType> = {};
            
            // Handle based on positioning option
            switch (this.propertyPositioning) {
                case 'above':
                    // Start with template properties
                    propertiesToApplyToFile = { ...filteredPropertiesWithType };
                    
                    // Add existing properties that aren't in the template
                    for (const prop in existingPropertiesWithType) {
                        if (!propertiesToApply.includes(prop)) {
                            propertiesToApplyToFile[prop] = existingPropertiesWithType[prop];
                        }
                    }
                    break;
                    
                case 'below':
                    // Start with existing properties that aren't in the template
                    for (const prop in existingPropertiesWithType) {
                        if (!propertiesToApply.includes(prop)) {
                            propertiesToApplyToFile[prop] = existingPropertiesWithType[prop];
                        }
                    }
                    
                    // Add template properties
                    propertiesToApplyToFile = { 
                        ...propertiesToApplyToFile,
                        ...filteredPropertiesWithType 
                    };
                    break;
                    
                case 'remove':
                    // Only include properties from the template
                    propertiesToApplyToFile = { ...filteredPropertiesWithType };
                    break;
                    
                default:
                    // Default to 'below' behavior
                    for (const prop in existingPropertiesWithType) {
                        if (!propertiesToApply.includes(prop)) {
                            propertiesToApplyToFile[prop] = existingPropertiesWithType[prop];
                        }
                    }
                    propertiesToApplyToFile = { 
                        ...propertiesToApplyToFile,
                        ...filteredPropertiesWithType 
                    };
            }
            
            // Handle property value preservation
            for (const prop of propertiesToApply) {
                const shouldUseTemplateValue = 
                    overrideAllValues || 
                    overrideValueProperties.includes(prop);
                
                if (!shouldUseTemplateValue && prop in existingPropertiesWithType) {
                    // Preserve existing value with type information
                    propertiesToApplyToFile[prop] = existingPropertiesWithType[prop];
                }
            }
            
            // Convert back to regular properties with preserved types
            const finalProperties = this.plugin.propertyTypeService.restorePropertyValues(propertiesToApplyToFile);
            
            // Apply the properties
            const success = await this.plugin.applyProperties(file, finalProperties, false);
            if (success) successCount++;
        }
        
        new Notice(`Applied template to ${successCount} of ${targetFiles.length} ${targetFiles.length === 1 ? 'file' : 'files'}`);
        return successCount;
    } catch (error) {
        console.error('Error applying template:', error);
        new Notice(`Error applying template: ${error.message}`);
        return 0;
    }
}

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}