// src/modals/BulkEditor.ts
import { App, Modal, TFile, Setting, ButtonComponent, DropdownComponent, ToggleComponent, Notice, setIcon, setTooltip } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import type { PropertyWithType } from '../PropertyTypeService';
import { formatValuePreview, formatInputValue } from '../commonHelpers';
import { PROPERTY_TYPES } from '../constants';
import { getEmptyValueForType, getDefaultTypeForKey } from '../commonHelpers';

// Define interfaces for the state tracking
interface PropertyState {
    key: string;
    enabled: boolean;
    expanded: boolean;
    applyOrder: boolean;
    changeType: string | null; // null means use detected/no override
    // overrideValue: string | null; // REMOVED - Merged into selectedValueOverride logic
    selectedValueOverride?: any | null; // Stores value from new input/pill container OR selection modal
    disabledAction: 'global' | 'keep' | 'remove' | 'add_if_missing';
    excludedFiles: Set<string>;
    fileActions: Map<string, {
        type: boolean;
        value: boolean;
        add: boolean;
    }>;
}

/* Interface for property consistency statistics */
interface PropertyConsistencyStats {
    property: { total: number; present: number };
    type: { total: number; consistent: number; mostCommonType: string | null };
    value: {
        total: number;
        consistent: number;
        mostCommonValue: any;
        firstEncounteredValue: any;
        allUniqueValues: any[];
    };
}

export class BulkEditor extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];

    private expandCollapseButton: ButtonComponent | null = null;

    private propertyToggles: Array<{
        key: string,
        dropdown: DropdownComponent
    }> = [];

    // Element references for UI updates
    private enableDisableToggle: ToggleComponent | null = null;
    private applyButton: ButtonComponent | null = null;
    private propertiesListContainer: HTMLElement | null = null;

    // State tracking
    private globalSettings = {
        enableAll: true,
        disabledAction: 'keep' as 'keep' | 'remove' | 'add_if_missing',
        applyCustomOrder: false,
        expandAll: false
    };

    private propertiesState: Map<string, PropertyState> = new Map();
    private propertyConsistency: Map<string, PropertyConsistencyStats> = new Map();
    
    // File property cache (to avoid repeated processing)
    private fileProperties: Map<string, Record<string, PropertyWithType>> = new Map();

    // Drag and drop tracking
    private draggedItem: HTMLElement | null = null;
    private propertyOrder: string[] = [];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Main header
        new Setting(contentEl)
        .setName('Bulk Property Editor')
        .setHeading();
    
        // Add description
        new Setting(contentEl)
        .setDesc(`Editing properties across ${this.files.length} ${this.files.length === 1 ? 'file' : 'files'}.`);
            
        // Create the main sections
        const controlsSection = contentEl.createDiv({ 
            cls: 'controls-section',
            attr: { id: 'controlsSection' }
        });
        
        // Add global options section
        this.createGlobalOptionsSection(controlsSection);
        
        // Properties list header
        new Setting(contentEl)
        .setName('Properties List')
        .setHeading();
        
        // Add expand/collapse all toggle
        this.createExpandCollapseButton(contentEl);
        
        // Properties list container (this becomes the main list area)
        const propertiesContainer = contentEl.createDiv({
            cls: 'properties-list-container', // Keep this class
            // Add the ID and scrolling directly here
            attr: { id: 'propertiesList' }
        });
        // Point the class member variable to this container
        this.propertiesListContainer = propertiesContainer;

        // REMOVED: No longer creating the inner .properties-list div
        // this.propertiesListContainer = propertiesContainer.createDiv({ ... });

        // Loading indicator (create directly in the container)
        const loadingEl = this.propertiesListContainer.createEl('div', {
            cls: 'property-loading-container',
            text: 'Loading properties...'
        });

        // Add new property button (append *inside* the container now)
        const addPropertyBtn = this.propertiesListContainer.createDiv({ // Append here
            cls: 'add-property-list-item',
            attr: { id: 'addPropertyBtn' }
        });
        addPropertyBtn.innerHTML = '<span>+</span> Add New Property';
        this.plugin.registerDomEvent(addPropertyBtn, 'click', this.handleAddProperty.bind(this)); // Use registerDomEvent
        
        try {
            // Load and display properties
            await this.loadProperties(); // This will append items to this.propertiesListContainer
            loadingEl.remove();
            this.updateExpandCollapseButtonState();

            // Re-append the add button to ensure it's at the bottom after loading
            this.propertiesListContainer.appendChild(addPropertyBtn);

        } catch (error) {
            console.error('Error loading properties:', error);
            loadingEl.setText('Error loading properties. Please try again.');
            loadingEl.addClass('property-error');
            // Also ensure Add button is visible even on error
             this.propertiesListContainer.appendChild(addPropertyBtn);
        }

        // Button container at the bottom of the modal
        const buttonContainer = this.modalEl.createDiv({
            cls: 'modal-button-container'
        });
        
        // Apply button
        this.applyButton = new ButtonComponent(buttonContainer)
            .setButtonText('Apply Changes')
            .setCta()
            .onClick(() => {
                this.applyChanges();
            });
            
        // Cancel button
        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.plugin.navigateToModal(this, 'main');
            });
    }
    
    /**
     * Creates the global options section at the top of the modal
     */
    private createGlobalOptionsSection(container: HTMLElement) {
        // Global Options Header
        new Setting(container)
        .setName('Global Options')
        .setHeading();
        
        // Enable/Disable All Edits
        new Setting(container)
            .setName('Enable/Disable All Edits')
            .setDesc('Toggle to apply change for all properties below.')
            .addToggle(toggle => {
                this.enableDisableToggle = toggle
                    .setValue(this.globalSettings.enableAll)
                    .onChange(value => {
                        this.globalSettings.enableAll = value;
                        this.updateAllPropertyToggles(value);
                    });
                return toggle;
            });
            
        // Action for Disabled Properties
        const disabledActionSetting = new Setting(container)
            .setName('Action for Disabled Properties')
            .setDesc('Choose what happens to properties whose individual edit toggle is off.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('keep', 'Keep Existing (Do Nothing if Missing)')
                    .addOption('remove', 'Remove Property')
                    .addOption('add_if_missing', 'Add Empty if Missing (Keep Existing)')
                    .setValue(this.globalSettings.disabledAction)
                    .onChange(value => {
                        this.globalSettings.disabledAction = value as 'keep' | 'remove' | 'add_if_missing';
                    });
                return dropdown;
            });
    
        // Add the note to the description
        disabledActionSetting.descEl.createEl('br');
        disabledActionSetting.descEl.createSpan({
            cls: 'setting-description-note',
            text: "Note: Option 'Add Empty if Missing' uses the already defined property type. If doesn't exist, defaults to 'Text' type."
        });
            
        // Apply Custom Order
        new Setting(container)
            .setName('Apply Custom Order')
            .setDesc('Apply the manually dragged order of properties below.')
            .addToggle(toggle => {
                toggle
                    .setValue(this.globalSettings.applyCustomOrder)
                    .onChange(value => {
                        this.globalSettings.applyCustomOrder = value;
                    });
                return toggle;
            });
    }
    
    /**
     * Creates the expand/collapse all button
     */
    private createExpandCollapseButton(container: HTMLElement) {
        new Setting(container)
            .setName('Expand/Collapse All') // Keep Name/Desc for context
            .setDesc('Toggle expansion state for all properties below.')
            .addButton(button => { // Use addButton instead of addToggle
                // Store the button component instance
                this.expandCollapseButton = button;

                // Initial state will be set after properties load
                button.setButtonText("Expand All") // Default text
                    .setTooltip('Expand all properties') // Default tooltip
                    .onClick(() => {
                        // Toggle the global state
                        this.globalSettings.expandAll = !this.globalSettings.expandAll;
                        // Update the UI of individual properties
                        this.updateAllExpansionState(this.globalSettings.expandAll);
                        // Update the button itself
                        this.updateExpandCollapseButtonState();
                    });
            })
            .settingEl.setAttrs({ id: 'expandCollapseAllContainer' }); // Keep ID if needed
    }

    /**
     * Updates the Expand/Collapse All button text and tooltip based on the current state.
     */
    private updateExpandCollapseButtonState() {
        if (!this.expandCollapseButton) return;

        if (this.globalSettings.expandAll) {
            this.expandCollapseButton.setButtonText("Collapse All");
            this.expandCollapseButton.setTooltip('Collapse all properties');
        } else {
            this.expandCollapseButton.setButtonText("Expand All");
            this.expandCollapseButton.setTooltip('Expand all properties');
        }
    }
    
    /**
     * Updates all property toggle states based on the master toggle
     */
    private updateAllPropertyToggles(enabled: boolean) {
        // Update each property's enabled state
        this.propertiesState.forEach((state, key) => {
            state.enabled = enabled;
        });
        
        // Update the UI
        const propertyToggles = this.propertiesListContainer?.querySelectorAll('.edit-enable-toggle') || [];
        propertyToggles.forEach(toggle => {
            if (toggle instanceof HTMLInputElement) {
                toggle.checked = enabled;
            }
        });
    }
    
    /**
     * Updates the expanded/collapsed state of all properties
     */
    private updateAllExpansionState(expanded: boolean) {
        // Update each property's expansion state in the propertiesState map
        this.propertiesState.forEach((state, key) => {
            state.expanded = expanded;
        });

        // Update the UI (find items and update classes/icons)
        const propertyItems = this.propertiesListContainer?.querySelectorAll('.bulk-property-item') || [];
        propertyItems.forEach(item => {
            const header = item.querySelector('.setting-item.bulk-property-item-header-setting'); // Use updated selector
            const contentContainer = item.querySelector('.property-content') as HTMLElement | null; // Use updated selector

            // Update ARIA attribute for accessibility
            if (header) {
                header.setAttribute('aria-expanded', String(expanded));
            }
        });
    }
    
    /**
     * Loads properties from all files and calculates consistency statistics
     */
    async loadProperties() {
        if (!this.propertiesListContainer) return;
        
        // Clear existing content
        this.propertiesListContainer.empty();
        
        try {
            // Load properties from all files
            for (const file of this.files) {
                const properties = await this.plugin.parseFileProperties(file);
                const propertiesWithType = this.plugin.propertyCache.get(file.path) || {};
                
                // Store in our local cache
                this.fileProperties.set(file.path, propertiesWithType);
                
                // Track all unique property keys
                Object.keys(propertiesWithType).forEach(key => {
                    if (!this.propertiesState.has(key)) {
                        // Initialize property state
                        this.propertiesState.set(key, {
                            key,
                            enabled: true,
                            expanded: this.globalSettings.expandAll,
                            applyOrder: true,
                            changeType: null,
                            disabledAction: 'global',
                            excludedFiles: new Set<string>(),
                            fileActions: new Map()
                        });
                        
                        // Add to property order
                        this.propertyOrder.push(key);
                        
                        // Initialize consistency tracking
                        this.propertyConsistency.set(key, {
                            property: { total: this.files.length, present: 0 },
                            type: { total: 0, consistent: 0, mostCommonType: null },
                            value: { // Ensure all value fields are initialized
                                total: 0,
                                consistent: 0,
                                mostCommonValue: null,
                                firstEncounteredValue: undefined, // Add this
                                allUniqueValues: [] // Add this
                            }
                        });
                    }
                    
                    // Update consistency stats
                    this.updatePropertyConsistency(key, file.path, propertiesWithType[key]);
                });
            }
            
            // If no properties found, show message
            if (this.propertiesState.size === 0) {
                this.propertiesListContainer.createEl('div', {
                    cls: 'property-empty-state',
                    text: 'No properties found across the selected files.'
                });
                return;
            }
            
            // Calculate most common types and values
            this.finalizeConsistencyCalculations();
            
            // Render properties in order
            for (const key of this.propertyOrder) {
                this.renderPropertyItem(key);
            }
            
            // Setup drag and drop for property ordering
            this.setupDragAndDrop();
        } catch (error) {
            console.error('Error loading properties:', error);
            new Notice('Failed to load properties. Please try again.');
        }
    }
    
    /**
     * Updates consistency tracking for a property
     */
    private updatePropertyConsistency(key: string, filePath: string, property: PropertyWithType) {
        const stats = this.propertyConsistency.get(key);
        if (!stats) return;
        
        // Update property presence
        stats.property.present++;
        
        // Update type consistency
        stats.type.total++;
        
        // Initialize file actions tracking
        const state = this.propertiesState.get(key);
        if (state && !state.fileActions.has(filePath)) {
            state.fileActions.set(filePath, {
                type: false,
                value: false,
                add: false
            });
        }
    }
    
    /**
     * Finalizes consistency calculations by determining most common types and values,
     * collecting unique values, and storing the first encountered value.
     */
    private finalizeConsistencyCalculations() {
        this.propertyConsistency.forEach((stats, key) => {
            const typeCount = new Map<string, number>();
            const valueDetails = {
                counts: new Map<string, { count: number; value: any }>(),
                firstValue: undefined as any,
                hasFoundFirst: false,
                uniqueValuesSet: new Set<string>(), // Store stringified unique values
                uniqueValues: [] as any[] // Store actual unique values
            };

            // Process each file's property
            this.files.forEach(file => {
                const properties = this.fileProperties.get(file.path);
                if (!properties || !(key in properties)) return;

                const property = properties[key];

                // Store first encountered value
                if (!valueDetails.hasFoundFirst) {
                    valueDetails.firstValue = property.value;
                    valueDetails.hasFoundFirst = true;
                }

                // Count types
                const type = property.type;
                typeCount.set(type, (typeCount.get(type) || 0) + 1);

                // Count values (stringify for comparison, store original value)
                const valueStr = JSON.stringify(property.value); // Key for counting
                if (!valueDetails.counts.has(valueStr)) {
                    valueDetails.counts.set(valueStr, { count: 0, value: property.value });
                }
                valueDetails.counts.get(valueStr)!.count++;

                // Collect unique values
                if (!valueDetails.uniqueValuesSet.has(valueStr)) {
                    valueDetails.uniqueValuesSet.add(valueStr);
                    valueDetails.uniqueValues.push(property.value);
                }
            });

            // Find most common type
            let mostCommonType: string | null = null;
            let maxTypeCount = 0;
            typeCount.forEach((count, type) => {
                if (count > maxTypeCount) {
                    maxTypeCount = count;
                    mostCommonType = type;
                }
            });

            // Find most common value
            let mostCommonValue: any = null;
            let maxValueCount = 0;
            valueDetails.counts.forEach(({ count, value }) => {
                if (count > maxValueCount) {
                    maxValueCount = count;
                    mostCommonValue = value;
                }
            });

            // Update main stats
            stats.type.consistent = mostCommonType ? typeCount.get(mostCommonType) || 0 : 0;
            stats.type.mostCommonType = mostCommonType;

            // Ensure value stats are initialized if they weren't already
             if (!stats.value) {
                 stats.value = {
                     total: stats.type.total, // total value count is same as type count
                     consistent: 0,
                     mostCommonValue: null,
                     firstEncounteredValue: undefined,
                     allUniqueValues: []
                 };
             }

            stats.value.total = stats.type.total; // Update total count
            stats.value.consistent = maxValueCount;
            stats.value.mostCommonValue = mostCommonValue;
            stats.value.firstEncounteredValue = valueDetails.firstValue;
            stats.value.allUniqueValues = valueDetails.uniqueValues;

        });
    }
    
    /**
     * Renders a single property item in the list
     */
    private renderPropertyItem(key: string) {
        // Ensure propertiesListContainer exists before proceeding
        if (!this.propertiesListContainer) return;

        // Retrieve state and stats for the property key
        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);

        // Guard clause: Exit if state or stats are missing
        if (!state || !stats) return;

        // Create property item container div
        const propertyItem = this.propertiesListContainer.createDiv({
            cls: `bulk-property-item ${state.expanded ? '' : 'is-collapsed'}`,
            attr: { id: `prop-${key}` }
        });

        // --- Header Section (Using Setting Component) ---
        const propertyHeaderSetting = new Setting(propertyItem);
        propertyHeaderSetting.settingEl.addClass('bulk-property-item-header-setting');

        // Property Name
        propertyHeaderSetting.setName(key);

        // ARIA attributes
        propertyHeaderSetting.settingEl.setAttrs({
            'aria-expanded': state.expanded.toString(),
            'role': 'button',
            'tabindex': '0'
        });

        // --- Status Text moved to Description Area ---
        const descEl = propertyHeaderSetting.descEl;
        descEl.empty(); // Clear default description content
        descEl.addClass('bulk-property-stats-description'); // Add class for styling

        // --- Controls Area (Toggle and Drag Handle only) ---
        const controlEl = propertyHeaderSetting.controlEl;
        controlEl.addClass('bulk-property-item-header-controls');

        // Edit Enabled Toggle
        propertyHeaderSetting.addToggle(toggle => {
            toggle.setValue(state.enabled)
                .setTooltip(`Toggle editing for ${key} property`)
                .onChange(value => {
                    state.enabled = value;
                    this.updateMasterEnableToggleState();
                });
             toggle.toggleEl.parentElement?.addClass('edit-toggle-control-wrapper');
        });

        // Drag Handle
        const dragHandle = controlEl.createSpan({
            cls: 'drag-handle', text: '☰',
            attr: { draggable: 'true', title: `Drag to reorder ${key} property` }
        });

        // Helper function to add a status row
        const addStatusRow = (label: string, value: string, isConsistent: boolean) => {
            const row = descEl.createDiv({ cls: 'property-header-stat-row' }); // Each status on a new div/row
            // Add icon based on consistency
            row.createSpan({
                cls: `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`,
                text: isConsistent ? '✓' : '⚠' // Use checkmark or warning
            });
            row.createSpan({ cls: 'property-header-stat-label', text: `${label}: ` });
            row.createSpan({ cls: 'property-header-stat-value', text: value });
        };

        // Add status rows
        addStatusRow(
            'Property',
            `${stats.property.present}/${stats.property.total}`,
            stats.property.present === stats.property.total
        );
        addStatusRow(
            'Type',
            `${stats.type.consistent}/${stats.type.total}`,
            stats.type.consistent === stats.type.total
        );
        addStatusRow(
            'Value',
            `${stats.value.consistent}/${stats.type.total}`,
            stats.value.consistent === stats.type.total
        );

        // --- Dynamic Hint Text Span ---
        const hintSpan = descEl.createSpan({ cls: 'property-toggle-hint' });
        hintSpan.textContent = state.expanded ? 'Toggle to hide options.' : 'Toggle to display options.';

        // --- Options Section ---
        const contentContainer = propertyItem.createDiv({ cls: 'property-content' });
        if (!state.expanded) { contentContainer.style.display = 'none'; }

        // Section header
        new Setting(contentContainer)
            .setName('Options')
            .setHeading()
            .settingEl.addClass('bulk-editor-section-heading');

        // Action if Edit Disabled
        new Setting(contentContainer)
            .setName('Action if Edit Disabled')
            .setDesc('Overrides global setting if the edit toggle above is off.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('global', 'Use Global Setting (Default)')
                    .addOption('keep', 'Keep Existing')
                    .addOption('remove', 'Remove Property')
                    .addOption('add_if_missing', 'Add Empty if Missing')
                    .setValue(state.disabledAction)
                    .onChange(value => {
                        state.disabledAction = value as 'global' | 'keep' | 'remove' | 'add_if_missing';
                    });
                // Add tooltip for accessibility/clarity
                setTooltip(dropdown.selectEl, 'Choose action for this property if its edit toggle is disabled.');
            });

        // Apply Order for This Property
        new Setting(contentContainer)
            .setName('Apply Order for This Property')
            .setDesc('When enabled, the position of this property in the list will be preserved on apply.')
            .addToggle(toggle => {
                toggle
                    .setValue(state.applyOrder)
                    .setTooltip(`Toggle order preservation for ${key}`)
                    .onChange(value => {
                        state.applyOrder = value;
                    });
            });

        // Property Type (Interactive Dropdown)
        const typeSetting = new Setting(contentContainer)
            .setName('Property Type');

        const typeDescEl = typeSetting.descEl;
        typeDescEl.empty(); // Clear default

        // Determine default type
        const defaultType = stats.type.mostCommonType; // Can be null

        // Check if property exists at all to determine if a type *should* be detected
        const propertyExistsInAnyFile = stats.property.present > 0;

        if (propertyExistsInAnyFile && defaultType) {
            // A common type exists
            const defaultTypeDisplayName = this.plugin.propertyTypeService.getPropertyTypeDisplayName(defaultType);
             typeDescEl.createSpan({ text: `Most common type: '${defaultTypeDisplayName}'. Select to override.`});

            typeSetting.addDropdown(dropdown => {
                dropdown.addOption("", defaultTypeDisplayName); // Value "" means no override

                PROPERTY_TYPES.forEach(propType => {
                    if (propType.value !== defaultType) {
                        dropdown.addOption(propType.value, propType.label);
                    }
                });

                dropdown.setValue(state.changeType || ""); // Select override or default ""
                dropdown.onChange(value => {
                    const newSelectedType = value === "" ? null : value;
                    const effectiveType = newSelectedType || defaultType; // Determine the type to convert to
    
                    // Convert the current value to the new type
                    const convertedValue = this.convertValueToType(state.selectedValueOverride, effectiveType);
    
                    // Update the state
                    state.changeType = newSelectedType;
                    state.selectedValueOverride = convertedValue;
    
                    // Update the text input display
                    const valueInput = contentContainer.querySelector(`.bulk-value-input[data-property-key="${key}"]`) as HTMLInputElement | null;
                    if (valueInput) {
                        valueInput.value = formatInputValue(convertedValue);
                    }
    
                    console.log(`Type for ${key} changed to effective: ${effectiveType}. Value converted and input updated.`);
                    // Later: This is also where we'd switch between text/pill input
                });
                 setTooltip(dropdown.selectEl, `Detected type: ${defaultTypeDisplayName}. Select a different type to apply.`);
            });
        } else {
            // No consistent type detected OR property doesn't exist in any file
             typeDescEl.createSpan({
                 cls: 'setting-warning-text', // Use warning class
                 text: propertyExistsInAnyFile
                    ? '⚠️ No consistent type detected. Please select a type.'
                    : 'Property not found in any selected file. Select a type to add it.'
             });

            typeSetting.addDropdown(dropdown => {
                dropdown.addOption("", "-- Select Type --"); // Placeholder

                PROPERTY_TYPES.forEach(propType => {
                    dropdown.addOption(propType.value, propType.label);
                });

                dropdown.setValue(state.changeType || ""); // Select override or placeholder ""
                dropdown.onChange(value => {
                    const newSelectedType = value === "" ? null : value;
                    // Determine the actual type we are converting to
                    const effectiveType = newSelectedType || defaultType || 'text'; // Fallback to 'text'
    
                    // Convert the current value to the new type
                    const convertedValue = this.convertValueToType(state.selectedValueOverride, effectiveType);
    
                    // Update the state
                    state.changeType = newSelectedType;
                    state.selectedValueOverride = convertedValue;
    
                    // Find the textarea associated with this property
                    const valueTextarea = contentContainer.querySelector(`textarea.bulk-value-textarea[data-property-key="${key}"]`) as HTMLTextAreaElement | null;
                    if (valueTextarea) {
                        // Update the textarea's displayed value
                        valueTextarea.value = formatInputValue(convertedValue);
                        // Trigger resize after changing value programmatically
                        this.autoResizeTextarea(valueTextarea);
                    }
    
                    console.log(`Type for ${key} changed to effective: ${effectiveType}. Value converted and input updated.`);
                    // Later: This is also where we'd switch between textarea/pill input
                });
                 setTooltip(dropdown.selectEl, 'Select the desired property type.');
            });
        }


        // --- Property Value (Textarea + Select Button Inside) ---
        // Setting for Label/Description Only
        const valueSetting = new Setting(contentContainer)
             .setName('Property Value')
             .setDesc('Enter value or select existing.');
             // No controls added directly to the setting line itself

        // Wrapper for Textarea and Button
        const valueWrapper = contentContainer.createDiv({ cls: 'bulk-value-wrapper' });

        // Determine initial value to display (same logic as before)
         let initialDisplayValue = '';
         // Use state value first if it was already set (e.g., by type conversion)
         if (state.selectedValueOverride !== null && state.selectedValueOverride !== undefined) {
            initialDisplayValue = formatInputValue(state.selectedValueOverride);
         } else if (stats.value.consistent > 0 && stats.value.mostCommonValue !== undefined) {
             initialDisplayValue = formatInputValue(stats.value.mostCommonValue);
             state.selectedValueOverride = stats.value.mostCommonValue; // Ensure state reflects initial display
         } else if (stats.value.firstEncounteredValue !== undefined) {
             initialDisplayValue = formatInputValue(stats.value.firstEncounteredValue);
             state.selectedValueOverride = stats.value.firstEncounteredValue; // Ensure state reflects initial display
         }
         // Fallback if all else fails
          state.selectedValueOverride = state.selectedValueOverride ?? null;


        // Create Textarea inside Wrapper
        const textarea = valueWrapper.createEl('textarea');
        textarea.addClasses(['bulk-value-input', 'bulk-value-textarea', 'input', 'markdown-source-view', 'mod-cm6']);
        textarea.setAttribute('data-property-key', key);
        textarea.placeholder = 'Enter value...';
        textarea.value = initialDisplayValue;

        // Attach input listener for auto-resize and state update
        this.plugin.registerDomEvent(textarea, 'input', () => {
             this.autoResizeTextarea(textarea); // Auto-resize on input
             // Update state logic
             const currentTargetType = state.changeType || stats.type.mostCommonType;
             const typedValue = this.parseInputToTypedValue(textarea.value, currentTargetType);
             state.selectedValueOverride = typedValue;
        });

        // Initial resize after setting value
        this.autoResizeTextarea(textarea);

        // Create Select Button inside Wrapper
        const selectButton = valueWrapper.createDiv({
            cls: 'bulk-value-select-button clickable-icon',
            attr: { title: 'Select an existing value', role: 'button', tabindex: '0' }
        });
        setIcon(selectButton, 'list'); // Use list icon

        // Attach placeholder click logic
        this.plugin.registerDomEvent(selectButton, 'click', () => {
             new Notice(`Modal for selecting existing values for "${key}" not yet implemented.`);
             // TODO: Add ExistingValuesModal opening logic
        });
         // Add keydown listener for accessibility (Enter/Space to trigger click)
         this.plugin.registerDomEvent(selectButton, 'keydown', (e: KeyboardEvent) => {
             if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                selectButton.click();
             }
         });
        // --- End Property Value ---


        // --- Inconsistent Files Section (Keep as is for now) ---
        this.createInconsistentFilesSection(contentContainer, key);


        // --- Event Handlers ---
        this.plugin.registerDomEvent(propertyHeaderSetting.settingEl, 'click', (e: MouseEvent) => {
            // Ignore clicks on controls
            if (controlEl.contains(e.target as Node)) { return; }

            // Toggle state
            state.expanded = !state.expanded;

            // Find the hint span dynamically if needed, though the 'hintSpan' variable should still be in scope
            const currentHintSpan = propertyHeaderSetting.descEl.querySelector('.property-toggle-hint'); // More robust way to find it

            // Update UI
            if (state.expanded) {
                propertyItem.classList.remove('is-collapsed');
                contentContainer.style.display = '';
                propertyHeaderSetting.settingEl.setAttribute('aria-expanded', 'true');
                if (currentHintSpan) currentHintSpan.textContent = 'Toggle to hide options.'; // Update hint text
            } else {
                propertyItem.classList.add('is-collapsed');
                contentContainer.style.display = 'none';
                propertyHeaderSetting.settingEl.setAttribute('aria-expanded', 'false');
                if (currentHintSpan) currentHintSpan.textContent = 'Toggle to display options.'; // Update hint text
            }
            // Update the global expand/collapse button state if necessary
            this.updateExpandCollapseButtonState();
        });

        this.plugin.registerDomEvent(propertyHeaderSetting.settingEl, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                // Prevent toggling if focus is on the actual checkbox toggle in controls
                if (e.target instanceof HTMLElement && controlEl.contains(e.target) && e.target.closest('.checkbox-container')) { return; }
                // Allow toggling if focus is anywhere else in the header, except controls
                if (!controlEl.contains(e.target as Node)) {
                e.preventDefault();
                propertyHeaderSetting.settingEl.click(); // Simulate click to trigger expansion logic
                }
            }
        });
    }

    /**
     * Creates the inconsistent files section for a property
     */
    private createInconsistentFilesSection(container: HTMLElement, key: string) {
        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);
        if (!state || !stats) return;
        
        // Section header
        new Setting(container)
            .setName('Inconsistent Files')
            .setHeading()
            .settingEl.addClass('bulk-editor-section-heading'); // Optional class for styling
        
        const inconsistentFiles = this.getInconsistentFiles(key);
        const inconsistentFilesContainer = container.createDiv({ cls: 'inconsistent-files-container' });
        const filterOrderRow = inconsistentFilesContainer.createDiv({ cls: 'filter-order-row' });
        
        // Order by dropdown
        filterOrderRow.createEl('label', { 
            text: 'Order by:',
            attr: { for: `order-by-${key}` }
        });
        
        const orderBySelect = filterOrderRow.createEl('select', { 
            cls: 'inconsistent-order-by',
            attr: { 
                id: `order-by-${key}`,
                title: 'Order inconsistent files'
            }
        });
        
        orderBySelect.appendChild(new Option('File Name (A-Z)', 'name-asc', true, true));
        orderBySelect.appendChild(new Option('File Name (Z-A)', 'name-desc'));
        
        // Filter by dropdown
        filterOrderRow.createEl('label', { 
            text: 'Filter by:',
            attr: { for: `filter-by-${key}` }
        });
        
        const filterBySelect = filterOrderRow.createEl('select', { 
            cls: 'inconsistent-filter-by',
            attr: { 
                id: `filter-by-${key}`,
                title: 'Filter inconsistent files'
            }
        });
        
        filterBySelect.appendChild(new Option('All', 'all', true, true));
        filterBySelect.appendChild(new Option('Type Mismatch', 'type'));
        filterBySelect.appendChild(new Option('Value Mismatch', 'value'));
        filterBySelect.appendChild(new Option('Missing Property', 'missing'));
        
        // Exclude All Files toggle
        const inconsistentFilesControls = inconsistentFilesContainer.createDiv({ cls: 'inconsistent-files-controls' });
        
        const excludeAllSetting = new Setting(inconsistentFilesControls)
            .setName('Exclude All Files')
            .setDesc('Toggle exclusion for all files listed below.');
            
        const excludeAllToggle = excludeAllSetting.addToggle(toggle => {
            toggle
                .setValue(false)
                .onChange(value => {
                    // Update all file exclusions
                    this.updateAllFileExclusions(key, value);
                    
                    // Update UI for all files in this property
                    const fileToggles = inconsistentFilesContainer.querySelectorAll('.exclude-file-toggle');
                    fileToggles.forEach(toggle => {
                        if (toggle instanceof HTMLInputElement) {
                            toggle.checked = value;
                            
                            // Find parent file item and update class
                            const fileItem = toggle.closest('.inconsistent-file-item');
                            if (fileItem) {
                                if (value) {
                                    fileItem.classList.add('is-excluded');
                                } else {
                                    fileItem.classList.remove('is-excluded');
                                }
                            }
                        }
                    });
                });
            return toggle;
        });
        
        // Inconsistent files list
        const inconsistentFilesList = inconsistentFilesContainer.createDiv({ cls: 'inconsistent-files-list' });
        
        // Handle no inconsistencies case
        if (inconsistentFiles.length === 0) {
            inconsistentFilesList.createEl('p', { text: 'No inconsistencies found.' });
            return;
        }
        
        // Create file items
        inconsistentFiles.forEach(file => {
            this.createInconsistentFileItem(inconsistentFilesList, key, file);
        });
        
        // Add event listeners for filtering and ordering
        this.plugin.registerDomEvent(orderBySelect, 'change', () => {
            this.reorderInconsistentFiles(key, inconsistentFilesList, orderBySelect.value, filterBySelect.value);
        });
        
        this.plugin.registerDomEvent(filterBySelect, 'change', () => {
            this.reorderInconsistentFiles(key, inconsistentFilesList, orderBySelect.value, filterBySelect.value);
        });
    }
    
    /**
     * Gets the list of files with inconsistencies for a property
     */
    private getInconsistentFiles(key: string): TFile[] {
        const stats = this.propertyConsistency.get(key);
        if (!stats) return [];
        
        // Determine most common type and value
        const mostCommonType = stats.type.mostCommonType;
        const mostCommonValue = stats.value.mostCommonValue;
        
        // Find files with inconsistencies
        return this.files.filter(file => {
            const properties = this.fileProperties.get(file.path);
            
            // Missing property
            if (!properties || !(key in properties)) {
                return true;
            }
            
            const property = properties[key];
            
            // Type mismatch
            if (mostCommonType && property.type !== mostCommonType) {
                return true;
            }
            
            // Value mismatch (use string comparison for safety)
            if (mostCommonValue !== null && JSON.stringify(property.value) !== JSON.stringify(mostCommonValue)) {
                return true;
            }
            
            return false;
        });
    }
    
    private handleAddProperty() {
        // Implement this for adding new properties
        new Notice('Add Property functionality coming soon!');
    }
    
    /**
     * Creates an inconsistent file item in the list
     */
    private createInconsistentFileItem(container: HTMLElement, propertyKey: string, file: TFile) {
        const state = this.propertiesState.get(propertyKey);
        const stats = this.propertyConsistency.get(propertyKey);
        const isFileExcluded = state?.excludedFiles.has(file.path) || false;
        
        if (!state || !stats) return;
        
        const properties = this.fileProperties.get(file.path);
        const propertyExists = properties && propertyKey in properties;
        const propertyValue = propertyExists ? properties![propertyKey].value : null;
        const propertyType = propertyExists ? properties![propertyKey].type : null;
        
        // Determine inconsistency types
        const inconsistencyTypes = {
            missing: !propertyExists,
            type: propertyExists && stats.type.mostCommonType && propertyType !== stats.type.mostCommonType,
            value: propertyExists && JSON.stringify(propertyValue) !== JSON.stringify(stats.value.mostCommonValue)
        };
        
        // Create file item
        const fileItem = container.createDiv({ 
            cls: `inconsistent-file-item ${isFileExcluded ? 'is-excluded' : ''}`,
            attr: { 'data-path': file.path }
        });
        
        // Create header
        const fileHeader = fileItem.createDiv({ cls: 'file-item-header' });
        
        // Create exclude toggle container
        const excludeToggleContainer = fileHeader.createDiv({ cls: 'setting-item file-header-exclude-toggle' });
        const excludeToggleControl = excludeToggleContainer.createDiv({ cls: 'setting-item-control' });
        
        const excludeToggle = excludeToggleControl.createEl('input', {
            type: 'checkbox',
            cls: 'setting-toggle exclude-file-toggle',
            attr: { 
                checked: isFileExcluded ? 'checked' : '',
                title: `Exclude this file from changes for ${propertyKey}`
            }
        });
        
        this.plugin.registerDomEvent(excludeToggle, 'change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            
            // Update state
            if (isChecked) {
                state.excludedFiles.add(file.path);
                fileItem.classList.add('is-excluded');
            } else {
                state.excludedFiles.delete(file.path);
                fileItem.classList.remove('is-excluded');
            }
            
            // Update "Exclude All" toggle state
            this.updateExcludeAllToggleState(propertyKey, container);
        });
        
        // View file icon
        const viewIcon = fileHeader.createEl('img', {
            cls: 'file-view-icon',
            attr: {
                src: 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/eye.svg',
                title: 'View File',
                alt: 'View File Icon'
            }
        });
        
        this.plugin.registerDomEvent(viewIcon, 'click', () => {
            // Open the file in a new pane
            this.app.workspace.getLeaf('tab').openFile(file);
        });
        
        // File path
        fileHeader.createSpan({ text: file.path });
        
        // Create content section
        const fileContent = fileItem.createDiv({ cls: 'file-item-content' });
        
        // File details based on inconsistency type
        if (inconsistencyTypes.missing) {
            fileContent.createDiv({ cls: 'file-item-details', text: 'Property Missing' });
            
            // Add missing property toggle
            new Setting(fileContent)
                .setName('Add missing property')
                .setDesc('Adds this property to the file. Type/Value determined by other options.')
                .addToggle(toggle => {
                    toggle
                        .setValue(false)
                        .onChange(value => {
                            const fileActions = state.fileActions.get(file.path) || { 
                                type: false, 
                                value: false, 
                                add: false 
                            };
                            fileActions.add = value;
                            state.fileActions.set(file.path, fileActions);
                        });
                    return toggle;
                });
                
            // Set common or override/add value
            new Setting(fileContent)
                .setName('Set common or override/add value')
                .setDesc('Applies the most common value or the value entered in \'Override/Add Value\' above. (Only if \'Add missing property\' is checked).')
                .addToggle(toggle => {
                    toggle
                        .setValue(false)
                        .onChange(value => {
                            const fileActions = state.fileActions.get(file.path) || { 
                                type: false, 
                                value: false, 
                                add: false 
                            };
                            fileActions.value = value;
                            state.fileActions.set(file.path, fileActions);
                        });
                    return toggle;
                });
                
            // Set common or override/add type
            new Setting(fileContent)
                .setName('Set common or override/add type')
                .setDesc('Applies the most common type or the type selected in \'Change Property Type\' above. (Only if \'Add missing property\' is checked).')
                .addToggle(toggle => {
                    toggle
                        .setValue(false)
                        .onChange(value => {
                            const fileActions = state.fileActions.get(file.path) || { 
                                type: false, 
                                value: false, 
                                add: false 
                            };
                            fileActions.type = value;
                            state.fileActions.set(file.path, fileActions);
                        });
                    return toggle;
                });
        } else {
            // Show current value and type
            const typeDisplay = propertyType 
                ? this.plugin.propertyTypeService.getPropertyTypeDisplayName(propertyType)
                : 'Unknown';
                
            const valuePreview = formatValuePreview(propertyValue, propertyType || undefined);
            
            fileContent.createDiv({ 
                cls: 'file-item-details',
                text: `Current Value: `
            }).createEl('code', { text: valuePreview });
            
            fileContent.querySelector('.file-item-details')!.appendText(` (Type: ${typeDisplay})`);
            
            // Type mismatch action
            if (inconsistencyTypes.type) {
                new Setting(fileContent)
                    .setName('Set to common or override/add type')
                    .setDesc('Applies the most common type or the type selected in \'Change Property Type\' above.')
                    .addToggle(toggle => {
                        const fileActions = state.fileActions.get(file.path) || { 
                            type: false, 
                            value: false, 
                            add: false 
                        };
                        
                        toggle
                            .setValue(fileActions.type)
                            .onChange(value => {
                                fileActions.type = value;
                                state.fileActions.set(file.path, fileActions);
                            });
                        return toggle;
                    });
            }
            
            // Value mismatch action
            if (inconsistencyTypes.value) {
                new Setting(fileContent)
                    .setName('Set to common or override/add value')
                    .setDesc('Applies the most common value or the value entered in \'Override/Add Value\' above.')
                    .addToggle(toggle => {
                        const fileActions = state.fileActions.get(file.path) || { 
                            type: false, 
                            value: false, 
                            add: false 
                        };
                        
                        toggle
                            .setValue(fileActions.value)
                            .onChange(value => {
                                fileActions.value = value;
                                state.fileActions.set(file.path, fileActions);
                            });
                        return toggle;
                    });
            }
        }
        
        // Add data attributes for filtering
        if (inconsistencyTypes.missing) {
            fileItem.setAttribute('data-inconsistency-missing', 'true');
        }
        
        if (inconsistencyTypes.type) {
            fileItem.setAttribute('data-inconsistency-type', 'true');
        }
        
        if (inconsistencyTypes.value) {
            fileItem.setAttribute('data-inconsistency-value', 'true');
        }
    }
    
    /**
     * Updates the "Exclude All Files" toggle state based on individual file toggles
     */
    private updateExcludeAllToggleState(propertyKey: string, container: HTMLElement) {
        const excludeAllToggle = container.querySelector('.exclude-all-files-toggle') as HTMLInputElement;
        if (!excludeAllToggle) return;
    
        const fileToggles = container.querySelectorAll('.exclude-file-toggle');
        if (fileToggles.length === 0) {
            excludeAllToggle.checked = false;
            return;
        }
        
        let allChecked = true;
        fileToggles.forEach(toggle => {
            if (toggle instanceof HTMLInputElement && !toggle.checked) {
                allChecked = false;
            }
        });
        
        excludeAllToggle.checked = allChecked;
    }
    
    /**
     * Updates exclusion state for all files under a property
     */
    private updateAllFileExclusions(propertyKey: string, exclude: boolean) {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        // Get files with inconsistencies
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        
        // Update exclusion state for each file
        inconsistentFiles.forEach(file => {
            if (exclude) {
                state.excludedFiles.add(file.path);
            } else {
                state.excludedFiles.delete(file.path);
            }
        });
    }
    
    /**
     * Reorders and filters the inconsistent files list based on dropdown selections
     */
    private reorderInconsistentFiles(
        propertyKey: string, 
        container: HTMLElement, 
        orderBy: string, 
        filterBy: string
    ) {
        const fileItems = Array.from(container.querySelectorAll('.inconsistent-file-item'));
        if (fileItems.length === 0) return;
        
        // Apply filtering
        fileItems.forEach(item => {
            const element = item as HTMLElement;
            
            if (filterBy === 'all') {
                element.style.display = '';
            } else if (filterBy === 'type') {
                element.style.display = element.hasAttribute('data-inconsistency-type') ? '' : 'none';
            } else if (filterBy === 'value') {
                element.style.display = element.hasAttribute('data-inconsistency-value') ? '' : 'none';
            } else if (filterBy === 'missing') {
                element.style.display = element.hasAttribute('data-inconsistency-missing') ? '' : 'none';
            }
        });
        
        // Apply ordering
        const visibleItems = fileItems.filter(item => 
            (item as HTMLElement).style.display !== 'none'
        );
        
        if (visibleItems.length === 0) {
            // If all items are filtered out, show a message
            if (container.querySelector('.no-visible-files-message')) {
                return;
            }
            
            const message = container.createEl('p', { 
                cls: 'no-visible-files-message',
                text: 'No files match the current filter.'
            });
            
            return;
        } else {
            // Remove any "no items" message
            const message = container.querySelector('.no-visible-files-message');
            if (message) message.remove();
        }
        
        // Sort visible items
        visibleItems.sort((a, b) => {
            const pathA = a.getAttribute('data-path') || '';
            const pathB = b.getAttribute('data-path') || '';
            
            if (orderBy === 'name-asc') {
                return pathA.localeCompare(pathB);
            } else {
                return pathB.localeCompare(pathA);
            }
        });
        
        // Reattach items in the new order
        visibleItems.forEach(item => {
            container.appendChild(item);
        });
    }
    
    /**
     * Creates an array value display with expand/collapse functionality
     */
    private createArrayValueDisplay(container: HTMLElement, arrayValue: any[], propertyType: string | null) {
        // Collapsed view
        const collapsedView = container.createSpan({ cls: 'array-property-collapsed-view' });
        
        // Display first item
        if (arrayValue.length > 0) {
            const firstItem = arrayValue[0];
            const firstItemPreview = formatValuePreview(firstItem, propertyType || undefined);
            collapsedView.createSpan({ text: firstItemPreview });
        }
        
        // Add expand link if more than one item
        if (arrayValue.length > 1) {
            const remainingCount = arrayValue.length - 1;
            const itemText = remainingCount === 1 ? 'item' : 'items';
            
            const expandLink = collapsedView.createSpan({ cls: 'array-property-toggle-link' });
            expandLink.appendText('(');
            expandLink.createSpan({ 
                cls: 'underline-target',
                text: `Expand, ${remainingCount} more ${itemText}`
            });
            expandLink.appendText(')');
            
            // Add click handler
            this.plugin.registerDomEvent(expandLink, 'click', (e) => {
                e.stopPropagation();
                collapsedView.addClass('is-hidden');
                expandedView.removeClass('is-hidden');
            });
        }
        
        // Expanded view
        const expandedView = container.createSpan({ 
            cls: 'array-property-expanded-container is-hidden' 
        });
        
        // Add all items
        arrayValue.forEach((item, index) => {
            const itemPreview = formatValuePreview(item, propertyType || undefined);
            expandedView.createSpan({ text: itemPreview });
            
            // Add comma separator between items
            if (index < arrayValue.length - 1) {
                expandedView.appendText(', ');
            }
        });
        
        // Add collapse link
        const collapseLink = expandedView.createSpan({ cls: 'array-property-toggle-link' });
        collapseLink.appendText('(');
        collapseLink.createSpan({ 
            cls: 'underline-target',
            text: 'Collapse'
        });
        collapseLink.appendText(')');
        
        // Add click handler
        this.plugin.registerDomEvent(collapseLink, 'click', (e) => {
            e.stopPropagation();
            expandedView.addClass('is-hidden');
            collapsedView.removeClass('is-hidden');
        });
    }
    
    /**
     * Updates the master enable toggle state based on individual property states
     */
    private updateMasterEnableToggleState() {
        if (!this.enableDisableToggle) return;
        
        // Don't update while loading
        if (!this.propertyToggles.length) return;
        
        let allEnabled = true;
        
        this.propertiesState.forEach(state => {
            if (!state.enabled) {
                allEnabled = false;
            }
        });
        
        this.enableDisableToggle.setValue(allEnabled);
        this.globalSettings.enableAll = allEnabled;
    }
    
    /**
     * Sets up drag and drop for property item reordering
     */
    private setupDragAndDrop() {
        if (!this.propertiesListContainer) return;
        
        // Add event listeners to the container
        this.plugin.registerDomEvent(this.propertiesListContainer, 'dragover', this.handleDragOver.bind(this));
        this.plugin.registerDomEvent(this.propertiesListContainer, 'dragleave', this.handleDragLeave.bind(this));
        this.plugin.registerDomEvent(this.propertiesListContainer, 'drop', this.handleDrop.bind(this));
        
        // Add event listeners to each drag handle
        const dragHandles = this.propertiesListContainer.querySelectorAll('.drag-handle');
        dragHandles.forEach(handle => { 
            // Tell TypeScript that 'handle' is definitely an HTMLElement
            const htmlHandle = handle as HTMLElement; 

            // Now use htmlHandle, which has the correct type
            this.plugin.registerDomEvent(htmlHandle, 'dragstart', this.handleDragStart.bind(this)); 
            this.plugin.registerDomEvent(htmlHandle, 'dragend', this.handleDragEnd.bind(this));   
        });
    }
    
    private handleDragStart(e: DragEvent) {
        if (!e.target || !(e.target instanceof HTMLElement)) return;
        
        // Find the property item
        const propertyItem = e.target.closest('.bulk-property-item');
        if (!propertyItem || !(propertyItem instanceof HTMLElement)) return;
        
        // Set the dragged item
        this.draggedItem = propertyItem;
        
        // Add dragging class after a short delay for visual feedback
        setTimeout(() => {
            if (this.draggedItem) {
                this.draggedItem.classList.add('dragging');
            }
        }, 0);
    }
    
    private handleDragOver(e: DragEvent) {
        e.preventDefault(); // Allow dropping
        
        if (!this.draggedItem || !this.propertiesListContainer) return;
        
        // Find the element to insert before
        const afterElement = this.getDragAfterElement(e.clientY);
        
        // Clear previous drop indicators
        this.propertiesListContainer.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
        
        // Add drop indicator to the element we're hovering over
        if (afterElement && afterElement !== this.draggedItem) {
            afterElement.classList.add('drag-over');
        }
    }
    
    private handleDragLeave(e: DragEvent) {
        if (!this.propertiesListContainer) return;
        
        // Remove drop indicator if the mouse leaves the container bounds
        if (!this.propertiesListContainer.contains(e.relatedTarget as Node)) {
            this.propertiesListContainer.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
        }
    }
    
    private handleDrop(e: DragEvent) {
        e.preventDefault();
        
        if (!this.draggedItem || !this.propertiesListContainer) return;
        
        // Clear drop indicators
        this.propertiesListContainer.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
        
        // Determine where to insert the dropped item
        const afterElement = this.getDragAfterElement(e.clientY);
        
        if (afterElement === null) {
            // If no element is found, append to the end
            this.propertiesListContainer.appendChild(this.draggedItem);
        } else if (afterElement !== this.draggedItem) {
            // Otherwise, insert before the found element
            this.propertiesListContainer.insertBefore(this.draggedItem, afterElement);
        }
        
        // Clean up dragging state
        this.draggedItem.classList.remove('dragging');
        this.draggedItem = null;
        
        // Update property order
        this.updatePropertyOrder();
    }
    
    private handleDragEnd() {
        if (!this.draggedItem || !this.propertiesListContainer) return;
        
        // Clean up
        this.draggedItem.classList.remove('dragging');
        this.draggedItem = null;
        
        // Remove any remaining drop indicators
        this.propertiesListContainer.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }
    
    private getDragAfterElement(y: number): HTMLElement | null {
        if (!this.propertiesListContainer) return null;
        
        // Get all draggable elements except the one being dragged
        const draggableElements = Array.from(
            this.propertiesListContainer.querySelectorAll('.bulk-property-item:not(.dragging)')
        ) as HTMLElement[];
        
        // Find the element whose top half is closest to the mouse position
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null }).element;
    }
    
    private updatePropertyOrder() {
        if (!this.propertiesListContainer) return;
        
        // Get all property items in their current order
        const propertyItems = this.propertiesListContainer.querySelectorAll('.bulk-property-item');
        
        // Create a new property order array
        this.propertyOrder = [];
        
        // Extract property keys from item IDs
        propertyItems.forEach(item => {
            const id = item.id;
            if (id.startsWith('prop-')) {
                const key = id.substring(5); // Remove 'prop-' prefix
                this.propertyOrder.push(key);
            }
        });
    }
    
    /**
     * Applies changes to all selected files
     */
    async applyChanges() {
        // Show progress notice
        const notice = new Notice('Applying changes to files...', 0);
        
        try {
            let successCount = 0;
            
            // Process each file
            for (const file of this.files) {
                try {
                    // Get existing properties
                    const existingProperties = await this.plugin.parseFileProperties(file);
                    
                    // Start with a fresh object to control property order
                    const newProperties: Record<string, any> = {};
                    const orderedKeys = this.globalSettings.applyCustomOrder ? this.propertyOrder : [];
                    
                    // First add keys in order (if custom order is enabled)
                    if (this.globalSettings.applyCustomOrder) {
                        // Add keys in the specified order if the property's own order toggle is on
                        for (const key of orderedKeys) {
                            const state = this.propertiesState.get(key);
                            
                            // Skip if the property state doesn't exist or order shouldn't be applied
                            if (!state || !state.applyOrder) continue;
                            
                            // Skip if the file is excluded for this property
                            if (state.excludedFiles.has(file.path)) continue;
                            
                            // Get existing property value, then apply changes
                            if (key in existingProperties) {
                                const value = this.processPropertyValue(key, file.path, existingProperties[key]);
                                if (value !== undefined) {
                                    newProperties[key] = value;
                                }
                            } else {
                                // Handle missing property
                                const value = this.processMissingProperty(key, file.path);
                                if (value !== undefined) {
                                    newProperties[key] = value;
                                }
                            }
                        }
                        
                        // Then add any remaining keys from existing properties
                        for (const key in existingProperties) {
                            // Skip if already processed
                            if (key in newProperties) continue;
                            
                            const state = this.propertiesState.get(key);
                            
                            // If this is a managed property, check if it should be included
                            if (state) {
                                // Skip if the file is excluded for this property
                                if (state.excludedFiles.has(file.path)) continue;
                                
                                // Process the property value
                                const value = this.processPropertyValue(key, file.path, existingProperties[key]);
                                if (value !== undefined) {
                                    newProperties[key] = value;
                                }
                            } else {
                                // Unmanaged property - keep as is
                                newProperties[key] = existingProperties[key];
                            }
                        }
                    } else {
                        // Custom order not enabled - keep original order of existing properties
                        
                        // First process existing properties
                        for (const key in existingProperties) {
                            const state = this.propertiesState.get(key);
                            
                            // If this is a managed property, check if it should be included
                            if (state) {
                                // Skip if the file is excluded for this property
                                if (state.excludedFiles.has(file.path)) continue;
                                
                                // Process the property value
                                const value = this.processPropertyValue(key, file.path, existingProperties[key]);
                                if (value !== undefined) {
                                    newProperties[key] = value;
                                }
                            } else {
                                // Unmanaged property - keep as is
                                newProperties[key] = existingProperties[key];
                            }
                        }
                        
                        // Then add any missing properties that need to be added
                        for (const key of this.propertyOrder) {
                            // Skip if already processed
                            if (key in newProperties) continue;
                            
                            const state = this.propertiesState.get(key);
                            
                            // Skip if no state, or file is excluded for this property
                            if (!state || state.excludedFiles.has(file.path)) continue;
                            
                            // Handle missing property
                            if (!(key in existingProperties)) {
                                const value = this.processMissingProperty(key, file.path);
                                if (value !== undefined) {
                                    newProperties[key] = value;
                                }
                            }
                        }
                    }
                    
                    // Apply the new properties to the file
                    await this.plugin.applyProperties(file, newProperties);
                    
                    // Increment success counter
                    successCount++;
                } catch (error) {
                    console.error(`Error processing file ${file.path}:`, error);
                }
            }
            
            // Show success message
            notice.hide();
            new Notice(`Changes applied to ${successCount} of ${this.files.length} files`);
            
            // Close the modal
            this.close();
            
            // Return to main menu
            this.plugin.navigateToModal(this, 'main');
        } catch (error) {
            console.error('Error applying changes:', error);
            notice.hide();
            new Notice('Error applying changes. Please try again.');
        }
    }
    
    /**
     * Processes a property value based on the property state and file actions
     */
    private processPropertyValue(key: string, filePath: string, currentValue: any): any | undefined {
        const state = this.propertiesState.get(key);
        if (!state) return currentValue; // Unchanged
        
        // Get file-specific actions
        const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
        
        // Check if this property is enabled for editing
        if (!state.enabled) {
            // Property is disabled, determine action
            const action = state.disabledAction === 'global' 
                ? this.globalSettings.disabledAction 
                : state.disabledAction;
                
            if (action === 'remove') {
                return undefined; // Remove the property
            } else if (action === 'add_if_missing') {
                return currentValue; // Keep existing (we're not missing it)
            } else {
                // Keep existing (default)
                return currentValue;
            }
        }
        
        // Property is enabled for editing
        let newValue = currentValue;
        
        // Apply type change if requested
        if (state.changeType || fileActions.type) {
            // Changing type might require value conversion, but for now just keeping current value
        }
        
        // Apply value override if requested
        // Apply value override if selectedValueOverride has a value (and fileActions allow it, or it's globally enabled)
        // Note: state.selectedValueOverride will be populated by the new input mechanism later.
        // For now, this check will likely be false unless manually set for testing.
        if (state.selectedValueOverride !== null && state.selectedValueOverride !== undefined && fileActions.value) {
            newValue = state.selectedValueOverride;
            // We might need type conversion here later based on state.changeType or detected type
        } else if (state.selectedValueOverride !== null && state.selectedValueOverride !== undefined && state.enabled && !fileActions.value) {
            // If globally enabled but not specifically enabled for this file's value action,
            // we still apply the override if one is set globally via selectedValueOverride.
            // This assumes selectedValueOverride represents the intended override value.
            newValue = state.selectedValueOverride;
        }
        
        return newValue;
    }
    
    /**
     * Processes a missing property based on the property state and file actions
     */
    private processMissingProperty(key: string, filePath: string): any | undefined {
        const state = this.propertiesState.get(key);
        if (!state) return undefined; // Don't add if no state
        
        // Get property consistency stats from the class property
        const stats = this.propertyConsistency.get(key);
        
        // Get file-specific actions
        const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
        
        // Check if we should add this missing property
        if (!state.enabled) {
            // Property is disabled, determine action
            const action = state.disabledAction === 'global' 
                ? this.globalSettings.disabledAction 
                : state.disabledAction;
                
            if (action === 'add_if_missing') {
                // Add empty property based on the property type
                const propertyType = state.changeType || 
                    (stats?.type.mostCommonType ? stats.type.mostCommonType : getDefaultTypeForKey(key));
                return getEmptyValueForType(propertyType);
            } else {
                // Don't add the missing property
                return undefined;
            }
        }
        
        // Check if there's a specific action to add this property
        if (!fileActions.add) {
            return undefined; // Don't add unless explicitly requested
        }
        
        // Determine the value to add
        // Check if an override value is set via the new mechanism and fileActions allow it
        if (state.selectedValueOverride !== null && state.selectedValueOverride !== undefined && fileActions.value) {
            // Use the selected override value
            // Note: We might need type conversion here later based on state.changeType or detected type
            return state.selectedValueOverride;
        } else if (state.selectedValueOverride !== null && state.selectedValueOverride !== undefined && state.enabled && !fileActions.value) {
                // Apply global override if enabled, even if not specifically for this file
                return state.selectedValueOverride;
        } else {
            // No specific override set or file action disabled, use default logic:
            // Use the most common value if available
            const stats = this.propertyConsistency.get(key);
            if (stats && stats.value.mostCommonValue !== null && stats.value.mostCommonValue !== undefined) {
                    return stats.value.mostCommonValue;
            } else {
                // Otherwise use empty value for the determined type
                const propertyType = state.changeType || // Use selected override type first
                    (stats?.type.mostCommonType) || // Then use most common detected type
                    getDefaultTypeForKey(key); // Fallback to guessing based on key
                return getEmptyValueForType(propertyType);
            }
        }
    }

    /**
     * Attempts to parse a string input into a typed value based on the target type.
     */
    private parseInputToTypedValue(rawString: string, targetType: string | null): any {
        const trimmedString = rawString.trim();

        switch (targetType) {
            case 'number':
                if (trimmedString === '') return null; // Allow clearing number field
                const num = parseFloat(trimmedString);
                return isNaN(num) ? rawString : num; // Keep raw string if not a valid number
            case 'checkbox':
                if (trimmedString.toLowerCase() === 'true') return true;
                if (trimmedString.toLowerCase() === 'false') return false;
                // Allow clearing checkbox field? Return null or keep raw string? Let's default to null.
                if (trimmedString === '') return null;
                return rawString; // Keep raw string if not true/false
            case 'date':
            case 'datetime':
                // Basic validation - check if it resembles a date/datetime
                // For now, just return the string, more robust parsing can be added
                if (trimmedString === '') return null; // Allow clearing
                return trimmedString; // Keep as string for now
            case 'list':
                // For text input mode (before pill implementation), treat as comma-separated
                if (trimmedString === '') return []; // Empty array
                return trimmedString.split(',').map((s: string) => s.trim()).filter(s => s !== '');
            case 'text':
            default:
                return rawString; // Return the raw string for text or unknown types
        }
    }

    /**
     * Attempts to convert an existing value to a new target type.
     */
    private convertValueToType(currentValue: any, newTargetType: string | null): any {
        // Simple conversion logic, can be expanded
        if (currentValue === null || currentValue === undefined) {
            return getEmptyValueForType(newTargetType || 'text');
        }

        const currentType = typeof currentValue;

        switch (newTargetType) {
            case 'number':
                const num = parseFloat(String(currentValue));
                return isNaN(num) ? 0 : num; // Default to 0 if conversion fails
            case 'checkbox':
                // Be lenient with truthy/falsy conversion
                if (typeof currentValue === 'string') {
                    return currentValue.toLowerCase() === 'true' || currentValue === '1';
                }
                return Boolean(currentValue);
            case 'date':
            case 'datetime':
                // Attempt to keep the format if it looks like one, otherwise stringify
                const dateStr = String(currentValue);
                // Basic check - could use moment.js for robust validation later
                if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
                    return dateStr;
                }
                return formatInputValue(currentValue); // Fallback to general input format
            case 'list':
                if (Array.isArray(currentValue)) return currentValue;
                if (typeof currentValue === 'string' && currentValue.includes(',')) {
                    return currentValue.split(',').map((s: string) => s.trim()).filter(s => s !== '');
                }
                // Wrap non-list value in an array
                return [currentValue];
            case 'text':
            default:
                if (Array.isArray(currentValue)) return currentValue.join(', '); // Convert array to comma-separated string
                return String(currentValue);
        }
    }
    
    /**
     * Automatically adjusts the height of a textarea to fit its content.
     */
    private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
        textarea.style.height = 'auto'; // Reset height to recalculate based on content
        // Calculate min height (e.g., based on 1 line of text)
        const style = window.getComputedStyle(textarea);
        const paddingTop = parseFloat(style.paddingTop);
        const paddingBottom = parseFloat(style.paddingBottom);
        const lineHeight = parseFloat(style.lineHeight);
        const minHeight = lineHeight + paddingTop + paddingBottom; // Approximately 1 line height + padding

        textarea.style.height = Math.max(minHeight, textarea.scrollHeight) + 'px';
        // Optional: Limit max height and show scrollbar if needed
        // const maxHeight = 200; // Example max height in pixels
        // if (textarea.scrollHeight > maxHeight) {
        //     textarea.style.height = maxHeight + 'px';
        //     textarea.style.overflowY = 'auto';
        // } else {
        //     textarea.style.overflowY = 'hidden';
        // }
        textarea.style.overflowY = 'hidden'; // Keep hidden for now unless max height is implemented
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}