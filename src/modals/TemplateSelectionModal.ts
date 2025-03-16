import { App, Modal, Notice, TFile, TextComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { TemplateNode } from '../models/interfaces';
import { formatValuePreview } from '../utils/helpers';
import { 
    detectPropertyType, 
    getPropertyTypeDisplayName,
    PropertyWithType,
    preservePropertyTypes,
    restorePropertyValues 
} from '../utils/propertyTypes';

export class TemplateSelectionModal extends Modal {
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

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__template-selection');
        
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
        
        // Add search bar with proper Obsidian styling
        const searchContainer = contentEl.createDiv({ cls: 'yaml-search-container' });
        
        // Create the input element directly rather than using TextComponent
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            cls: 'search-input',
            attr: {
                placeholder: 'Search templates...'
            }
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
        
        // Add hint text below search box
        const hintText = searchContainer.createEl('p', { 
            text: 'Select a template file to view and choose properties. Use spaces for AND search (e.g., "dog cat" finds files containing both terms)',
            cls: 'yaml-hint-text'
        });
        
        // Template results container
        const templateResultsContainer = contentEl.createDiv({ cls: 'yaml-template-results' });
        
        // If no templates found
        if (this.allTemplates.length === 0) {
            templateResultsContainer.createEl('p', { 
                text: 'No template files found. Configure template files or directories in settings.',
                cls: 'yaml-message--no-templates'
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
        validationIcon.textContent = '⚠️'; // Warning icon
        
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
        const selectAllCheckbox = selectAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'select-all-properties' },
            cls: 'yaml-select-all__checkbox'
        });

        selectAllContainer.createEl('label', {
            text: 'Select All Properties',
            attr: { for: 'select-all-properties' }
        });

        // 4. Create "Override All Values" checkbox container (initially hidden)
        const overrideAllContainer = contentEl.createDiv({ 
            cls: 'yaml-select-all yaml-select-all--secondary yaml-element--hidden yaml-select-all--disabled',
            attr: { id: 'override-all-container' }
        });
        const overrideAllCheckbox = overrideAllContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'override-all-values' },
            cls: 'yaml-select-all__checkbox'
        });

        overrideAllContainer.createEl('label', {
            text: 'Override All Values (use template values instead of existing)',
            attr: { for: 'override-all-values' }
        });

        // Add event listener to Override All checkbox
        overrideAllCheckbox.addEventListener('change', () => {
            // Update class state
            this.overrideAllValues = overrideAllCheckbox.checked;
            
            if (overrideAllCheckbox.checked) {
                // Add visual indication that this option is active
                overrideAllContainer.addClass('active');
                
                // Update all individual value checkboxes
                const valueCheckboxes = contentEl.querySelectorAll('.yaml-property-preserve-checkbox:not([disabled])');
                valueCheckboxes.forEach((checkbox: HTMLInputElement) => {
                    checkbox.checked = true; // Check to use template values
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                });
            } else {
                overrideAllContainer.removeClass('active');
                
                // Uncheck all individual value checkboxes
                const valueCheckboxes = contentEl.querySelectorAll('.yaml-property-preserve-checkbox:not([disabled])');
                valueCheckboxes.forEach((checkbox: HTMLInputElement) => {
                    checkbox.checked = false; // Uncheck to preserve existing values
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                });
            }
        });
        
        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container' });

        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Template', 
            cls: 'yaml-button yaml-button--apply'
        });
        
        applyButton.disabled = true;
        applyButton.addClass('yaml-button--disabled');
        
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
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
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
            container.createEl('p', { 
                text: 'No matching templates found', 
                cls: 'yaml-message--no-templates' 
            });
            return;
        }
        
        // Create results list
        const resultsList = container.createDiv({ cls: 'yaml-template-list' });
        
        // Create element for each template in search results
        for (const file of this.searchResults) {
            // Create a template item container
            const templateItem = resultsList.createDiv({ cls: 'yaml-template-item' });
            
            // Create radio button
            const radioBtn = templateItem.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'template',
                    value: file.path,
                    id: `template-${file.path.replace(/\//g, '-')}`
                },
                cls: 'yaml-template-radio'
            });
            
            // Add file icon
            const fileIcon = templateItem.createSpan({ cls: 'yaml-template-icon' });
            fileIcon.textContent = '📄 ';
            
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
            
            // Handle selection
            radioBtn.addEventListener('change', () => {
                if (radioBtn.checked) {
                    this.selectedTemplate = file;
                    
                    // Hide the validation message when a template is selected
                    const validationMessage = document.getElementById('validation-message');
                    if (validationMessage) {
                        validationMessage.addClass('yaml-validation-message--hidden');
                    }
                    
                    this.loadTemplateProperties();
                }
            });
            
            // Make whole item clickable
            templateItem.addEventListener('click', (e) => {
                if (e.target !== radioBtn) {
                    radioBtn.checked = true;
                    this.selectedTemplate = file;
                    
                    // Hide the validation message when a template is selected
                    const validationMessage = document.getElementById('validation-message');
                    if (validationMessage) {
                        validationMessage.addClass('yaml-validation-message--hidden');
                    }
                    
                    this.loadTemplateProperties();
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
            // Create header for positioning options (h4)
            const positioningHeader = contentEl.createEl('h4', {
                text: 'Property Positioning Options',
                cls: 'yaml-options-header'
            });

            // Position after the override container
            overrideAllContainer.after(positioningHeader);

            // Create options container with similar styling to select-all containers
            const positioningOptions = contentEl.createDiv({
                cls: 'yaml-positioning-options'
            });

            // Position after the header
            positioningHeader.after(positioningOptions);

            // Option 1: Position below
            const belowOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const belowRadio = belowOption.createEl('input', {
                type: 'radio',
                attr: { 
                    name: 'positioning',
                    id: 'position-below',
                    checked: true
                },
                cls: 'yaml-select-all__checkbox'
            });
            belowOption.createEl('label', {
                text: 'Position new properties below existing ones',
                attr: { for: 'position-below' }
            });

            // Option 2: Position above
            const aboveOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const aboveRadio = aboveOption.createEl('input', {
                type: 'radio',
                attr: { 
                    name: 'positioning',
                    id: 'position-above'
                },
                cls: 'yaml-select-all__checkbox'
            });
            aboveOption.createEl('label', {
                text: 'Position new properties above existing ones',
                attr: { for: 'position-above' }
            });

            // Option 3: Remove others
            const removeOption = positioningOptions.createDiv({ cls: 'yaml-select-all yaml-position-option' });
            const removeRadio = removeOption.createEl('input', {
                type: 'radio',
                attr: { 
                    name: 'positioning',
                    id: 'remove-others'
                },
                cls: 'yaml-select-all__checkbox'
            });
            removeOption.createEl('label', {
                text: 'Remove properties not in template',
                attr: { for: 'remove-others' }
            });

            // Store the selected positioning option in a class property
            belowRadio.addEventListener('change', () => {
                if (belowRadio.checked) {
                    this.propertyPositioning = 'below';
                    
                    // Add a visual indication for the selected option
                    belowOption.addClass('yaml-position-option--selected');
                    aboveOption.removeClass('yaml-position-option--selected');
                    removeOption.removeClass('yaml-position-option--selected');
                }
            });

            aboveRadio.addEventListener('change', () => {
                if (aboveRadio.checked) {
                    this.propertyPositioning = 'above';
                    
                    // Add a visual indication for the selected option
                    belowOption.removeClass('yaml-position-option--selected');
                    aboveOption.addClass('yaml-position-option--selected');
                    removeOption.removeClass('yaml-position-option--selected');
                }
            });

            removeRadio.addEventListener('change', () => {
                if (removeRadio.checked) {
                    this.propertyPositioning = 'remove';
                    
                    // Add a visual indication for the selected option
                    belowOption.removeClass('yaml-position-option--selected');
                    aboveOption.removeClass('yaml-position-option--selected');
                    removeOption.addClass('yaml-position-option--selected');
                }
            });

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
        const infoSelectAllCheckbox = document.getElementById('select-all-properties') as HTMLInputElement;
        if (infoSelectAllCheckbox && infoSelectAllCheckbox.checked) {
            valueInfoContainer.addClass('yaml-element--hidden');
        }
        
        if (selectAllContainer) {
            selectAllContainer.removeClass('yaml-element--hidden');
        }
        
        if (overrideAllContainer) {
            overrideAllContainer.removeClass('yaml-element--hidden');
        }
        
        // Add to loadTemplateProperties method after showing the option containers
        const mainSelectAllCheckbox = selectAllContainer?.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (mainSelectAllCheckbox) {
            // Enable/disable secondary options based on initial Select All state
            if (!mainSelectAllCheckbox.checked) {
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
            // Add message directly to content element
            contentEl.createEl('p', { 
                text: 'The selected template file does not have any properties.',
                cls: 'yaml-hint-text'
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
            const includeCheckboxContainer = propertyHeader.createDiv({ cls: 'yaml-property-item__include' });
            const includeCheckbox = includeCheckboxContainer.createEl('input', {
                type: 'checkbox',
                attr: { id: `include-${key}` }
            });

            // Property name (bold)
            propertyHeader.createEl('span', { 
                text: key, 
                cls: 'yaml-property-name' 
            });

            // Detect property type based on value
            const propertyType = detectPropertyType(value);
            const typeDisplayName = getPropertyTypeDisplayName(propertyType);

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
            if (propertyType === "list" && Array.isArray(value)) {
                // Add count next to type
                typeInfoContainer.createSpan({
                    text: ` (${value.length} ${value.length === 1 ? 'item' : 'items'})`, 
                    cls: 'yaml-property-array-count'
                });
                
                // Only add toggle for arrays with more than 3 items
                if (value.length > 3) {
                    const toggleButton = typeBox.createEl('button', {
                        cls: 'yaml-property-toggle-button',
                        attr: { 
                            id: `toggle-${key}`,
                            'aria-label': 'Toggle array items'
                        }
                    });
                    toggleButton.innerHTML = '▼'; // Down arrow icon
                    
                    // Add event listener for toggle
                    toggleButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        propertyItem.classList.toggle('yaml-property-item--expanded');
                        toggleButton.innerHTML = propertyItem.classList.contains('yaml-property-item--expanded') ? '▲' : '▼';
                    });
                }
            }

            // Property value box SECOND
            const valueBox = propertyItem.createDiv({ cls: 'yaml-property-value-box' });

            // Value override checkbox (previously called "preserve" checkbox)
            const valueCheckbox = valueBox.createEl('input', {
                type: 'checkbox',
                attr: { 
                    id: `override-value-${key}`,
                    disabled: !includeCheckbox.checked,
                    title: 'Check to use template value (unchecked preserves existing value)'
                },
                cls: 'yaml-property-preserve-checkbox' // Keep CSS class for compatibility
            });

            if (Array.isArray(value)) {
                // Create container for array items directly in the value box
                const arrayItemsContainer = valueBox.createDiv({ cls: 'yaml-property-array-items' });
                
                // Add all array items
                value.forEach((item, index) => {
                    // Format the display value
                    let displayValue = String(item);
                    if (typeof item === 'string') {
                        displayValue = displayValue.replace(/^["'](.*)["']$/, '$1');
                        if (displayValue.length > 40) {
                            displayValue = displayValue.substring(0, 37) + '...';
                        }
                    }
                    
                    const itemEl = arrayItemsContainer.createEl('div', {
                        text: `${index + 1}. ${displayValue}`,
                        cls: 'yaml-property-array-item'
                    });
                    
                    // Items beyond the third one get the expanded class
                    if (index >= 3) {
                        itemEl.addClass('yaml-property-array-item--expanded');
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
            
            // Set initial checkbox state based on global settings
            if (this.overrideAllValues) {
                valueCheckbox.checked = true;
            } else {
                valueCheckbox.checked = false;
            }
            
            // Event handlers for include checkbox
            includeCheckbox.addEventListener('change', () => {
                if (includeCheckbox.checked) {
                    // Add to selected properties
                    if (!this.selectedProperties.includes(key)) {
                        this.selectedProperties.push(key);
                    }
                    // Enable value checkbox
                    valueCheckbox.disabled = false;
                    
                    // Apply global settings 
                    if (this.overrideAllValues) {
                        valueCheckbox.checked = true;
                    } else {
                        valueCheckbox.checked = false;
                    }
                } else {
                    // Remove from selected properties
                    this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                    // Remove from override values and disable checkbox
                    this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                    valueCheckbox.checked = false;
                    valueCheckbox.disabled = true;
                }
                
                // Update apply button state
                const applyButton = this.contentEl.querySelector('.yaml-button--apply') as HTMLButtonElement;
                const validationMessage = document.getElementById('validation-message');

                if (applyButton) {
                    const hasSelectedProperties = this.selectedProperties.length > 0;
                    applyButton.disabled = !hasSelectedProperties;
                    
                    if (hasSelectedProperties) {
                        applyButton.removeClass('yaml-button--disabled');
                        
                        // Hide validation message if we have properties selected
                        if (validationMessage) {
                            validationMessage.addClass('yaml-validation-message--hidden');
                        }
                    } else {
                        applyButton.addClass('yaml-button--disabled');
                        
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
            valueCheckbox.addEventListener('change', () => {
                if (valueCheckbox.checked) {
                    // Add to override values properties (use template value)
                    if (!this.overrideValueProperties.includes(key)) {
                        this.overrideValueProperties.push(key);
                    }
                } else {
                    // Remove from override values properties (preserve existing value)
                    this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                    
                    // If any checkbox is unchecked, uncheck and update the "Override All Values" checkbox
                    const overrideAllCheckbox = document.getElementById('override-all-values') as HTMLInputElement;
                    const overrideAllContainer = document.getElementById('override-all-container');
                    
                    if (overrideAllCheckbox && overrideAllCheckbox.checked) {
                        overrideAllCheckbox.checked = false;
                        this.overrideAllValues = false;
                        
                        if (overrideAllContainer) {
                            overrideAllContainer.removeClass('active');
                        }
                    }
                }
                
                // Check if all enabled value checkboxes are checked
                const allEnabled = this.contentEl.querySelectorAll('.yaml-property-preserve-checkbox:not([disabled])');
                const allChecked = Array.from(allEnabled).every((checkbox: HTMLInputElement) => checkbox.checked);
                
                // Update the "override all" visual state based on whether all checkboxes are checked
                const overrideAllContainer = document.getElementById('override-all-container');
                if (overrideAllContainer) {
                    if (allChecked) {
                        overrideAllContainer.addClass('active');
                    } else {
                        overrideAllContainer.removeClass('active');
                    }
                }
            });
        }
        
        // Update "select all" checkbox handler to work with the new structure
        if (mainSelectAllCheckbox) {
            // Remove old handler (if any)
            const newSelectAllCheckbox = mainSelectAllCheckbox.cloneNode(true) as HTMLInputElement;
            mainSelectAllCheckbox.parentNode?.replaceChild(newSelectAllCheckbox, mainSelectAllCheckbox);
            
            // Add new handler
            newSelectAllCheckbox.addEventListener('change', () => {
                const checked = newSelectAllCheckbox.checked;
                const checkboxes = this.contentEl.querySelectorAll('.yaml-property-item__include input');
                
                // Set checkbox states for property items
                checkboxes.forEach((checkbox: HTMLInputElement) => {
                    checkbox.checked = checked;
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                });
                
                // Toggle value info message visibility
                const valueInfoContainer = this.contentEl.querySelector('.yaml-preserve-info-container');
                if (valueInfoContainer) {
                    if (checked) {
                        valueInfoContainer.addClass('yaml-element--hidden');
                    } else {
                        valueInfoContainer.removeClass('yaml-element--hidden');
                    }
                }
                
                // Enable/disable secondary options based on Select All state
                if (overrideAllContainer) {
                    if (checked) {
                        overrideAllContainer.removeClass('yaml-select-all--disabled');
                        const overrideAllCheckbox = overrideAllContainer.querySelector('input[type="checkbox"]') as HTMLInputElement;
                        if (overrideAllCheckbox) {
                            overrideAllCheckbox.disabled = false;
                        }
                    } else {
                        overrideAllContainer.addClass('yaml-select-all--disabled');
                        
                        // Uncheck and disable the checkbox when primary is unchecked
                        const overrideAllCheckbox = overrideAllContainer.querySelector('input[type="checkbox"]') as HTMLInputElement;
                        if (overrideAllCheckbox) {
                            overrideAllCheckbox.checked = false;
                            overrideAllCheckbox.disabled = true;
                            this.overrideAllValues = false;
                            
                            // Reset all value checkboxes
                            const valueCheckboxes = this.contentEl.querySelectorAll('.yaml-property-preserve-checkbox:not([disabled])');
                            valueCheckboxes.forEach((checkbox: HTMLInputElement) => {
                                checkbox.checked = false;
                            });
                        }
                    }
                }
            });
        }
        
        // Move the button container to the end of the content element
        const buttonContainerEl = this.contentEl.querySelector('.yaml-button-container');
        if (buttonContainerEl) {
            // Remove from current position
            buttonContainerEl.remove();
            
            // Append to the end of the content element
            this.contentEl.appendChild(buttonContainerEl);
        }
        
        // Enable apply button
        const applyButton = this.contentEl.querySelector('.yaml-button--apply') as HTMLButtonElement;
        if (applyButton) {
            applyButton.disabled = false;
            applyButton.removeClass('yaml-button--disabled');
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
        const templatePropertiesWithType = this.plugin.propertyCache.get(templateFile.path) || preservePropertyTypes(templateProperties);
        
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
            const existingPropertiesWithType = this.plugin.propertyCache.get(file.path) || preservePropertyTypes(existingProperties);
            
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
            const finalProperties = restorePropertyValues(propertiesToApplyToFile);
            
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