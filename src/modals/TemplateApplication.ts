import { App, Modal, Notice, TFile, Setting, FuzzySuggestModal, FuzzyMatch, setIcon, ToggleComponent, DropdownComponent, MarkdownRenderer } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { formatValuePreview, parseValueLinks } from '../propertyFormatters';
import type { PropertyWithType } from '../PropertyTypeService';

export class TemplateApplication extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    targetFiles: TFile[];
    selectedTemplate: TFile | null = null;
    selectedProperties: string[] = [];
    overrideValueProperties: string[] = []; 
    overrideAllValues: boolean = false; 
    propertyPositioning: 'below' | 'above' | 'remove' = 'below'; 
    allTemplates: TFile[] = [];
    private templateSelectionSetting: Setting | null = null;
    private overrideAllToggle: ToggleComponent | null = null;
    private selectAllToggle: ToggleComponent | null = null;
    private allPropertiesSelected: boolean = false;
    private allValuesOverridden: boolean = false;
    private eventRefs: Array<() => void> = [];
    
    // Updated to store dropdowns instead of toggles
    private propertyToggles: Array<{
        key: string,
        dropdown: DropdownComponent
    }> = [];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, targetFiles: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.targetFiles = targetFiles;
    }

    /**
     * Handles clicks on potential links within property values.
     * Supports various link formats and properties containing links.
     *
     * @param linkTarget The value that might contain a link.
     * @param event The mouse event that triggered the handler.
     */
    private handleLinkClick(linkTarget: any, event: MouseEvent): void {
        event.stopPropagation(); // Prevent triggering other actions if nested

        // Handle array with a single element
        if (Array.isArray(linkTarget) && linkTarget.length === 1) {
            // Extract the single element and process it
            this.handleLinkClick(linkTarget[0], event);
            return;
        }

        if (typeof linkTarget !== 'string') {
            console.warn("handleLinkClick called with non-string target:", linkTarget);
            return;
        }

        // Check for external links first
        if (linkTarget.startsWith('https://') || linkTarget.startsWith('http://')) {
            window.open(linkTarget, '_blank'); // Use '_blank' for safety
            return;
        }

        // Attempt to parse Obsidian-style links (wikilinks, markdown links)
        const linkInfo = parseValueLinks(linkTarget);
        const sourcePath = ""; // Use vault root as the context for resolving links

        // If this is a valid link with a path, use that path
        if (linkInfo.isLink && linkInfo.path) {
            try {
                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkInfo.path, sourcePath);

                if (targetFile instanceof TFile) {
                    // File exists in the vault, open it in a new window leaf
                    const leaf = this.app.workspace.getLeaf('window');
                    leaf.openFile(targetFile).catch(err => {
                        console.error(`Error opening link in new window: ${linkInfo.path}`, err);
                        new Notice(`Could not open link: ${linkInfo.path}`);
                    });
                } else {
                    // File not found in the vault
                    new Notice(`File not found: ${linkInfo.path}`);
                }
                return;
            } catch (error) {
                console.error(`Error processing link: ${linkTarget}`, error);
                new Notice(`Could not process link: ${linkTarget}`);
                return;
            }
        }

        // Fallback - try to resolve the raw link target
        try {
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
            if (targetFile instanceof TFile) {
                // File exists in the vault, open it
                const leaf = this.app.workspace.getLeaf('window');
                leaf.openFile(targetFile).catch(err => {
                    console.error(`Error opening link in new window: ${linkTarget}`, err);
                    new Notice(`Could not open link: ${linkTarget}`);
                });
            } else {
                // Not found
                new Notice(`File not found: ${linkTarget}`);
            }
        } catch (error) {
            console.error(`Error processing link: ${linkTarget}`, error);
            new Notice(`Could not process link: ${linkTarget}`);
        }
    }



    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.eventRefs = [];
    
        // Main header
        new Setting(contentEl)
            .setName('Apply Template Properties')
            .setHeading();
    
        // Load templates needed for the suggester
        await this.loadAllTemplates();
    
        // Template Selection Section
        this.templateSelectionSetting = new Setting(contentEl)
            .setName('Template File')
            .setDesc('Select the template file containing the properties you want to apply.')
            .addButton(button => button
                .setButtonText(this.selectedTemplate ? 'Change Template' : 'Select Template')
                .setCta()
                .onClick(() => {
                    new TemplateSuggestModal(this.app, this.allTemplates, (selectedFile) => {
                        if (selectedFile) {
                            this.selectedTemplate = selectedFile;
                            this.updateSelectedTemplateDisplay();
                            this.loadTemplateProperties();
                            button.setButtonText('Change Template');
                        }
                    }).open();
                }));
    
        // Initial Display Update / Load
        this.updateSelectedTemplateDisplay();
        if (this.selectedTemplate) {
            this.loadTemplateProperties();
        } else {
            this.updateApplyButtonState();
        }
    
        // Buttons Section (Apply/Cancel)
        const buttonContainer = this.modalEl.createDiv({ cls: 'modal-button-container' });
    
        // Apply button
        const applyButton = buttonContainer.createEl('button', {
            text: 'Apply Template',
            cls: 'mod-cta'
        });
        applyButton.disabled = true;
        applyButton.id = 'apply-template-button';
    
        applyButton.addEventListener('click', async () => {
            if (!this.selectedTemplate) {
                new Notice('Please select a template file first.');
                return;
            }
            if (this.selectedProperties.length === 0) {
                new Notice('Please select at least one property to apply.');
                return;
            }
            await this.applyTemplateToFilesWithPreservation(
                this.selectedTemplate,
                this.targetFiles,
                this.selectedProperties,
                this.overrideValueProperties,
                this.overrideAllValues
            );
            if (this.selectedTemplate) {
                this.plugin.addToRecentTemplates(this.selectedTemplate.path);
            }
            this.close();
        });
    
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel'
        });
        cancelButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
    
        this.updateApplyButtonState();
    }

    // Load all template files - unchanged
    async loadAllTemplates() {
        const templates = await this.plugin.getAllTemplateFiles();
        
        const filesByFolder: Record<string, TFile[]> = {};
        const rootFiles: TFile[] = [];
        
        templates.forEach(file => {
            if (file.parent && file.parent.path !== '/') {
                const parentPath = file.parent.path;
                if (!filesByFolder[parentPath]) {
                    filesByFolder[parentPath] = [];
                }
                filesByFolder[parentPath].push(file);
            } else {
                rootFiles.push(file);
            }
        });
        
        const folderPaths = Object.keys(filesByFolder).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        folderPaths.forEach(path => {
            filesByFolder[path].sort((a, b) => 
                a.basename.toLowerCase().localeCompare(b.basename.toLowerCase())
            );
        });
        
        rootFiles.sort((a, b) => 
            a.basename.toLowerCase().localeCompare(b.basename.toLowerCase())
        );
        
        this.allTemplates = [];
        
        folderPaths.forEach(folderPath => {
            this.allTemplates.push(...filesByFolder[folderPath]);
        });
        
        this.allTemplates.push(...rootFiles);
    }

    showApplyButtonNotice() {
        if (!this.selectedTemplate) {
            new Notice('Please select a template file first.');
        } else if (this.selectedProperties.length === 0) {
            new Notice('Please select at least one property to apply.');
        }
    }

    // Update template selection display
    updateSelectedTemplateDisplay() {
        if (this.templateSelectionSetting) {
            if (this.selectedTemplate) {
                this.templateSelectionSetting.setDesc(`Selected: ${this.selectedTemplate.path}`);
            } else {
                this.templateSelectionSetting.setDesc('Select the template file containing the properties you want to apply.');
            }
        }
    }

    // Update Apply button state
    updateApplyButtonState() {
        const applyButton = this.modalEl.querySelector('#apply-template-button') as HTMLButtonElement;
        if (applyButton) {
            const canApply = this.selectedTemplate !== null && this.selectedProperties.length > 0;
            applyButton.disabled = !canApply;
        }
    }

    // Load and display properties from the selected template
    async loadTemplateProperties() {
        const { contentEl } = this;
        
        // Clear existing content after the template selection
        const templateSelectionEl = this.templateSelectionSetting?.settingEl;
        if (templateSelectionEl) {
            // Remove all elements after template selection
            let nextSibling = templateSelectionEl.nextSibling;
            while (nextSibling) {
                const current = nextSibling;
                nextSibling = current.nextSibling;
                current.remove();
            }
        }
        
        if (!this.selectedTemplate) {
            console.log("No template selected, exiting loadTemplateProperties.");
            this.updateApplyButtonState();
            return;
        }
        
        // Reset selections
        this.selectedProperties = [];
        this.overrideValueProperties = [];
        this.overrideAllValues = false;
        this.propertyPositioning = 'below';
        this.propertyToggles = [];
    
        // Property Selection & Options heading and controls
        new Setting(contentEl)
            .setName('Property Selection & Options')
            .setHeading();
        
        // Add the select all controls
        this.renderSelectAllControls(contentEl);
        
        // Property Positioning Options heading and controls
        new Setting(contentEl)
            .setName('Property Positioning Options')
            .setHeading();
        
        // Create the positioning radio options
        this.createPositioningRadioOptions(contentEl);
        
        // Load properties
        const properties = await this.plugin.parseFileProperties(this.selectedTemplate);
        const propertyKeys = Object.keys(properties);
    
        if (propertyKeys.length === 0) {
            // Show empty state message
            new Setting(contentEl)
                .setDesc('The selected template file does not have any YAML properties.');
        } else {
            // Properties List heading
            new Setting(contentEl)
                .setName('Properties List')
                .setHeading();
            
            // Create property items
            await this.createpropertySettings(propertyKeys, properties, contentEl);
        }
    
        // Update button state
        this.updateApplyButtonState();
    }
    
    private createOptionsUI(container: HTMLElement) {
        // Create sections with proper Obsidian structure
        const selectionSection = container.createDiv();
        const positioningSection = container.createDiv();
        
        // Property Selection & Options header
        new Setting(selectionSection)
            .setName('Property Selection & Options')
            .setHeading();
    
        // Add the select all controls using Obsidian components
        this.renderSelectAllControls(selectionSection);
        
        // Create positioning options header using Obsidian's Setting
        const positioningHeaderSetting = new Setting(positioningSection)
            .setName('Property Positioning Options')
            .setHeading()
            .setClass('positioning-header-setting');
        
        // Hide positioning section initially (will be shown when properties are loaded)
        positioningSection.style.display = 'none';
        positioningSection.id = 'positioning-section';
        positioningHeaderSetting.settingEl.id = 'positioning-header-setting';
        
        // Create Positioning options container
        const positioningContainer = positioningSection.createDiv({
            cls: 'setting-item-group',
            attr: { id: 'positioning-options-container' }
        });
        
        // Create the positioning radio options
        this.createPositioningRadioOptions(positioningContainer);
        
        // Add both sections to the main container
        container.appendChild(selectionSection);
        container.appendChild(positioningSection);
    }

    private createPositioningRadioOptions(container: HTMLElement): void {
        // Create references to store the toggle components
        let belowToggle: ToggleComponent;
        let aboveToggle: ToggleComponent;
        let removeToggle: ToggleComponent;
        
        // "Position Below" option
        new Setting(container)
            .setName('Position new properties below existing ones')
            .setDesc('New properties will be added after existing YAML properties')
            .addToggle(toggle => {
                belowToggle = toggle
                    .setValue(this.propertyPositioning === 'below')
                    .onChange(value => {
                        if (value) {
                            this.propertyPositioning = 'below';
                            // When this is selected, unselect others
                            if (aboveToggle) aboveToggle.setValue(false);
                            if (removeToggle) removeToggle.setValue(false);
                        }
                    });
                return belowToggle;
            });
        
        // "Position Above" option
        new Setting(container)
            .setName('Position new properties above existing ones')
            .setDesc('New properties will be added before existing YAML properties')
            .addToggle(toggle => {
                aboveToggle = toggle
                    .setValue(this.propertyPositioning === 'above')
                    .onChange(value => {
                        if (value) {
                            this.propertyPositioning = 'above';
                            // When this is selected, unselect others
                            if (belowToggle) belowToggle.setValue(false);
                            if (removeToggle) removeToggle.setValue(false);
                        }
                    });
                return aboveToggle;
            });
        
        // "Remove Properties" option
        const removeSetting = new Setting(container)
            .setName('Remove properties not in template')
            .setDesc('Replace all YAML properties with only the selected template properties')
            .addToggle(toggle => {
                removeToggle = toggle
                    .setValue(this.propertyPositioning === 'remove')
                    .onChange(value => {
                        if (value) {
                            this.propertyPositioning = 'remove';
                            // When this is selected, unselect others
                            if (belowToggle) belowToggle.setValue(false);
                            if (aboveToggle) aboveToggle.setValue(false);
                        }
                    });
                return removeToggle;
            });

            if (removeSetting.descEl) { // Check if descEl exists
                removeSetting.descEl.createEl('br'); // Add a line break element
                removeSetting.descEl.createSpan({   // Add the warning text span
                    text: 'Warning: This replaces the entire frontmatter. Existing properties not in the template will be deleted.',
                    cls: 'setting-warning-text'       // Assign class for styling
                });
            }
    }

    // Handle case when no properties are found
    private handleNoProperties(contentEl: HTMLElement) {
        const emptyContainer = contentEl.createDiv({ cls: 'setting-item-description' });
        emptyContainer.createSpan({
            text: 'The selected template file does not have any YAML properties.',
        });
        
        // Update button state
        this.updateApplyButtonState();
    }

    /**
     * Checks if a value is actually a link that should be clickable
     */
    private isPotentialLink(value: any): boolean {
        // Handle arrays with single items
        if (Array.isArray(value) && value.length === 1) {
            return this.isPotentialLink(value[0]);
        }
        
        // Only strings can be links
        if (typeof value !== 'string') {
            return false;
        }
        
        const trimmedValue = value.trim();
        
        // Only treat these specific formats as links
        return (
            // Wiki links
            (trimmedValue.startsWith('[[') && trimmedValue.endsWith(']]')) ||
            // URLs
            trimmedValue.startsWith('https://') ||
            trimmedValue.startsWith('http://') ||
            trimmedValue.startsWith('obsidian://')
        );
    }

    // Create property items for each property
    private createpropertySettings(propertyKeys: string[], properties: any, container: HTMLElement) {
        // Clear existing property toggles
        this.propertyToggles = [];

        for (const key of propertyKeys) {
            const originalValue = properties[key]; // Get the original value early

            // Create a property item with Obsidian Setting
            const propertySetting = new Setting(container)
                .setName(key);

            // Get type information based on the original value
            const internalType = this.plugin.getInternalPropertyType(key, originalValue);
            const typeDisplayName = this.plugin.propertyTypeService.getPropertyTypeDisplayName(internalType);

            // --- Layout Logic ---
            const descEl = propertySetting.descEl; // Get the description container
            descEl.empty(); // Clear default description content

            // Line 1: Type Information
            descEl.createDiv({ text: `Type: ${typeDisplayName}`, cls: 'property-type-line' });

            // Line 2: Value Information Container (Always visible)
            const valueLine = descEl.createDiv({ cls: 'property-value-line' });
            valueLine.createSpan({ text: 'Value: ' }); // "Value: " prefix

            const isMultilineText = (val: any): boolean => {
                if (typeof val !== 'string') return false;
                return val.includes('\n') || internalType === 'multitext';
            };

            // --- Conditional Value Display ---
            const isEmptyValue = originalValue === null || originalValue === undefined || originalValue === '' ||
            (Array.isArray(originalValue) && originalValue.length === 0) ||
            (typeof originalValue === 'object' && !Array.isArray(originalValue) && originalValue !== null && Object.keys(originalValue).length === 0);

            // Check if this is multiline text that needs special handling
            if (isMultilineText(originalValue)) {
            // Create a label span
            valueLine.createSpan({ text: isEmptyValue ? 'No value' : '' });

            // Create a separate div for multiline content below the label
            const multilineContainer = descEl.createDiv({
            attr: {
            style: 'white-space: pre-line;', // Preserve line breaks
            }
            });

            // Set the text content directly to preserve line breaks
            multilineContainer.setText(String(originalValue));

            } else if (Array.isArray(originalValue) && originalValue.length > 1) {
            // --- Array Handling ---
            // Collapsed View Container
            const collapsedArrayView = valueLine.createSpan({ cls: 'array-property-collapsed-view' });
            const firstItemOriginal = originalValue[0];
            const firstItemDisplay = formatValuePreview(firstItemOriginal, internalType);

            // Check if the first item is an actual link
            if (this.isPotentialLink(firstItemOriginal)) {
                // Create a clickable element for actual links
                const firstItemLinkEl = collapsedArrayView.createSpan({ 
                    text: firstItemDisplay, 
                    cls: 'clickable-link-item' 
                });
                
                // Attach click listener only to actual links
                this.plugin.registerDomEvent(firstItemLinkEl, 'click', (e) => {
                    e.stopPropagation();
                    this.handleLinkClick(firstItemOriginal, e);
                });
            } else {
                // Create a plain text element for regular items
                collapsedArrayView.createSpan({ text: firstItemDisplay });
            }
            // (Rest of collapsed view creation remains the same)
            // Get remaining count
            const remainingCount = originalValue.length - 1;

            // Create expand link with item count included
            const itemText = remainingCount === 1 ? 'item' : 'items';
            if (remainingCount > 0) {
                // Create expand link with count information
                const expandLinkContainer = collapsedArrayView.createSpan({ cls: 'array-property-toggle-link' }); // Main container span

                // Add the opening parenthesis OUTSIDE the underline target
                expandLinkContainer.appendText('(');

                // Create the inner span containing ALL text to be underlined
                const underlineTargetSpan = expandLinkContainer.createSpan({
                    text: `Expand, ${remainingCount} more ${itemText}`, // Combine text here
                    cls: 'underline-target' // New class for specific targeting
                });

                // Add the closing parenthesis OUTSIDE the underline target
                expandLinkContainer.appendText(')');

                // Attach expand click event TO THE CONTAINER
                this.plugin.registerDomEvent(expandLinkContainer, 'click', () => {
                    collapsedArrayView.addClass('is-hidden');
                    expandedViewContainer.removeClass('is-hidden');
                    valueLine.removeClass('is-hidden');
                });
            } else {
                // Create expand link with count information
                const expandLinkContainer = collapsedArrayView.createSpan({ cls: 'array-property-toggle-link' }); // Main container span

                // Add the opening parenthesis OUTSIDE the underline target
                expandLinkContainer.appendText('(');

                // Create the inner span containing ALL text to be underlined
                const underlineTargetSpan = expandLinkContainer.createSpan({
                    text: `Expand, ${remainingCount} more ${itemText}`, // Combine text here
                    cls: 'underline-target' // New class for specific targeting
                });

                // Add the closing parenthesis OUTSIDE the underline target
                expandLinkContainer.appendText(')');

                // Attach expand click event TO THE CONTAINER
                this.plugin.registerDomEvent(expandLinkContainer, 'click', () => {
                    collapsedArrayView.addClass('is-hidden');
                    expandedViewContainer.removeClass('is-hidden');
                    valueLine.removeClass('is-hidden');
                });
            }

            // Expanded View Container
            const expandedViewContainer = descEl.createDiv({ cls: 'array-property-expanded-container is-hidden' });
            // Render individual items in expanded view
            originalValue.forEach((item, index) => {
                const displayText = formatValuePreview(item, internalType);
                
                // Only treat actual links as clickable
                if (this.isPotentialLink(item)) {
                    // This is an actual link - create clickable element
                    const linkEl = expandedViewContainer.createSpan({ 
                        text: displayText, 
                        cls: 'clickable-link-item'
                    });
                    
                    // Attach click listener only to actual links
                    this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                        this.handleLinkClick(item, e);
                    });
                } else {
                    // Regular item - create plain text (not clickable)
                    expandedViewContainer.createSpan({ text: displayText });
                }
                
                // Add comma separator between items
                if (index < originalValue.length - 1) {
                    expandedViewContainer.appendText(', ');
                }
            });
            // Create collapse link with parentheses outside the underline target
            const collapseLinkContainer = expandedViewContainer.createSpan({ cls: 'array-property-toggle-link' }); // Main container

            collapseLinkContainer.appendText('('); // Add leading space and parenthesis

            const collapseTextSpan = collapseLinkContainer.createSpan({ // Inner span for "Collapse"
                text: 'Collapse',
                cls: 'underline-target' // Reuse the same class as "Expand"
            });

            collapseLinkContainer.appendText(')'); // Add closing parenthesis

            // Attach collapse click event TO THE CONTAINER
            this.plugin.registerDomEvent(collapseLinkContainer, 'click', () => {
                collapsedArrayView.removeClass('is-hidden');
                expandedViewContainer.addClass('is-hidden');
            });
            // --- End Array Handling ---
        } else {
            // --- Single Value Handling (Non-Array or Short Array) ---
                // Special handling for arrays with only one item
                if (Array.isArray(originalValue) && originalValue.length === 1) {
                    const singleItem = originalValue[0];
                    const valuePreview = formatValuePreview(singleItem, internalType);
                    
                    if (!isEmptyValue && this.isPotentialLink(singleItem)) {
                        // Single item is a link - make it clickable
                        const linkEl = valueLine.createSpan({ text: valuePreview, cls: 'clickable-link-item' });
                        this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                            this.handleLinkClick(singleItem, e);
                        });
                    } else {
                        // Single item is not a link - display as plain text
                        valueLine.createSpan({ text: isEmptyValue ? 'No value' : valuePreview });
                    }
                } else {
                    // Regular single value (not an array)
                    const valuePreview = formatValuePreview(originalValue, internalType);
                    
                    if (!isEmptyValue && this.isPotentialLink(originalValue)) {
                        // Value is a link - make it clickable
                        const linkEl = valueLine.createSpan({ text: valuePreview, cls: 'clickable-link-item' });
                        this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                            this.handleLinkClick(originalValue, e);
                        });
                    } else {
                        // Value is not a link or is empty - display as plain text
                        valueLine.createSpan({ text: isEmptyValue ? 'No value' : valuePreview });
                    }
                }
                // --- End Single Value Handling ---
            }
            // --- End Conditional Value Display ---

            // Dropdown for include/exclude/override (remains the same)
            propertySetting.addDropdown(dropdown => {
                dropdown
                    .addOption('exclude', 'Exclude property')
                    .addOption('include', 'Include property')
                    .addOption('include-override', 'Include with value')
                    .setValue('exclude') // Default to exclude
                    .onChange(value => {
                         if (value === 'exclude') {
                            this.selectedProperties = this.selectedProperties.filter(p => p !== key);
                            this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                        } else if (value === 'include') {
                            if (!this.selectedProperties.includes(key)) this.selectedProperties.push(key);
                            this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== key);
                        } else if (value === 'include-override') {
                            if (!this.selectedProperties.includes(key)) this.selectedProperties.push(key);
                            if (!this.overrideValueProperties.includes(key)) this.overrideValueProperties.push(key);
                        }
                        this.updateMasterTogglesState();
                        this.updateApplyButtonState();
                    });
                this.propertyToggles.push({ key: key, dropdown: dropdown });
                return dropdown;
            });
        }
    }

    // Apply template logic - unchanged
    async applyTemplateToFilesWithPreservation(
        templateFile: TFile,
        targetFiles: TFile[],
        propertiesToApply: string[],
        overrideValueProperties: string[],
        overrideAllValues: boolean
    ) {
        try {
            // Get template properties with type info
            const templateProperties = await this.plugin.parseFileProperties(templateFile);
            const templatePropertiesWithType = this.plugin.propertyCache.get(templateFile.path) || this.plugin.propertyTypeService.preservePropertyTypes(templateProperties);

            // Filter to only include specified properties to apply
            const filteredPropertiesWithType: Record<string, PropertyWithType> = {};
            for (const key of propertiesToApply) {
                if (key in templatePropertiesWithType) {
                    filteredPropertiesWithType[key] = templatePropertiesWithType[key];
                }
            }

            let successCount = 0;
            for (const file of targetFiles) {
                if (file.path === templateFile.path) continue;

                try {
                    // Use processFrontMatter for atomic updates
                    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        // Get existing properties with type info
                        const existingProperties = frontmatter || {};
                        const existingPropertiesWithType = this.plugin.propertyTypeService.preservePropertyTypes(existingProperties);

                        let finalPropertiesToApply: Record<string, PropertyWithType> = {};

                        // --- Apply Positioning Logic ---
                        if (this.propertyPositioning === 'remove') {
                            // Start fresh, only template properties will be added
                            finalPropertiesToApply = { ...filteredPropertiesWithType };
                        } else if (this.propertyPositioning === 'above') {
                            // Template properties first, then existing non-template properties
                            finalPropertiesToApply = { ...filteredPropertiesWithType };
                            for (const key in existingPropertiesWithType) {
                                if (!filteredPropertiesWithType[key]) { // Add only if not in template
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                }
                            }
                        } else { // Default is 'below'
                            // Existing non-template properties first, then template properties
                            finalPropertiesToApply = {};
                            for (const key in existingPropertiesWithType) {
                                if (!filteredPropertiesWithType[key]) { // Add only if not in template
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                }
                            }
                            // Add template properties, potentially overwriting placeholders
                            Object.assign(finalPropertiesToApply, filteredPropertiesWithType);
                        }

                        // --- Apply Value Preservation / Override / Add Key Only Logic ---
                        const finalKeys = Object.keys(finalPropertiesToApply);

                        for (const key of finalKeys) {
                            const isPropertyToApply = propertiesToApply.includes(key);
                            
                            if (!isPropertyToApply) {
                                // If this key wasn't selected for application (meaning it's an existing property
                                // preserved due to 'above' or 'below' positioning), keep its existing value.
                                // Ensure it's actually in existingPropertiesWithType to avoid errors.
                                if (existingPropertiesWithType[key]) {
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                } else {
                                    // Should not happen with current positioning logic, but as a safeguard:
                                    delete finalPropertiesToApply[key];
                                }
                                continue; 
                            }

                            // Now handle properties that *were* selected for application
                            const isOverride = overrideAllValues || overrideValueProperties.includes(key);

                            if (isOverride) {
                                // 'Include with value' selected: Use the template value.
                                // Ensure the template property exists before assigning.
                                if (templatePropertiesWithType[key]) {
                                    finalPropertiesToApply[key] = templatePropertiesWithType[key];
                                } else {
                                    // Template doesn't have this key? Should not happen if key is in propertiesToApply.
                                    // Maybe delete or set to null? Setting null is safer.
                                    finalPropertiesToApply[key] = { value: null, type: 'null' }; 
                                }
                            } else {
                                // 'Include property' selected: Preserve existing or add as null.
                                if (existingPropertiesWithType[key]) {
                                    // Property exists in target file: Preserve its value.
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                } else {
                                    // Property does NOT exist in target file: Add key with null value.
                                    finalPropertiesToApply[key] = { value: null, type: 'null' };
                                }
                            }
                        }

                        // --- Update Frontmatter ---
                        // Clear existing frontmatter to potentially influence order
                        Object.keys(frontmatter).forEach(fKey => delete frontmatter[fKey]);

                        // Restore values and apply to frontmatter object using Object.assign
                        const restoredProperties = this.plugin.propertyTypeService.restorePropertyValues(finalPropertiesToApply);
                        Object.assign(frontmatter, restoredProperties);
                    });

                    // Clear cache for the modified file
                    this.plugin.propertyCache.delete(file.path);
                    successCount++;

                } catch (fileError) {
                    console.error(`Error applying template to ${file.path}:`, fileError);
                    new Notice(`Failed to apply template to ${file.name}.`);
                }
            }

            new Notice(`Applied template to ${successCount} of ${targetFiles.length} ${targetFiles.length === 1 ? 'file' : 'files'}.`);
            return successCount;

        } catch (error) {
            console.error('Error applying template:', error);
            new Notice(`Error applying template: ${error.message}`);
            return 0;
        }
    }
    
    //#endregion

    //#region Navigation and UI

    private renderSelectAllControls(containerEl: HTMLElement): void {
        // Create the "Select All Properties" toggle
        new Setting(containerEl)
            .setName('Select All Properties')
            .setDesc('Include all properties from this template')
            .addToggle(toggle => {
                this.selectAllToggle = toggle
                    .setValue(this.allPropertiesSelected)
                    .onChange(value => {
                        this.allPropertiesSelected = value;
                        
                        // Update all property dropdowns
                        this.propertyToggles.forEach(propToggle => {
                            if (value) {
                                // Select "Include property" for all
                                propToggle.dropdown.setValue('include');
                                
                                // Add to selectedProperties if not already there
                                if (!this.selectedProperties.includes(propToggle.key)) {
                                    this.selectedProperties.push(propToggle.key);
                                }
                            } else {
                                // Deselect all (set to "Exclude")
                                propToggle.dropdown.setValue('exclude');
                                
                                // Remove from selected properties
                                this.selectedProperties = this.selectedProperties.filter(p => p !== propToggle.key);
                                this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== propToggle.key);
                            }
                        });
                        
                        // Enable/disable the "Override All Values" toggle based on selection
                        if (this.overrideAllToggle) {
                            this.overrideAllToggle.setDisabled(!value);
                            if (!value) {
                                this.overrideAllToggle.setValue(false);
                            }
                        }
                        
                        // Update the Apply button state
                        this.updateApplyButtonState();
                    });
                return toggle;
            });
        
        // Create the "Override All Values" toggle
        const overrideSetting = new Setting(containerEl)
            .setName('Override All Values')
            .setDesc('Override existing values with template values')
            .addToggle(toggle => {
                this.overrideAllToggle = toggle
                    .setValue(this.allValuesOverridden)
                    .setDisabled(!this.allPropertiesSelected)
                    .onChange(value => {
                        this.allValuesOverridden = value;
                        this.overrideAllValues = value;
                        
                        // Update all property dropdowns
                        this.propertyToggles.forEach(propToggle => {
                            const currentValue = propToggle.dropdown.getValue();
                            
                            if (value && currentValue === 'include') {
                                // Change to include-override
                                propToggle.dropdown.setValue('include-override');
                                
                                // Add to overrideValueProperties
                                if (!this.overrideValueProperties.includes(propToggle.key)) {
                                    this.overrideValueProperties.push(propToggle.key);
                                }
                            } else if (!value && currentValue === 'include-override') {
                                // Change to include
                                propToggle.dropdown.setValue('include');
                                
                                // Remove from overrideValueProperties
                                this.overrideValueProperties = this.overrideValueProperties.filter(
                                    p => p !== propToggle.key
                                );
                            }
                        });
                    });                
                return toggle;
            });

            // Manipulate the description element AFTER the setting is created
            if (overrideSetting.descEl) { // Check if descEl exists (it should)
                overrideSetting.descEl.createEl('br'); // Add a line break element
                overrideSetting.descEl.createSpan({   // Add the warning text span
                    text: 'Caution: This can overwrite data in target files.',
                    cls: 'setting-warning-text'       // Assign class for styling
                });
            }
    }
    
    // Updated to work with dropdowns
    private updateMasterTogglesState(): void {
        // Don't update while loading
        if (!this.propertyToggles.length) return;
        
        // Count properties in different states
        let includedCount = 0;
        let overriddenCount = 0;
        
        this.propertyToggles.forEach(propToggle => {
            const value = propToggle.dropdown.getValue();
            if (value === 'include' || value === 'include-override') {
                includedCount++;
            }
            if (value === 'include-override') {
                overriddenCount++;
            }
        });
        
        const totalProps = this.propertyToggles.length;
        
        // Update all properties selected state
        this.allPropertiesSelected = includedCount === totalProps && totalProps > 0;
        
        // Update all values overridden state
        this.allValuesOverridden = overriddenCount === includedCount && includedCount > 0;
        
        // Update toggle states if they exist
        if (this.selectAllToggle) {
            this.selectAllToggle.setValue(this.allPropertiesSelected);
        }
        
        if (this.overrideAllToggle) {
            this.overrideAllToggle.setValue(this.allValuesOverridden);
            this.overrideAllToggle.setDisabled(includedCount === 0);
        }
    }

    onClose() {
        // Remove all registered event listeners
        this.eventRefs.forEach(removeListener => removeListener());
        this.eventRefs = [];
        
        // Existing cleanup code
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Define a type for our special trigger item
type SpecialTriggerItem = { isVaultSearchTrigger: true; name: string };
// Define a union type for items the modal can handle
type SuggestModalItem = TFile | SpecialTriggerItem;

// --- Type Predicate Function ---
// This function explicitly tells TypeScript if an item is the SpecialTriggerItem
function isSpecialTriggerItem(item: SuggestModalItem): item is SpecialTriggerItem {
    // Check if it's an object, not null, and has the specific property set to true
    return typeof item === 'object' && item !== null && 'isVaultSearchTrigger' in item && item.isVaultSearchTrigger === true;
}
// --- End Type Predicate Function ---

class TemplateSuggestModal extends FuzzySuggestModal<SuggestModalItem> {
    templates: TFile[];
    onChoose: (result: TFile | null) => void;
    searchMode: 'templates' | 'vault'; // Mode to determine search scope
    appInstance: App; // Store app instance explicitly

    // Special item to trigger vault search
    private static readonly VAULT_SEARCH_TRIGGER: SpecialTriggerItem = {
        isVaultSearchTrigger: true,
        name: "Search all vault files...",
    };

    constructor(
        app: App,
        templates: TFile[], // Predefined templates (used in 'templates' mode)
        onChoose: (result: TFile | null) => void,
        initialMode: 'templates' | 'vault' = 'templates' // Start in 'templates' mode by default
    ) {
        super(app);
        this.appInstance = app; // Store app reference
        this.templates = templates;
        this.onChoose = onChoose;
        this.searchMode = initialMode;

        this.setPlaceholder(
            this.searchMode === 'templates'
                ? "Search predefined templates or select 'Search all'..."
                : "Search all vault files..."
        );
    }

    getItems(): SuggestModalItem[] {
        // Create a unified sorting function that works the same way for both modes
        const getSortedFiles = (files: TFile[]): TFile[] => {
            // Create a map of folder paths to their contained files
            const filesByFolder = new Map<string, TFile[]>();
            const rootFiles: TFile[] = [];
            
            // Identify all unique folders
            const folders = new Set<string>();
            
            // Group files by folder
            files.forEach(file => {
                const path = file.path;
                const lastSlashIndex = path.lastIndexOf('/');
                
                if (lastSlashIndex === -1) {
                    // Root files
                    rootFiles.push(file);
                } else {
                    // Get the folder path
                    const folderPath = path.substring(0, lastSlashIndex);
                    folders.add(folderPath);
                    
                    // Add file to its folder's list
                    if (!filesByFolder.has(folderPath)) {
                        filesByFolder.set(folderPath, []);
                    }
                    filesByFolder.get(folderPath)?.push(file);
                }
            });
            
            // Convert folders to array and sort
            const sortedFolders = Array.from(folders).sort();
            
            // Collect subfolders first, then direct files for each folder
            const result: TFile[] = [];
            
            // Function to get direct files in a folder (not in subfolders)
            const getDirectFiles = (folderPath: string): TFile[] => {
                const files = filesByFolder.get(folderPath) || [];
                return files.filter(file => {
                    const fileFolderPath = file.path.substring(0, file.path.lastIndexOf('/'));
                    return fileFolderPath === folderPath;
                }).sort((a, b) => a.basename.localeCompare(b.basename));
            };
            
            // Process each top-level folder
            sortedFolders.forEach(folder => {
                if (!folder.includes('/') || folder.split('/').length === 1) {
                    // This is a top-level folder
                    
                    // First add all subfolder content
                    sortedFolders
                        .filter(subFolder => subFolder !== folder && subFolder.startsWith(folder + '/'))
                        .sort()
                        .forEach(subFolder => {
                            result.push(...getDirectFiles(subFolder));
                        });
                    
                    // Then add direct files in this folder
                    result.push(...getDirectFiles(folder));
                }
            });
            
            // Add root files at the end
            result.push(...rootFiles.sort((a, b) => a.basename.localeCompare(b.basename)));
            
            return result;
        };
    
        // Now use the same function for both modes
        if (this.searchMode === 'vault') {
            // Use the unified sorting function for all vault files
            return getSortedFiles(this.appInstance.vault.getMarkdownFiles());
        } else {
            // Use the same function for templates, then add the search option
            return [TemplateSuggestModal.VAULT_SEARCH_TRIGGER, ...getSortedFiles(this.templates)];
        }
    }

    getItemText(item: SuggestModalItem): string {
        // Check if it's the special trigger item
        if (isSpecialTriggerItem(item)) {
            return item.name;
        }

        // --- Construct path without extension for TFile ---
        // If it's not the trigger, TypeScript knows 'item' is TFile here
        let displayPath: string;
        const parentPath = item.parent?.path; // Get parent path (might be null for root)

        if (parentPath && parentPath !== '/') {
            // If parent exists and is not root, combine parent path and basename
            displayPath = `${parentPath}/${item.basename}`;
        } else {
            // If file is in root, just use basename
            displayPath = item.basename;
        }
        // --- End path construction ---

        // Return the constructed path without extension for filtering
        return displayPath;
    }

    // Override renderSuggestion to handle both TFile and the special trigger item
    renderSuggestion(match: FuzzyMatch<SuggestModalItem>, el: HTMLElement): void {
        // Clear previous content and add base class
        el.empty();
        el.addClass('suggestion-item');
        el.addClass('template-suggestion-item');

        // Get the actual item (TFile or SpecialTriggerItem)
        const item = match.item;

        // Create the main content container
        const content = el.createDiv({ cls: 'suggestion-content' }); // Standard class

        // --- Type Check ---
        if (isSpecialTriggerItem(item)) {
            // Render special trigger item
            el.addClass('template-suggestion-trigger');
            const icon = content.createDiv({ cls: 'suggestion-icon' }); // Standard class
            setIcon(icon, 'search');

            content.createDiv({
                cls: 'suggestion-title is-trigger', // Standard class + custom marker
                text: item.name
            });
        } else {
            // It's a TFile

            // Construct path without extension
            let displayPath: string;
            const parentPath = item.parent?.path; // Get parent path (might be null for root)

            if (parentPath && parentPath !== '/') {
                // If parent exists and is not root, combine parent path and basename
                displayPath = `${parentPath}/${item.basename}`;
            } else {
                // If file is in root, just use basename
                displayPath = item.basename;
            }

            // Add title (Path without Extension)
            content.createDiv({
                cls: 'suggestion-title', // Standard class
                text: displayPath // Use the constructed path without extension
            });

            // No suggestion-note needed as per last request
        }
    }

    onChooseItem(item: SuggestModalItem, evt: MouseEvent | KeyboardEvent): void {
        // Use the type predicate function
        if (isSpecialTriggerItem(item)) {
            // Handle trigger selection
            new TemplateSuggestModal(this.appInstance, [], this.onChoose, 'vault').open();
        } else {
            // If it's not the trigger, TypeScript now knows 'item' is TFile
            // Handle TFile selection
            this.onChoose(item); // No type assertion needed
        }
    }

    onClose() {
       super.onClose();
       // Optional: Handle closing without selection if needed
    }
}