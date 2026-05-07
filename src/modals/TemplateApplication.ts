import { App, Modal, Notice, TFile, Setting, FuzzySuggestModal, FuzzyMatch, setIcon, ToggleComponent, DropdownComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { formatValuePreview } from '../commonHelpers';
import type { PropertyWithType } from '../PropertyTypeService';
import type { YamlPropertyValue } from '../interfaces';
import { isPotentialLink, handleLinkClick } from '../commonHelpers';
import { PropertyManagerMenu } from './PropertyManagerMenu';

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
    private overrideAllSetting: Setting | null = null;
    private selectAllToggle: ToggleComponent | null = null;
    private isUpdatingMasterToggles: boolean = false;
    private allPropertiesSelected: boolean = true;
    private allValuesOverridden: boolean = false;
    private applyButton: HTMLButtonElement | null = null;

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

    onOpen(): void {
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('yaml-property-manager-modal');

        // Main header
        new Setting(contentEl)
            .setName('Apply template properties')
            .setHeading();

        // Add description about number of files
        new Setting(contentEl)
            .setDesc(`Editing properties across ${this.targetFiles.length} ${this.targetFiles.length === 1 ? 'file' : 'files'}.`)
            .settingEl.addClass('no-top-border');

        // Load templates needed for the suggester
        await this.loadAllTemplates();

        // Template Selection Section
        this.templateSelectionSetting = new Setting(contentEl)
            .setName('Template file')
            .setDesc('Select the template file containing the properties you want to apply.')
            .addButton(button => button
                .setButtonText(this.selectedTemplate ? 'Change template' : 'Select template')
                .setCta()
                .onClick(() => {
                    const recentTemplatePaths: string[] = [];

                    if (this.plugin.settings && this.plugin.settings.recentTemplates) {
                        recentTemplatePaths.push(...this.plugin.settings.recentTemplates);
                    }

                    new TemplateSuggestModal(
                        this.app,
                        this.allTemplates,
                        (selectedFile) => {
                            if (selectedFile) {
                                this.selectedTemplate = selectedFile;
                                this.updateSelectedTemplateDisplay();
                                void this.loadTemplateProperties();
                                button.setButtonText('Change template');
                            }
                        },
                        recentTemplatePaths,
                        this.allTemplates.length === 0 ? 'vault' : 'templates'
                    ).open();
                }));

        // Initial Display Update / Load
        this.updateSelectedTemplateDisplay();
        if (this.selectedTemplate) {
            void this.loadTemplateProperties();
        } else {
            this.updateApplyButtonState();
        }

        // Buttons Section (Apply/Cancel)
        const buttonContainer = this.modalEl.createDiv({ cls: 'modal-button-container' });

        // Apply button
        const applyButton = buttonContainer.createEl('button', {
            text: 'Apply template',
            cls: 'mod-cta'
        });
        applyButton.disabled = true;
        this.applyButton = applyButton;

        this.plugin.registerDomEvent(applyButton, 'click', async () => {
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
        this.plugin.registerDomEvent(cancelButton, 'click', () => {
            this.close();
            new PropertyManagerMenu(this.app, this.plugin).open();
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
        if (this.applyButton) {
            const canApply = this.selectedTemplate !== null && this.selectedProperties.length > 0;
            this.applyButton.disabled = !canApply;
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
            .setName('Property selection & options')
            .setHeading();

        // Add the select all controls
        this.renderSelectAllControls(contentEl);

        // Property Positioning dropdown
        const positionDescs: Record<string, string> = {
            below: 'New properties will be added after existing YAML properties.',
            above: 'New properties will be added before existing YAML properties.',
            remove: 'Replace all YAML properties with only the selected template properties.'
        };
        const applyPositionDesc = (setting: Setting, value: string) => {
            setting.setDesc(positionDescs[value] ?? '');
            if (value === 'remove' && setting.descEl) {
                setting.descEl.createEl('br');
                setting.descEl.createSpan({
                    text: 'Warning: Existing properties not in the template will be deleted.',
                    cls: 'setting-warning-text'
                });
            }
        };
        const positioningSetting = new Setting(contentEl)
            .setName('Property positioning')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('below', 'Position below existing')
                    .addOption('above', 'Position above existing')
                    .addOption('remove', 'Remove unlisted properties')
                    .setValue(this.propertyPositioning)
                    .onChange(value => {
                        this.propertyPositioning = value as 'below' | 'above' | 'remove';
                        applyPositionDesc(positioningSetting, value);
                    });
                return dropdown;
            });
        applyPositionDesc(positioningSetting, this.propertyPositioning);

        // Load properties (synchronous now)
        const properties = this.plugin.parseFileProperties(this.selectedTemplate);
        const propertyKeys = Object.keys(properties);

        if (propertyKeys.length === 0) {
            // Show empty state message
            new Setting(contentEl)
                .setDesc('The selected template file does not have any YAML properties.');
        } else {
            // Properties List heading
            new Setting(contentEl)
                .setName('Properties list')
                .setHeading();

            // Create property items
            this.createpropertySettings(propertyKeys, properties, contentEl);
        }

        // Initialize selected properties if allPropertiesSelected is true
        if (this.allPropertiesSelected && propertyKeys.length > 0) {
            this.selectedProperties = [...propertyKeys];

            // Make sure the property dropdowns are updated to "include" state
            this.propertyToggles.forEach(propToggle => {
                propToggle.dropdown.setValue('include');
            });

            // Enable the Override All toggle
            if (this.overrideAllToggle) {
                this.overrideAllToggle.setDisabled(false);
            }
        }

        // Update button state
        this.updateApplyButtonState();
    }

    // Create property items for each property
    private createpropertySettings(propertyKeys: string[], properties: Record<string, YamlPropertyValue>, container: HTMLElement) {
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

            const isMultilineText = (val: YamlPropertyValue): boolean => {
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
            if (isPotentialLink(firstItemOriginal)) {
                // Create a clickable element for actual links
                const firstItemLinkEl = collapsedArrayView.createSpan({
                    text: firstItemDisplay,
                    cls: 'clickable-link-item'
                });

                // Attach click listener only to actual links
                this.plugin.registerDomEvent(firstItemLinkEl, 'click', (e) => {
                    e.stopPropagation();
                    handleLinkClick(this.app, firstItemOriginal, e);
                });
            } else {
                // Create a plain text element for regular items
                collapsedArrayView.createSpan({ text: firstItemDisplay });
            }
            // Get remaining count
            const remainingCount = originalValue.length - 1;

            // Create expand link with item count included
            const itemText = remainingCount === 1 ? 'item' : 'items';
            {
                // Create expand link with count information
                const expandLinkContainer = collapsedArrayView.createSpan({ cls: 'array-property-toggle-link' });

                // Add the opening parenthesis OUTSIDE the underline target
                expandLinkContainer.appendText('(');

                // Create the inner span containing ALL text to be underlined
                expandLinkContainer.createSpan({
                    text: `Expand, ${remainingCount} more ${itemText}`,
                    cls: 'underline-target'
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
                if (isPotentialLink(item)) {
                    // This is an actual link - create clickable element
                    const linkEl = expandedViewContainer.createSpan({
                        text: displayText,
                        cls: 'clickable-link-item'
                    });

                    // Attach click listener only to actual links
                    this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                        handleLinkClick(this.app, item, e);
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
            const collapseLinkContainer = expandedViewContainer.createSpan({ cls: 'array-property-toggle-link' });

            collapseLinkContainer.appendText('(');

            collapseLinkContainer.createSpan({
                text: 'Collapse',
                cls: 'underline-target'
            });

            collapseLinkContainer.appendText(')');

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

                    if (!isEmptyValue && isPotentialLink(singleItem)) {
                        // Single item is a link - make it clickable
                        const linkEl = valueLine.createSpan({ text: valuePreview, cls: 'clickable-link-item' });
                        this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                            handleLinkClick(this.app, singleItem, e);
                        });
                    } else {
                        // Single item is not a link - display as plain text
                        valueLine.createSpan({ text: isEmptyValue ? 'No value' : valuePreview });
                    }
                } else {
                    // Regular single value (not an array)
                    const valuePreview = formatValuePreview(originalValue, internalType);

                    if (!isEmptyValue && isPotentialLink(originalValue)) {
                        // Value is a link - make it clickable
                        const linkEl = valueLine.createSpan({ text: valuePreview, cls: 'clickable-link-item' });
                        this.plugin.registerDomEvent(linkEl, 'click', (e) => {
                            handleLinkClick(this.app, originalValue, e);
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
            // Get template properties with type info (synchronous)
            const templateProperties = this.plugin.parseFileProperties(templateFile);
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
                        const existingProperties = (frontmatter ?? {}) as Record<string, YamlPropertyValue>;
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
                                if (existingPropertiesWithType[key]) {
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                } else {
                                    delete finalPropertiesToApply[key];
                                }
                                continue;
                            }

                            // Now handle properties that *were* selected for application
                            const isOverride = overrideAllValues || overrideValueProperties.includes(key);

                            if (isOverride) {
                                if (templatePropertiesWithType[key]) {
                                    finalPropertiesToApply[key] = templatePropertiesWithType[key];
                                } else {
                                    finalPropertiesToApply[key] = { value: null, type: 'null' };
                                }
                            } else {
                                if (existingPropertiesWithType[key]) {
                                    finalPropertiesToApply[key] = existingPropertiesWithType[key];
                                } else {
                                    finalPropertiesToApply[key] = { value: null, type: 'null' };
                                }
                            }
                        }

                        // --- Update Frontmatter ---
                        Object.keys(frontmatter).forEach(fKey => delete frontmatter[fKey]);

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
            new Notice(`Error applying template: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        }
    }

    //#endregion

    //#region Navigation and UI

    private renderSelectAllControls(containerEl: HTMLElement): void {
        // Create the "Select all properties" toggle
        new Setting(containerEl)
            .setName('Select all properties')
            .setDesc('Include all properties from this template')
            .addToggle(toggle => {
                this.selectAllToggle = toggle
                    .setValue(this.allPropertiesSelected)
                    .onChange(value => {
                        if (this.isUpdatingMasterToggles) return;
                        this.allPropertiesSelected = value;

                        // Update all property dropdowns
                        this.propertyToggles.forEach(propToggle => {
                            if (value) {
                                propToggle.dropdown.setValue('include');

                                if (!this.selectedProperties.includes(propToggle.key)) {
                                    this.selectedProperties.push(propToggle.key);
                                }
                            } else {
                                propToggle.dropdown.setValue('exclude');

                                this.selectedProperties = this.selectedProperties.filter(p => p !== propToggle.key);
                                this.overrideValueProperties = this.overrideValueProperties.filter(p => p !== propToggle.key);
                            }
                        });

                        this.overrideAllSetting?.setDisabled(!value);
                        if (this.overrideAllToggle) {
                            this.overrideAllToggle.setDisabled(!value);
                            if (!value) {
                                this.overrideAllToggle.setValue(false);
                            }
                        }

                        this.updateApplyButtonState();
                    });
                return toggle;
            });

        // Create the "Override all values" toggle
        this.overrideAllSetting = new Setting(containerEl)
            .setName('Override all values')
            .setDesc('Override existing values with template values')
            .addToggle(toggle => {
                this.overrideAllToggle = toggle
                    .setValue(this.allValuesOverridden)
                    .setDisabled(!this.allPropertiesSelected)
                    .onChange(value => {
                        if (this.isUpdatingMasterToggles) return;
                        this.allValuesOverridden = value;
                        this.overrideAllValues = value;

                        // Update all property dropdowns
                        this.propertyToggles.forEach(propToggle => {
                            const currentValue = propToggle.dropdown.getValue();

                            if (value && currentValue === 'include') {
                                propToggle.dropdown.setValue('include-override');

                                if (!this.overrideValueProperties.includes(propToggle.key)) {
                                    this.overrideValueProperties.push(propToggle.key);
                                }
                            } else if (!value && currentValue === 'include-override') {
                                propToggle.dropdown.setValue('include');

                                this.overrideValueProperties = this.overrideValueProperties.filter(
                                    p => p !== propToggle.key
                                );
                            }
                        });
                    });
                return toggle;
            });

            if (this.overrideAllSetting?.descEl) {
                this.overrideAllSetting.descEl.createEl('br');
                this.overrideAllSetting.descEl.createSpan({
                    text: 'Caution: This overwrites data within selected file(s).',
                    cls: 'setting-warning-text'
                });
            }

        // Sync the row's disabled appearance with the toggle's initial state
        this.overrideAllSetting?.setDisabled(!this.allPropertiesSelected);
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
        this.isUpdatingMasterToggles = true;

        if (this.selectAllToggle) {
            this.selectAllToggle.setValue(this.allPropertiesSelected);
        }

        const overrideDisabled = !this.allPropertiesSelected;
        if (this.overrideAllToggle) {
            if (overrideDisabled) {
                this.allValuesOverridden = false;
                this.overrideAllToggle.setValue(false);
            } else {
                this.overrideAllToggle.setValue(this.allValuesOverridden);
            }
            this.overrideAllToggle.setDisabled(overrideDisabled);
        }

        this.overrideAllSetting?.setDisabled(overrideDisabled);

        this.isUpdatingMasterToggles = false;
    }

    onClose() {
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
    return typeof item === 'object' && item !== null && 'isVaultSearchTrigger' in item && item.isVaultSearchTrigger === true;
}
// --- End Type Predicate Function ---

class TemplateSuggestModal extends FuzzySuggestModal<SuggestModalItem> {
    templates: TFile[];
    onChoose: (result: TFile | null) => void;
    appInstance: App;

    searchMode: 'templates' | 'recent' | 'vault';
    recentTemplates: string[] = [];
    inputListener: () => void;

    private static readonly VAULT_SEARCH_TRIGGER: SpecialTriggerItem = {
        isVaultSearchTrigger: true,
        name: "Click to see recently used templates or search within the entire vault...",
    };

    constructor(
        app: App,
        templates: TFile[],
        onChoose: (result: TFile | null) => void,
        recentTemplates: string[] = [],
        initialMode: 'templates' | 'recent' | 'vault' = 'templates'
    ) {
        super(app);
        this.appInstance = app;
        this.templates = templates;
        this.onChoose = onChoose;
        this.recentTemplates = recentTemplates;
        this.searchMode = initialMode;

        this.updatePlaceholder();

        if (this.searchMode === 'recent') {
            this.setupInputListener();
        }
    }

    private updatePlaceholder(): void {
        if (this.searchMode === 'templates') {
            this.setPlaceholder("Search predefined templates...");
        } else {
            this.setPlaceholder("Search all vault files...");
        }
    }

    private setupInputListener(): void {
        if (this.inputListener) {
            this.inputEl.removeEventListener('input', this.inputListener);
        }

        this.inputListener = () => {
            if (this.searchMode === 'recent') {
                this.searchMode = 'vault';
            }
        };

        this.inputEl.addEventListener('input', this.inputListener);
    }

    getItems(): SuggestModalItem[] {
        const getSortedFiles = (files: TFile[]): TFile[] => {
            const filesByFolder = new Map<string, TFile[]>();
            const rootFiles: TFile[] = [];

            const folders = new Set<string>();

            files.forEach(file => {
                const path = file.path;
                const lastSlashIndex = path.lastIndexOf('/');

                if (lastSlashIndex === -1) {
                    rootFiles.push(file);
                } else {
                    const folderPath = path.substring(0, lastSlashIndex);
                    folders.add(folderPath);

                    if (!filesByFolder.has(folderPath)) {
                        filesByFolder.set(folderPath, []);
                    }
                    filesByFolder.get(folderPath)?.push(file);
                }
            });

            const sortedFolders = Array.from(folders).sort();

            const result: TFile[] = [];

            const getDirectFiles = (folderPath: string): TFile[] => {
                const folderFiles = filesByFolder.get(folderPath) || [];
                return folderFiles.filter(file => {
                    const fileFolderPath = file.path.substring(0, file.path.lastIndexOf('/'));
                    return fileFolderPath === folderPath;
                }).sort((a, b) => a.basename.localeCompare(b.basename));
            };

            sortedFolders.forEach(folder => {
                if (!folder.includes('/') || folder.split('/').length === 1) {
                    sortedFolders
                        .filter(subFolder => subFolder !== folder && subFolder.startsWith(folder + '/'))
                        .sort()
                        .forEach(subFolder => {
                            result.push(...getDirectFiles(subFolder));
                        });

                    result.push(...getDirectFiles(folder));
                }
            });

            result.push(...rootFiles.sort((a, b) => a.basename.localeCompare(b.basename)));

            return result;
        };

        if (this.searchMode === 'vault') {
            return getSortedFiles(this.appInstance.vault.getMarkdownFiles());
        } else if (this.searchMode === 'recent') {
            const recentFiles = this.appInstance.vault.getMarkdownFiles()
                .filter(file => this.recentTemplates.includes(file.path));
            return getSortedFiles(recentFiles);
        } else {
            return [TemplateSuggestModal.VAULT_SEARCH_TRIGGER, ...getSortedFiles(this.templates)];
        }
    }

    getItemText(item: SuggestModalItem): string {
        if (isSpecialTriggerItem(item)) {
            return item.name;
        }

        let displayPath: string;
        const parentPath = item.parent?.path;

        if (parentPath && parentPath !== '/') {
            displayPath = `${parentPath}/${item.basename}`;
        } else {
            displayPath = item.basename;
        }

        return displayPath;
    }

    // Override renderSuggestion to handle both TFile and the special trigger item
    renderSuggestion(match: FuzzyMatch<SuggestModalItem>, el: HTMLElement): void {
        el.empty();
        el.addClass('suggestion-item');
        el.addClass('template-suggestion-item');

        const item = match.item;

        const content = el.createDiv({ cls: 'suggestion-content' });

        if (isSpecialTriggerItem(item)) {
            el.addClass('template-suggestion-trigger');
            const icon = content.createDiv({ cls: 'suggestion-icon' });
            setIcon(icon, 'search');

            content.createDiv({
                cls: 'suggestion-title is-trigger',
                text: item.name
            });
        } else {
            let displayPath: string;
            const parentPath = item.parent?.path;

            if (parentPath && parentPath !== '/') {
                displayPath = `${parentPath}/${item.basename}`;
            } else {
                displayPath = item.basename;
            }

            content.createDiv({
                cls: 'suggestion-title',
                text: displayPath
            });

            if (this.recentTemplates.includes(item.path)) {
                el.createDiv({
                    cls: 'recent-template-tag',
                    text: 'Recent'
                });
            }
        }
    }

    onChooseItem(item: SuggestModalItem, _evt: MouseEvent | KeyboardEvent): void {
        if (isSpecialTriggerItem(item)) {
            new TemplateSuggestModal(
                this.appInstance,
                [],
                this.onChoose,
                this.recentTemplates,
                'recent'
            ).open();
        } else {
            this.onChoose(item);
        }
    }

    onClose() {
        super.onClose();

        if (this.inputListener) {
            this.inputEl.removeEventListener('input', this.inputListener);
        }
    }
}
