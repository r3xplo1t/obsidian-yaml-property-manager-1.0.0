import { App, Modal, TFile, Setting, ButtonComponent, ExtraButtonComponent, DropdownComponent, ToggleComponent, Notice, setIcon, FuzzySuggestModal, moment } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { PropertyManagerMenu } from './PropertyManagerMenu';
import type { PropertyWithType } from '../PropertyTypeService';
import { formatValuePreview, formatInputValue, handleLinkClick, debounce, logError, getEmptyValueForType, getDefaultTypeForKey } from '../commonHelpers';
import { PROPERTY_TYPES } from '../constants';
import type { YamlPropertyValue } from '../interfaces';

// =================================================================
// SECTION: Type Definitions & Interfaces
// =================================================================

/**
 * Defines the state tracking for each property
 */
interface PropertyState {
    key: string;
    enabled: boolean;
    expanded: boolean;
    applyOrder: boolean;
    changeType: string | null;
    overrideValue: YamlPropertyValue | null;
    selectedValueOverride?: YamlPropertyValue | null;
    disabledAction: 'global' | 'keep' | 'remove' | 'add_if_missing';
    excludedFiles: Set<string>;
    fileActions: Map<string, {
        type: boolean;
        value: boolean;
        add: boolean;
    }>;
}

/**
 * Defines statistics for property consistency across files
 */
interface PropertyConsistencyStats {
    property: { total: number; present: number };
    type: { total: number; consistent: number; mostCommonType: string | null };
    value: {
        total: number;
        consistent: number;
        mostCommonValue: YamlPropertyValue;
        firstEncounteredValue: YamlPropertyValue | undefined;
        allUniqueValues: YamlPropertyValue[];
    };
}

// =================================================================
// SECTION: Helper Classes
// =================================================================

/**
 * Modal for suggesting existing property values
 */
class ExistingValueSuggestModal extends FuzzySuggestModal<YamlPropertyValue> {
    values: YamlPropertyValue[];
    propertyKey: string;
    onChooseValue: (value: YamlPropertyValue) => void;

    constructor(app: App, values: YamlPropertyValue[], propertyKey: string, onChoose: (value: YamlPropertyValue) => void) {
        super(app);
        this.values = values;
        this.propertyKey = propertyKey;
        this.onChooseValue = onChoose;
        this.setPlaceholder(`Select existing value for ${propertyKey}...`);
    }

    getItems(): YamlPropertyValue[] {
        return this.values;
    }

    getItemText(item: YamlPropertyValue): string {
        return formatValuePreview(item);
    }

    onChooseItem(item: YamlPropertyValue, _evt: MouseEvent | KeyboardEvent): void {
        this.onChooseValue(item);
    }
}

/**
 * Standardized toggle handler to ensure consistent behavior and appearance
 */
class ToggleHandler {
    private component: ToggleComponent;
    private toggleEl: HTMLElement;
    private inputEl: HTMLInputElement | null = null;
    private isUpdating: boolean = false;
    
    constructor(
        component: ToggleComponent, 
        onChange: (value: boolean) => void,
        plugin: YAMLPropertyManagerPlugin
    ) {
        this.component = component;
        
        // Get the actual toggle element (not the entire container)
        this.toggleEl = component.toggleEl;
        this.inputEl = this.toggleEl.querySelector('input[type="checkbox"]');
        
        // Clear default onChange to avoid duplicate handling
        component.onChange(() => {});
        
        // Find the proper toggle area - usually a div with class checkbox-container
        const toggleContainer = this.toggleEl.closest('.checkbox-container') || this.toggleEl;

        // Ensure toggleContainer is an HTMLElement before registering the event
        if (toggleContainer instanceof HTMLElement) {
            // Add click handler ONLY to the toggle container, not the entire setting
            plugin.registerDomEvent(toggleContainer, 'click', (e: MouseEvent) => {
                // Skip if toggle is disabled
                if (this.isDisabled()) {
                    return;
                }
                
                // Check if click is directly on the checkbox input
                const target = e.target as HTMLElement;
                const isCheckboxClick = target.tagName === 'INPUT' && 
                                      (target as HTMLInputElement).type === 'checkbox';
                
                // For other clicks, ensure they're within the toggle container
                // and not on some other control that might be nearby
                if (!isCheckboxClick && !toggleContainer.contains(target)) {
                    return;
                }
                
                if (isCheckboxClick) {
                    // For direct checkbox clicks, wait for checkbox state to update
                    setTimeout(() => {
                        if (!this.isUpdating && this.inputEl) {
                            this.isUpdating = true;
                            try {
                                onChange(this.inputEl.checked);
                            } finally {
                                this.isUpdating = false;
                            }
                        }
                    }, 0);
                    return;
                }
                
                // For clicks on the toggle container (not the checkbox itself)
                e.preventDefault();
                e.stopPropagation();
                
                // Toggle the checkbox state
                if (this.inputEl) {
                    const newState = !this.inputEl.checked;
                    this.setValue(newState, false); // Update visual state immediately
                    
                    // Call the onChange callback
                    if (!this.isUpdating) {
                        this.isUpdating = true;
                        try {
                            onChange(newState);
                        } finally {
                            this.isUpdating = false;
                        }
                    }
                }
            });
        }
    }
    
    /**
     * Gets the current checked state of the toggle
     */
    getValue(): boolean {
        // Prioritize the actual input element state if available
        return this.inputEl ? this.inputEl.checked : this.component.getValue();
    }
    
    /**
     * Sets the checked state of the toggle and updates visual appearance
     */
    setValue(value: boolean, skipCallback: boolean = false): this {
        if (this.isUpdating) return this;
        
        this.isUpdating = true;
        try {
            // Update the component state (which updates the input)
            this.component.setValue(value);
            
            // Also update visual state directly to ensure consistency
            this.updateVisualState(value);
            
        } finally {
            this.isUpdating = false;
        }
        return this;
    }
    
    /**
     * Sets the disabled state of the toggle
     */
    setDisabled(disabled: boolean): this {
        // Update the input element
        if (this.inputEl) {
            this.inputEl.disabled = disabled;
        }
        
        // Get toggle container
        const toggleContainer = this.toggleEl.closest('.checkbox-container') || this.toggleEl;
        
        // Get parent setting item if exists
        const settingItem = this.toggleEl.closest('.setting-item');
        
        // Update classes for visual state
        if (disabled) {
            if (toggleContainer instanceof HTMLElement) {
                toggleContainer.classList.add('is-disabled');
            }
            if (settingItem instanceof HTMLElement) {
                settingItem.classList.add('setting-disabled');
            }
        } else {
            if (toggleContainer instanceof HTMLElement) {
                toggleContainer.classList.remove('is-disabled');
            }
            if (settingItem instanceof HTMLElement) {
                settingItem.classList.remove('setting-disabled');
            }
        }
        
        return this;
    }
    
    /**
     * Checks if the toggle is currently disabled
     */
    isDisabled(): boolean {
        const toggleContainer = this.toggleEl.closest('.checkbox-container') || this.toggleEl;
        
        return (toggleContainer instanceof HTMLElement && toggleContainer.classList.contains('is-disabled')) || 
               !!(this.toggleEl.closest('.setting-disabled')) ||
               !!(this.inputEl && this.inputEl.disabled);
    }

    /**
     * Checks if this toggle handler is still valid and attached to the DOM
     */
    isValid(): boolean {
        return this.toggleEl && this.toggleEl.isConnected;
    }

    /**
     * Clean up resources when the toggle is no longer needed
     */
    dispose(): void {
        // Nothing to clean up in this implementation since 
        // plugin.registerDomEvent handles cleanup automatically when the plugin is unloaded
        // This method is provided for API consistency
    }
    
    /**
     * Updates the visual state of the toggle to ensure
     * UI elements match the actual state
     */
    private updateVisualState(checked: boolean): void {
        try {
            // Update the input element
            if (this.inputEl) {
                this.inputEl.checked = checked;
            }
            
            // Find and update the checkbox container
            const container = this.toggleEl.closest('.checkbox-container') || 
                            this.toggleEl.querySelector('.checkbox-container');
            if (container instanceof HTMLElement) {
                if (checked) {
                    container.classList.add('is-enabled');
                } else {
                    container.classList.remove('is-enabled');
                }
            }
            
            // Find and update the indicator if it exists
            const indicator = container instanceof HTMLElement ? container.querySelector('.checkbox-indicator') : null;
            if (indicator instanceof HTMLElement) {
                if (checked) {
                    indicator.classList.add('is-enabled');
                } else {
                    indicator.classList.remove('is-enabled');
                }
            }
        } catch (error) {
            console.error('Error updating toggle visual state:', error);
        }
    }

    /**
     * Gets the toggle element
     */
    getElement(): HTMLElement {
        return this.toggleEl;
    }
}

/**
 * Manages relationships between a master toggle and its dependent toggles
 */
class ToggleRelationship {
    private masterToggle: ToggleHandler;
    private individualToggles: ToggleHandler[] = [];
    private isUpdating: boolean = false;
    
    /**
     * Creates a new toggle relationship
     * @param masterToggle The master toggle that controls the group
     */
    constructor(masterToggle: ToggleHandler) {
        this.masterToggle = masterToggle;
    }
    
    /**
     * Adds an individual toggle that will be controlled by the master
     * @param toggle The toggle to add to the relationship
     * @returns This instance for chaining
     */
    addIndividualToggle(toggle: ToggleHandler): this {
        this.individualToggles.push(toggle);
        return this;
    }
    
    /**
     * Updates all individual toggles based on the master toggle state
     * with batched DOM updates for performance
     */
    updateFromMaster(value: boolean): void {
        if (this.isUpdating) return;
        
        this.isUpdating = true;
        try {
            // For large sets of toggles, we can optimize by batching updates
            if (this.individualToggles.length > 20) {
                // First update all data models
                this.individualToggles.forEach(toggle => {
                    // Update value without immediately updating the DOM
                    toggle.setValue(value, true);
                });
                
                // Then force a single reflow by reading a layout property
                // eslint-disable-next-line @typescript-eslint/no-unused-vars -- triggers layout reflow for batched DOM updates
                const forceReflow = document.body.offsetHeight;
                
                // Now update the visual state of all toggles at once
                this.individualToggles.forEach(toggle => {
                    const element = toggle.getElement();
                    if (element) {
                        const input = element.querySelector('input[type="checkbox"]');
                        if (input instanceof HTMLInputElement) {
                            input.checked = value;
                        }
                    }
                });
            } else {
                // For small sets, just update each toggle normally
                this.individualToggles.forEach(toggle => {
                    toggle.setValue(value);
                });
            }
        } finally {
            this.isUpdating = false;
        }
    }
    
    /**
     * Updates the master toggle based on the state of all individual toggles
     */
    updateFromIndividual(): void {
        if (this.isUpdating) return;
        
        this.isUpdating = true;
        try {
            // Check if all individual toggles are in the same state
            const allOn = this.individualToggles.length > 0 && 
                         this.individualToggles.every(toggle => toggle.getValue());
            
            // Update master toggle
            this.masterToggle.setValue(allOn);
        } finally {
            this.isUpdating = false;
        }
    }
    
    /**
     * Gets all individual toggles in this relationship
     */
    getIndividualToggles(): ToggleHandler[] {
        return [...this.individualToggles];
    }
    
    /**
     * Gets the master toggle
     */
    getMasterToggle(): ToggleHandler {
        return this.masterToggle;
    }
    
    /**
     * Removes an individual toggle from the relationship
     * @param toggle The toggle to remove
     * @returns Whether the toggle was found and removed
     */
    removeIndividualToggle(toggle: ToggleHandler): boolean {
        const index = this.individualToggles.indexOf(toggle);
        if (index >= 0) {
            this.individualToggles.splice(index, 1);
            return true;
        }
        return false;
    }
}

// =================================================================
// SECTION: Main BulkEditor Class
// =================================================================

export class BulkEditor extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];

    // UI Elements
    private expandButton: ButtonComponent | null = null;
    private collapseButton: ButtonComponent | null = null;
    private propertyToggles: Array<{ key: string, dropdown: DropdownComponent }> = [];
    private enableDisableToggle: ToggleHandler | null = null;
    private applyButton: ButtonComponent | null = null;
    private propertiesListContainer: HTMLElement | null = null;
    private emptyStateEl: HTMLElement | null = null;
    private fileToggleComponents: Map<string, {excludeAllToggle: ToggleHandler, fileToggles: ToggleHandler[]}> = new Map();
    private excludeAllToggleElement: Map<string, HTMLInputElement> = new Map();
    private isUpdatingFromIndividualToggle = false;
    private addAllMissingToggles: Map<string, ToggleHandler> = new Map();
    private applyValueToAllToggles: Map<string, ToggleHandler> = new Map();
    private overwriteAllValuesToggles: Map<string, ToggleHandler> = new Map();

    // State tracking
    private globalSettings = {
        enableAll: true,
        disabledAction: 'keep' as 'keep' | 'remove' | 'add_if_missing',
        applyCustomOrder: false,
        expandAll: false
    };

    private propertiesState: Map<string, PropertyState> = new Map();
    private propertyConsistency: Map<string, PropertyConsistencyStats> = new Map();
    private fileProperties: Map<string, Record<string, PropertyWithType>> = new Map();
    private draggedItem: HTMLElement | null = null;
    private propertyOrder: string[] = [];

    // Toggle management using standardized handlers
    private propertyToggleHandlers: Map<string, ToggleHandler> = new Map();
    private toggleRelationships: Map<string, ToggleRelationship> = new Map();

    // Debounced function to update value counter
    private debouncedUpdateValueCounter = debounce((propertyKey: string, inputValue: YamlPropertyValue, _targetType: string) => {
        const count = this.calculateValueCount(propertyKey, inputValue);
        this.updateValueCounterUI(propertyKey, count);
    }, 300);

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }

    // =================================================================
    // SECTION: Modal Lifecycle Methods
    // =================================================================

    /**
     * Initialize the modal when opened
     */
    onOpen(): void {
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('yaml-property-manager-modal');
        this.titleEl.setText('Bulk Property Editor');

        // Add description about number of files
        const fileCountSetting = new Setting(contentEl)
            .setDesc(`Editing properties across ${this.files.length} ${this.files.length === 1 ? 'file' : 'files'}.`);
        fileCountSetting.settingEl.addClass('bulk-editor-file-count');

        // Add global options section
        this.createGlobalOptionsSection(contentEl);

        // Properties list header + expand/collapse control in one row
        this.createExpandCollapseButton(contentEl);

        // Properties list container
        const propertiesContainer = contentEl.createDiv({
            cls: 'properties-list-container',
            attr: { id: 'propertiesList' }
        });
        this.propertiesListContainer = propertiesContainer;

        // Empty-state message (shown in place of the properties list when no properties exist)
        this.emptyStateEl = contentEl.createEl('div', { cls: 'property-empty-state' });
        this.emptyStateEl.hide();

        // Loading indicator
        const loadingEl = this.propertiesListContainer.createEl('div', {
            cls: 'property-loading-container',
            text: 'Loading properties...'
        });

        try {
            // Load and display properties
            await this.loadProperties();
            loadingEl.remove();
        } catch (error) {
            logError('YAML Property Manager', 'Error loading properties:', error);
            loadingEl.setText('Error loading properties. Please try again.');
            loadingEl.addClass('property-error');
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
                void this.applyChanges();
            });

        // Cancel button
        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close();
                new PropertyManagerMenu(this.app, this.plugin).open();
            });
    }

    /**
     * Clean up when modal is closed
     */
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    // =================================================================
    // SECTION: UI Creation Methods
    // =================================================================

    /**
     * Creates the global options section at the top of the modal
     */
    private createGlobalOptionsSection(container: HTMLElement) {
        // Global options header
        new Setting(container)
            .setName('Global options')
            .setHeading();

        // Enable/disable all edits
        new Setting(container)
            .setName('Enable/disable all edits')
            .setDesc('Toggle to apply change for all properties below.')
            .addToggle(toggle => {
                // Create a standardized toggle handler
                this.enableDisableToggle = new ToggleHandler(
                    toggle,
                    (value) => {
                        this.globalSettings.enableAll = value;
                        this.updateAllPropertyToggles(value);
                    },
                    this.plugin
                );
                
                // Set initial value
                this.enableDisableToggle.setValue(this.globalSettings.enableAll);
                
                return toggle;
            });

        // Create a toggle relationship for the master enable toggle
        if (this.enableDisableToggle) {
            const enableRelationship = new ToggleRelationship(this.enableDisableToggle);
            this.toggleRelationships.set('global-enable', enableRelationship);
        }
            
        // Action for disabled properties
        new Setting(container)
            .setName('Action for disabled properties')
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
            
        // Apply custom order
        const applyOrderSetting = new Setting(container)
            .setName('Apply custom order')
            .setDesc('Apply the manually dragged order of properties below.')
            .addToggle((toggle: ToggleComponent) => {
                toggle
                    .setValue(this.globalSettings.applyCustomOrder)
                    .onChange((value: boolean) => {
                        this.globalSettings.applyCustomOrder = value;
                    });
            });
        applyOrderSetting.descEl.createEl('br');
        applyOrderSetting.descEl.appendText('Alternatively, enable ordering for specific properties in their settings below.');
    }

    /**
     * Creates the Properties List heading and expand/collapse buttons
     */
    private createExpandCollapseButton(container: HTMLElement) {
        new Setting(container)
            .setName('Properties list')
            .setHeading();

        new Setting(container)
            .setName('Expand / collapse properties')
            .setDesc('Expand or collapse all property rows below.')
            .addButton(button => {
                this.expandButton = button;
                button.setButtonText('Expand All')
                    .onClick(() => {
                        this.globalSettings.expandAll = true;
                        this.updateAllExpansionState(true);
                        setTimeout(() => {
                            if (!this.propertiesListContainer) return;
                            this.propertiesListContainer.querySelectorAll('.property-value-editor').forEach(el => {
                                this.autoResizeEditableDiv(el as HTMLElement);
                            });
                        }, 10);
                    });
            })
            .addButton(button => {
                this.collapseButton = button;
                button.setButtonText('Collapse All')
                    .onClick(() => {
                        this.globalSettings.expandAll = false;
                        this.updateAllExpansionState(false);
                    });
            });
    }

    /**
     * Creates a single property item in the list
     */
    private renderPropertyItem(key: string) {
        if (!this.propertiesListContainer) return;

        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);

        if (!state || !stats) return;

        // Create property item container
        const propertyItem = this.propertiesListContainer.createDiv({
            cls: `bulk-property-item ${state.expanded ? '' : 'is-collapsed'}`,
            attr: { id: `prop-${key}` }
        });

        // Header section using Setting Component
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

        // Status Text moved to Description Area
        const descEl = propertyHeaderSetting.descEl;
        descEl.empty();
        descEl.addClass('bulk-property-stats-description');

        // Controls Area
        const controlEl = propertyHeaderSetting.controlEl;
        controlEl.addClass('bulk-property-item-header-controls');

        // Revert button
        propertyHeaderSetting.addExtraButton(button => {
            button
                .setIcon('rotate-ccw')
                .setTooltip(`Revert all changes for property "${key}"`)
                .onClick(async () => {
                    if (!state) return;

                    if (!await this.confirmRevert(`Revert all edits for property "${key}"?`)) {
                        return;
                    }

                    // Reset State
                    state.overrideValue = null;
                    state.changeType = null;
                    state.disabledAction = 'global';
                    state.applyOrder = true;
                    state.excludedFiles.clear();
                    state.fileActions.clear();

                    // Refresh UI Elements
                    const propertyItemEl = this.propertiesListContainer?.querySelector(`#prop-${key}`);
                    if (!propertyItemEl) return;

                    // Reset master control toggles via ToggleHandler so visual state is fully synced
                    const excludeAllHandler = this.fileToggleComponents.get(key)?.excludeAllToggle;
                    excludeAllHandler?.setValue(false);
                    excludeAllHandler?.setDisabled(false);

                    this.addAllMissingToggles.get(key)?.setValue(false);
                    this.addAllMissingToggles.get(key)?.setDisabled(false);

                    this.applyValueToAllToggles.get(key)?.setValue(false);

                    this.overwriteAllValuesToggles.get(key)?.setValue(false);
                    this.overwriteAllValuesToggles.get(key)?.setDisabled(false);

                    // Reset Type Dropdown
                    const typeDropdown = propertyItemEl.querySelector('[data-setting-type="property-type"] select') as HTMLSelectElement | null;
                    if (typeDropdown) typeDropdown.value = '';

                    // Reset Value Input (state.overrideValue is already null, so this renders the observed value)
                    const valueControlContainer = propertyItemEl.querySelector('.property-main-value-container') as HTMLElement | null;
                    if (valueControlContainer) {
                        this.updateValueControl(valueControlContainer, key, null);
                    }

                    // Reset Apply Order Toggle
                    const applyOrderToggleEl = propertyItemEl.querySelector('[data-setting-type="apply-order-toggle"] input[type="checkbox"]') as HTMLInputElement | null;
                    if (applyOrderToggleEl) this.setCheckboxVisualState(applyOrderToggleEl, state.applyOrder);

                    // Reset Disabled Action Dropdown
                    const disabledActionDropdownEl = propertyItemEl.querySelector('[data-setting-type="disabled-action-dropdown"] select') as HTMLSelectElement | null;
                    if (disabledActionDropdownEl) disabledActionDropdownEl.value = state.disabledAction;

                    // Reset Inconsistent Files List
                    this.refreshInconsistentFilesUI(propertyItemEl, key);

                    // Recalculate disabled state of Apply Value To All and Overwrite All from fresh state
                    this.updateApplyValueToAllToggleState(key);
                    this.updateOverwriteAllValuesToggleState(key);

                    // Update Value Counter
                    const resetValue = stats?.value.mostCommonValue ?? stats?.value.firstEncounteredValue ?? null;
                    const resetValueCount = this.calculateValueCount(key, resetValue);
                    this.updateValueCounterUI(key, resetValueCount);

                    // Reset Edit Enabled Toggle
                    const editToggle = propertyHeaderSetting.controlEl.querySelector('.edit-toggle-control-wrapper input[type="checkbox"]') as HTMLInputElement | null;
                    if (editToggle) {
                        state.enabled = true;
                        this.setCheckboxVisualState(editToggle, true);
                        this.updateMasterEnableToggleState();
                        this.updatePropertyEnabledState(key, true);
                    }

                    new Notice(`Reverted changes for property "${key}"`);
                });
        });

        // Edit Enabled Toggle
        propertyHeaderSetting.addToggle(toggle => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    state.enabled = value;
                    this.updateMasterEnableToggleState();
                    this.updatePropertyEnabledState(key, value);

                    // Process links in all property editors when toggling
                    const propertyContent = propertyItem.querySelector('.property-content');
                    if (propertyContent) {
                        const editors = propertyContent.querySelectorAll('.property-value-editor');
                        editors.forEach(editor => {
                            if (editor instanceof HTMLElement) {
                                const editorType = state.changeType || 
                                                stats?.type.mostCommonType || 
                                                'text';
                                this.processLinksInEditor(editor, editorType);
                            }
                        });
                    }
                },
                this.plugin
            );
            
            // Set initial value and tooltip
            handler.setValue(state.enabled);
            toggle.setTooltip(`Toggle editing for ${key} property`);
            
            // Add class for styling
            toggle.toggleEl.parentElement?.addClass('edit-toggle-control-wrapper');
            
            // Store reference for later use
            this.propertyToggleHandlers.set(key, handler);
        });

        // Drag Handle
        controlEl.createSpan({
            cls: 'drag-handle', text: '☰',
            attr: { draggable: 'true', title: `Drag to reorder ${key} property` }
        });

        // Helper function to add a status row
        const addStatusRow = (label: string, value: string, isConsistent: boolean) => {
            const row = descEl.createDiv({ cls: 'property-header-stat-row' });
            row.createSpan({
                cls: `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`,
                text: isConsistent ? '✓' : '⚠'
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
            'Value',
            `${stats.value.consistent}/${stats.type.total}`,
            stats.value.consistent === stats.type.total
        );

        // Dynamic Hint Text Span
        const hintSpan = descEl.createSpan({ cls: 'property-toggle-hint' });
        hintSpan.textContent = state.expanded ? 'Click to hide options.' : 'Click to display options.';

        // Content Section
        const contentContainer = propertyItem.createDiv({ cls: 'property-content' });
        this.createPropertyDetailsSection(contentContainer, key);
        this.createInconsistentFilesSection(contentContainer, key);

        if (!state.enabled) {
            contentContainer.addClass('is-property-disabled');
        }

        // Event Handlers
        this.plugin.registerDomEvent(propertyHeaderSetting.settingEl, 'click', (e: MouseEvent) => {
            // Ignore clicks on controls
            if (controlEl.contains(e.target as Node)) { return; }
        
            // Toggle state
            state.expanded = !state.expanded;
        
            // Find the hint span dynamically if needed
            const currentHintSpan = propertyHeaderSetting.descEl.querySelector('.property-toggle-hint');
        
            // Update UI
            if (state.expanded) {
                propertyItem.classList.remove('is-collapsed');
                contentContainer.show();
                propertyHeaderSetting.settingEl.setAttribute('aria-expanded', 'true');
                if (currentHintSpan) currentHintSpan.textContent = 'Toggle to hide options.';
                
                // Resize all contenteditable elements when they become visible
                setTimeout(() => {
                    const editors = contentContainer.querySelectorAll('.property-value-editor');
                    editors.forEach(editor => {
                        if (editor instanceof HTMLElement) {
                            this.autoResizeEditableDiv(editor);
                        }
                    });
                }, 0);
            } else {
                propertyItem.classList.add('is-collapsed');
                propertyHeaderSetting.settingEl.setAttribute('aria-expanded', 'false');
                if (currentHintSpan) currentHintSpan.textContent = 'Click to display options.';
            }
            
        });

        this.plugin.registerDomEvent(propertyHeaderSetting.settingEl, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                // Prevent toggling if focus is on the actual checkbox toggle in controls
                if (e.target instanceof HTMLElement && controlEl.contains(e.target) && e.target.closest('.checkbox-container')) { return; }
                // Allow toggling if focus is anywhere else in the header, except controls
                if (!controlEl.contains(e.target as Node)) {
                    e.preventDefault();
                    propertyHeaderSetting.settingEl.click();
                }
            }
        });
    }

    /**
     * Creates the details section for a property: info and dynamic value input.
     */
    private createPropertyDetailsSection(container: HTMLElement, key: string) {
        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);
        if (!state || !stats) return;

        // Action if edit disabled
        const disabledActionSetting = new Setting(container)
            .setName('Action if edit disabled')
            .setDesc('Overrides global setting if the edit toggle above is off.')
            .addDropdown((dropdown: DropdownComponent) => {
                dropdown
                    .addOption('global', 'Use Global Setting')
                    .addOption('keep', 'Keep Existing (Do Nothing if Missing)')
                    .addOption('remove', 'Remove Property')
                    .addOption('add_if_missing', 'Add Empty if Missing (Keep Existing)')
                    .setValue(state.disabledAction)
                    .onChange((value: string) => {
                        state.disabledAction = value as 'global' | 'keep' | 'remove' | 'add_if_missing';
                    });
            });
        disabledActionSetting.settingEl.setAttr('data-setting-type', 'disabled-action-dropdown');

        // Apply order for this property
        const applyOrderSetting = new Setting(container)
            .setName('Apply order for this property')
            .setDesc('When enabled, the position of this property in the list will be preserved on apply.')
            .addToggle((toggle: ToggleComponent) => {
                toggle
                    .setValue(state.applyOrder)
                    .onChange((value: boolean) => {
                        state.applyOrder = value;
                    });
            });
        applyOrderSetting.settingEl.setAttr('data-setting-type', 'apply-order-toggle');

        // Property type selection
        const propertyTypeSetting = new Setting(container)
            .setName('Property type')
            .setDesc('Select the type to apply for this property.');
        propertyTypeSetting.settingEl.setAttr('data-setting-type', 'property-type');

        const mostCommonTypeValue = stats.type.mostCommonType;
        const mostCommonTypeDisplay = mostCommonTypeValue
            ? this.plugin.propertyTypeService.getPropertyTypeDisplayName(mostCommonTypeValue)
            : 'Varies';

        // Set Description for Property Type using Spans
        const typeDescEl = propertyTypeSetting.descEl;
        typeDescEl.empty();

        // Create the explanatory text span
        typeDescEl.createSpan({
            text: "Select a type to apply to this property across selected files.",
            cls: "setting-item-description"
        });

        // Create a line break element
        typeDescEl.createEl("br");

        // Create the "Current type" text span
        let definedType: string | null = null;
        let currentTypeLine: string = "Current type: Not defined in Obsidian settings";

        definedType = this.getObsidianDefinedType(key);
        if (definedType) {
            currentTypeLine = "Current type: " + this.plugin.propertyTypeService.getPropertyTypeDisplayName(definedType);
        }

        typeDescEl.createSpan({
            text: currentTypeLine,
            cls: "setting-item-description setting-item-description-subtle"
        });

        // Static property value info display
        const propertyValueDisplaySetting = new Setting(container)
            .setName('Property value')
            .setDesc('Displays value consistency information.');
            
        propertyValueDisplaySetting.addButton(button => {
            button
                .setButtonText("Select Existing")
                .setTooltip("Select from existing values found in files")
                .setDisabled(stats.value.allUniqueValues.length < 2)
                .onClick(() => {
                    new ExistingValueSuggestModal(
                        this.app,
                        stats.value.allUniqueValues,
                        key,
                        (selectedValue) => {
                            // Update the state
                            state.overrideValue = selectedValue;

                            // Find the input container for this property
                            const propertyItemEl = this.propertiesListContainer?.querySelector(`#prop-${key}`);
                            const valueInputContainer = propertyItemEl?.querySelector('.dynamic-value-input-container') as HTMLElement | null;

                            // Refresh the UI input control if container found
                            if (valueInputContainer) {
                                this.updateValueControl(valueInputContainer, key, state.changeType);

                                // Update the value counter after UI refresh
                                const count = this.calculateValueCount(key, selectedValue);
                                this.updateValueCounterUI(key, count);
                            } else {
                                console.warn(`Could not find value input container for property: ${key}`);
                            }
                        }
                    ).open();
                });
        });

        // Property Value Description and Counter
        const valueDescEl = propertyValueDisplaySetting.descEl;
        valueDescEl.empty();
        valueDescEl.addClass('value-description-container');

        // Add the explanatory text span
        valueDescEl.createSpan({
            text: "Input a new value or select from existing values across the selected files.",
            cls: "setting-item-description"
        });

        // Add a line break
        valueDescEl.createEl('br');

        // Add the counter span and icon
        const valueCounterSpan = valueDescEl.createSpan({ cls: 'value-counter-span setting-item-description-subtle' });
        const initialValue = state.overrideValue ?? stats.value.mostCommonValue ?? stats.value.firstEncounteredValue ?? null;
        const initialValueCount = this.calculateValueCount(key, initialValue);
        const filesWithProperty = stats.property.present;

        // Set the main text content including the period
        valueCounterSpan.appendText('Current value present in ' + initialValueCount + '/' + filesWithProperty + (filesWithProperty === 1 ? ' file.' : ' files.'));

        // Determine consistency
        const isConsistent = filesWithProperty > 0 && initialValueCount === filesWithProperty;

        // Add the icon span AFTER the period
        valueCounterSpan.createSpan({
            cls: `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`,
            text: isConsistent ? ' ✓' : ' ⚠'
        });

        propertyValueDisplaySetting.settingEl.addClass('property-value-display-setting');

        // Container for Dynamic Value Input Control
        const valueControlContainer = container.createDiv();
        valueControlContainer.addClass('dynamic-value-input-container');
        valueControlContainer.addClass('property-main-value-container');
        // Add class based on initial type for styling
        const initialActualType = state.changeType || mostCommonTypeValue || 'text';
        valueControlContainer.addClass(`value-input-container-${initialActualType}`);

        // Link Type Dropdown onChange to Update Control
        propertyTypeSetting.addDropdown(dropdown => {
            const filteredTypes = mostCommonTypeValue
                ? PROPERTY_TYPES.filter(type => type.value !== mostCommonTypeValue)
                : PROPERTY_TYPES;

            dropdown.addOption('', mostCommonTypeDisplay);
            dropdown.addOptions(filteredTypes.reduce((options, type) => {
                options[type.value] = type.label;
                return options;
            }, {} as Record<string, string>));

            dropdown
                .setValue(state.changeType || '')
                .onChange(value => {
                    const newType = value || null;
                    state.changeType = newType;
                    // Update CSS class on container
                    valueControlContainer.className = 'dynamic-value-input-container property-main-value-container';
                    valueControlContainer.addClass(`value-input-container-${newType || mostCommonTypeValue || 'text'}`);
                    // Call the update function
                    this.updateValueControl(valueControlContainer, key, newType);
                });
            return dropdown;
        });

        this.createUnifiedValueContainer(valueControlContainer, key, state.changeType || mostCommonTypeValue || 'text');

        // Initial setup of the value control
        this.updateValueControl(valueControlContainer, key, state.changeType);
    }

    /**
     * Creates a unified value container with appropriate input based on property type.
     */
    private createUnifiedValueContainer(
        container: HTMLElement,
        key: string,
        initialType: string | null
    ): void {
        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);
        if (!state || !stats) {
            container.empty();
            return;
        }
    
        const mostCommonTypeValue = stats.type.mostCommonType;
        const actualType = initialType || mostCommonTypeValue || 'text';
        const hasValueData = stats.value.total > 0;
    
        // Clear previous content
        container.empty();
        // Add base class for dynamic value input area
        container.addClass('dynamic-value-input-container');
        // Add type-specific class for styling
        container.addClass(`value-input-container-${actualType}`);
    
        // Create input based on type
        if (actualType === 'list') {
            // List Type: Pills + Input
            const listEditorContainer = container.createDiv({
                cls: 'property-value-editor list-editor-container'
            });
    
            // Populate with pills and the input field
            this.renderListEditorContent(key, listEditorContainer);
    
        } else if (actualType === 'checkbox') {
            // Checkbox Type
            const checkboxContainer = container.createDiv({
                cls: 'checkbox-input-container'
            });
    
            const checkboxInput = checkboxContainer.createEl('input', {
                type: 'checkbox',
                cls: 'property-value-checkbox',
                attr: {
                    tabindex: '0'
                }
            });
    
            // Determine initial boolean value
            let initialBoolValue = false;
            if (state.overrideValue !== null && state.overrideValue !== undefined) {
                initialBoolValue = typeof state.overrideValue === 'boolean'
                    ? state.overrideValue
                    : String(state.overrideValue).toLowerCase() === 'true';
            } else if (hasValueData) {
                const rawInitialValue = stats.value.mostCommonValue ?? stats.value.firstEncounteredValue;
                initialBoolValue = typeof rawInitialValue === 'boolean'
                    ? rawInitialValue
                    : String(rawInitialValue).toLowerCase() === 'true';
            }
            checkboxInput.checked = initialBoolValue;
    
            // Update state on change
            this.plugin.registerDomEvent(checkboxInput, 'change', () => {
                state.overrideValue = checkboxInput.checked;

                const count = this.calculateValueCount(key, checkboxInput.checked);
                this.updateValueCounterUI(key, count);
            });
    
        } else {
            // Other Types (Text, Number, Date, Datetime)
            const propertyValueDiv = container.createDiv({
                cls: 'metadata-input-longtext property-value-editor',
                attr: {
                    contenteditable: 'true',
                    spellcheck: 'true',
                    tabindex: '0',
                    placeholder: this.getPlaceholderForType(actualType)
                }
            });
    
            // Determine Initial Value and Format for Display
            let rawInitialValue: YamlPropertyValue = '';
            if (state.overrideValue !== null && state.overrideValue !== undefined) {
                rawInitialValue = state.overrideValue;
            } else if (hasValueData) {
                rawInitialValue = stats.value.mostCommonValue ?? stats.value.firstEncounteredValue ?? null;
            }
            // Format for display
            const formattedValue = formatInputValue(rawInitialValue);
            propertyValueDiv.textContent = formattedValue;

            // Initial Validation
            const isValidInitially = this.validateInputValue(formattedValue, actualType);
            if (!isValidInitially) {
                propertyValueDiv.classList.add('is-invalid');
            }
    
            // Process links for text type
            if (actualType === 'text') {
                this.processLinksInEditor(propertyValueDiv, actualType);
            }
    
            // Add Event Listeners for contenteditable
            this.plugin.registerDomEvent(propertyValueDiv, 'input', () => {
                const currentValue = propertyValueDiv.textContent;
                if (currentValue !== null) {
                    state.overrideValue = currentValue;
                }
       
                // Validation on Input
                const isValid = this.validateInputValue(currentValue, actualType);
                if (!isValid) {
                    propertyValueDiv.classList.add('is-invalid');
                } else {
                    propertyValueDiv.classList.remove('is-invalid');
                }

                // Debounced update for the value counter
                const parsedValue = this.parseUserInput(currentValue, actualType);
                this.debouncedUpdateValueCounter(key, parsedValue, actualType);

                // NEW: Also update property counters with the same debounce
                const debouncedPropertyCountersUpdate = debounce(() => {
                    this.updatePropertyCountersUI(key);
                }, 300);
                debouncedPropertyCountersUpdate();
       
                this.autoResizeEditableDiv(propertyValueDiv);
            });
    
            this.plugin.registerDomEvent(propertyValueDiv, 'focus', () => {
                if (actualType === 'text') {
                    // Convert links back to text for editing
                    const linkSpans = propertyValueDiv.querySelectorAll('.metadata-link');
                    if (linkSpans.length > 0) {
                        linkSpans.forEach(span => {
                            const textNode = document.createTextNode(span.textContent || '');
                            span.parentNode?.replaceChild(textNode, span);
                        });
                    }
                }
                this.autoResizeEditableDiv(propertyValueDiv);
            });
    
            this.plugin.registerDomEvent(propertyValueDiv, 'blur', () => {
                const currentValue = propertyValueDiv.textContent;
        
                // Validation on Blur
                const isValid = this.validateInputValue(currentValue, actualType);
                if (!isValid) {
                    propertyValueDiv.classList.add('is-invalid');
                } else {
                    propertyValueDiv.classList.remove('is-invalid');
                }
        
                if (actualType === 'text') {
                    this.processLinksInEditor(propertyValueDiv, actualType);
                }
                
                setTimeout(() => this.autoResizeEditableDiv(propertyValueDiv), 0);
            });
    
            // Prevent Enter key for single-line types
            if (actualType !== 'text') {
                this.plugin.registerDomEvent(propertyValueDiv, 'keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                    }
                    
                    // Number validation
                    if (actualType === 'number') {
                        // Allow only numbers, '.', '-', '+' (basic validation)
                        if (!/[\d.\-+e]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Home', 'End'].includes(e.key) && !(e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                        }
                    }
                });
    
                // Validate paste for numbers
                if (actualType === 'number') {
                    this.plugin.registerDomEvent(propertyValueDiv, 'paste', (e: ClipboardEvent) => {
                        e.preventDefault();
                        const pastedText = e.clipboardData?.getData('text');
                        if (pastedText) {
                            const filteredText = pastedText.replace(/[^0-9.\-+e]/gi, '');
                            const selection = window.getSelection();
                            if (selection && selection.rangeCount > 0) {
                                const range = selection.getRangeAt(0);
                                range.deleteContents();
                                const textNode = document.createTextNode(filteredText);
                                range.insertNode(textNode);
                                range.setStartAfter(textNode);
                                range.collapse(true);
                                selection.removeAllRanges();
                                selection.addRange(range);
                                propertyValueDiv.dispatchEvent(new Event('input'));
                            }
                        }
                    });
                }
            }
    
            // Initial resize
            this.autoResizeEditableDiv(propertyValueDiv);
        }
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
            .setName('Inconsistent files')
            .setHeading()
            .settingEl.addClass('bulk-editor-section-heading');
        
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
        orderBySelect.appendChild(new Option('Value Mismatch First', 'value-mismatch'));
        orderBySelect.appendChild(new Option('Missing Property First', 'missing-first'));
        
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
        filterBySelect.appendChild(new Option('Value Mismatch', 'value'));
        filterBySelect.appendChild(new Option('Missing Property', 'missing'));
        
        // Exclude All Files toggle
        const inconsistentFilesControls = inconsistentFilesContainer.createDiv({ cls: 'inconsistent-files-controls' });
        
        const excludeAllSettingId = `exclude-all-${key.replace(/\s+/g, '-')}`;

        const excludeAllSetting = new Setting(inconsistentFilesControls)
            .setName('Exclude all files')
            .setDesc('Toggle to ignore all file on apply.');

        // Add a unique ID to the setting element
        excludeAllSetting.settingEl.id = excludeAllSettingId;
            
        // Initialize the toggle components map entry for this property
        if (!this.fileToggleComponents.has(key)) {
            this.fileToggleComponents.set(key, {
                excludeAllToggle: null as unknown as ToggleHandler,
                fileToggles: []
            });
        }

        // Check if there are any inconsistent files to exclude
        const hasInconsistentFiles = inconsistentFiles.length > 0;

        // Hide the setting completely if there are no inconsistent files
        if (!hasInconsistentFiles) {
            setTimeout(() => {
                excludeAllSetting.settingEl.hide();
                addAllMissingSettings.settingEl.addClass('no-top-border-padded');
            }, 0);
        }

        excludeAllSetting.addToggle(toggle => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    // Call our standardized exclude handler
                    this.handleExcludeAllToggled(key, value);
                },
                this.plugin
            );
            
            // Store reference to toggle
            const toggleData = this.fileToggleComponents.get(key);
            if (toggleData) toggleData.excludeAllToggle = handler;

            // Initial state check - only set to true if there are files and all are excluded
            const allExcluded = inconsistentFiles.length > 0 && 
                                inconsistentFiles.every(file => state?.excludedFiles.has(file.path));
            handler.setValue(allExcluded);
            
            // Disable the toggle if there are no inconsistent files
            if (!hasInconsistentFiles) {
                handler.setDisabled(true);
            }

            // Create a toggle relationship for this exclude all toggle
            const relationship = new ToggleRelationship(handler);
            this.toggleRelationships.set(`exclude-all-${key}`, relationship);
            
            return toggle;
        });

        // Add missing properties toggle (should be added after excludeAllSetting)
        const addAllMissingSettings = new Setting(inconsistentFilesControls)
            .setName('Add all missing properties')
            .setDesc('Toggle to add all missing properties.');

        // Get the description element to customize it
        const addAllMissingDescEl = addAllMissingSettings.descEl;
        addAllMissingDescEl.empty(); // Clear the previous description

        // Add the main description text
        addAllMissingDescEl.createSpan({
            text: "Toggle to add all missing properties.",
            cls: "setting-item-description"
        });

        // Add a line break
        addAllMissingDescEl.createEl('br');

        // Create the counter container with default styling
        const missingFilesCounter = addAllMissingDescEl.createSpan({
            cls: "setting-item-description property-header-stat-row"
        });

        // Count files missing this property
        const missingFilesCount = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            return !properties || !(key in properties);
        }).length;

        // Check if there are any files missing this property
        const hasMissingPropertyFiles = missingFilesCount > 0;

        // Add the appropriate icon and text based on count
        if (missingFilesCount > 0) {
            missingFilesCounter.createSpan({
                cls: "property-header-stat-icon is-inconsistent",
                text: "⚠"
            });
            missingFilesCounter.createSpan({
                text: ` ${missingFilesCount} ${missingFilesCount === 1 ? 'file is' : 'files are'} missing this property`,
                cls: "missing-files-text is-inconsistent"
            });
        } else {
            missingFilesCounter.createSpan({
                cls: "property-header-stat-icon is-consistent",
                text: "✓"
            });
            missingFilesCounter.createSpan({
                text: " No files are missing this property",
                cls: "missing-files-text is-consistent"
            });
        }

        // Add the toggle (disabled if no missing property files)
        addAllMissingSettings.addToggle(toggle => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    // Call our handler function
                    this.handleAddAllMissingToggled(key, value);
                },
                this.plugin
            );
            
            // Set initial state
            handler.setDisabled(!hasMissingPropertyFiles);
            
            // Find out if all missing properties are already toggled on
            const allMissingEnabled = inconsistentFiles.every(file => {
                const properties = this.fileProperties.get(file.path);
                if (properties && key in properties) return true; // Not missing, so counts as "enabled"
                
                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                return fileActions.add; // For missing properties, check if add is true
            });

            handler.setValue(allMissingEnabled && hasMissingPropertyFiles);

            // Hide the toggle if there are no missing properties
            if (!hasMissingPropertyFiles) {
                setTimeout(() => {
                    addAllMissingSettings.controlEl.hide();
                }, 0);
            }
            
            // Create a relationship for this toggle
            const relationship = new ToggleRelationship(handler);
            this.toggleRelationships.set(`add-all-missing-${key}`, relationship);
            
            // Store reference to this toggle
            this.addAllMissingToggles.set(key, handler);
            
            return toggle;
        });

        // Add "Apply value" toggle
        const applyValueToAllSettings = new Setting(inconsistentFilesControls)
            .setName('Apply defined property value for all')
            .setDesc('Applies the value entered or selected above for all the missing properties.');

        // Add the toggle
        applyValueToAllSettings.addToggle(toggle => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    // Handle toggle change
                    this.handleApplyValueToAllToggled(key, value);
                },
                this.plugin
            );
            
            // Initialize as disabled if addAllMissingToggle is not checked
            const addAllMissingToggle = this.addAllMissingToggles.get(key);
            const isAddAllMissingEnabled = addAllMissingToggle ? addAllMissingToggle.getValue() : false;

            handler.setDisabled(!isAddAllMissingEnabled);

            // Hide the entire setting if there are no missing properties
            if (!hasMissingPropertyFiles) {
                setTimeout(() => {
                    applyValueToAllSettings.settingEl.hide();
                }, 0);
            }

            // Find out if all missing files already have "Use Value" enabled
            const allValueEnabled = inconsistentFiles.every(file => {
                const properties = this.fileProperties.get(file.path);
                if (properties && key in properties) return true; // Not missing, so doesn't apply
                
                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                return !fileActions.add || fileActions.value; // Only count files where "Add Missing" is enabled
            });

            handler.setValue(allValueEnabled && isAddAllMissingEnabled);
            
            // Create a relationship for this toggle
            const relationship = new ToggleRelationship(handler);
            this.toggleRelationships.set(`apply-value-all-${key}`, relationship);
            
            // Store reference to this toggle
            this.applyValueToAllToggles.set(key, handler);
            
            return toggle;
        });

        // Add "Overwrite all values" toggle
        const overwriteAllValuesSetting = new Setting(inconsistentFilesControls)
            .setName('Overwrite all values')
            .setDesc('Overwrites the existing values with the value entered or selected above.');

        // Get the description element to customize it
        const overwriteAllValuesDescEl = overwriteAllValuesSetting.descEl;
        overwriteAllValuesDescEl.empty(); // Clear the previous description

        // Add the main description text
        overwriteAllValuesDescEl.createSpan({
            text: "Overwrites the existing values with the value entered or selected above.",
            cls: "setting-item-description"
        });

        // Add a line break
        overwriteAllValuesDescEl.createEl('br');

        // Create the counter container with default styling
        const inconsistentValuesCounter = overwriteAllValuesDescEl.createSpan({
            cls: "setting-item-description property-header-stat-row"
        });

        // Count files with inconsistent values
        const filesWithInconsistentValues = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            // File has the property but the value is inconsistent (not the most common value)
            if (properties && key in properties) {
                const fileValue = properties[key].value;
                const stats = this.propertyConsistency.get(key);
                if (stats && stats.value.mostCommonValue !== null) {
                    // Compare values - if different, it's inconsistent
                    return JSON.stringify(fileValue) !== JSON.stringify(stats.value.mostCommonValue);
                }
            }
            return false;
        }).length;

        // Add the appropriate icon and text based on count
        if (filesWithInconsistentValues > 0) {
            inconsistentValuesCounter.createSpan({
                cls: "property-header-stat-icon is-inconsistent",
                text: "⚠"
            });
            inconsistentValuesCounter.createSpan({
                text: ` ${filesWithInconsistentValues} ${filesWithInconsistentValues === 1 ? 'file has' : 'files have'} inconsistent value`,
                cls: "missing-files-text is-inconsistent"
            });
        } else {
            inconsistentValuesCounter.createSpan({
                cls: "property-header-stat-icon is-consistent",
                text: "✓"
            });
            inconsistentValuesCounter.createSpan({
                text: " No files have inconsistent value",
                cls: "missing-files-text is-consistent"
            });
        }

        // Add the toggle
        overwriteAllValuesSetting.addToggle(toggle => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    // Handle toggle change
                    this.handleOverwriteAllValuesToggled(key, value);
                },
                this.plugin
            );
            
            // Find out if all files with value inconsistencies have overwrite enabled
            const allValuesOverwritten = inconsistentFiles.every(file => {
                const properties = this.fileProperties.get(file.path);
                if (properties && key in properties) {
                    const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                    const fileValue = properties[key].value;
                    const stats = this.propertyConsistency.get(key);
                    // Only count files with inconsistent values
                    if (stats && stats.value.mostCommonValue !== null) {
                        if (JSON.stringify(fileValue) !== JSON.stringify(stats.value.mostCommonValue)) {
                            return fileActions.value;
                        }
                    }
                }
                return true; // Not relevant for this toggle, so count as "applied"
            });

            handler.setValue(allValuesOverwritten && filesWithInconsistentValues > 0);
            
            // Hide the toggle if there are no files with inconsistent values
            if (filesWithInconsistentValues === 0) {
                setTimeout(() => {
                    overwriteAllValuesSetting.controlEl.hide();
                }, 0);
            }
            
            // Create a relationship for this toggle
            const relationship = new ToggleRelationship(handler);
            this.toggleRelationships.set(`overwrite-values-all-${key}`, relationship);
            
            // Store reference to this toggle
            this.overwriteAllValuesToggles.set(key, handler);
            
            return toggle;
        });

        // Inconsistent files list
        const inconsistentFilesList = inconsistentFilesContainer.createDiv({ cls: 'inconsistent-files-list' });
        
        // Handle no inconsistencies case
        if (inconsistentFiles.length === 0) {
            // Hide the entire inconsistent files list container
            inconsistentFilesList.hide();
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

        // Initial check of file toggle states to set the master toggle correctly
        this.syncExclusionToggles(key);
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

        // Determine inconsistency types
        const inconsistencyTypes = {
            missing: !propertyExists,
            value: propertyExists && JSON.stringify(propertyValue) !== JSON.stringify(stats.value.mostCommonValue)
        };

        // Create file item container
        const fileItem = container.createDiv({
            cls: `inconsistent-file-item ${isFileExcluded ? 'is-excluded' : ''}`,
            attr: { 'data-path': file.path }
        });

        // Create Header using Setting
        const fileHeaderSetting = new Setting(fileItem)
            .setName(file.path);

        // Add View File Button
        fileHeaderSetting.addExtraButton((button: ExtraButtonComponent) => {
            button
                .setIcon('eye')
                .setTooltip(`View File: ${file.path}`)
                .onClick(() => {
                    // Open File in New Window
                    this.app.workspace.getLeaf('window').openFile(file)
                        .catch(err => {
                            console.error(`Error opening file ${file.path} in new window:`, err);
                            new Notice(`Error opening file: ${file.name}`);
                        });
                });
        });

        // Add Exclude Toggle
        fileHeaderSetting.addToggle((toggle: ToggleComponent) => {
            // Create standardized toggle handler
            const handler = new ToggleHandler(
                toggle,
                (value) => {
                    // Handle exclude file toggle change
                    this.handleExcludeFileToggled(propertyKey, file.path, fileItem, value);
                },
                this.plugin
            );
            
            // Set initial value and tooltip
            handler.setValue(isFileExcluded);
            toggle.setTooltip(`Exclude this file from changes for property "${propertyKey}"`);
            
            // Store reference
            const toggleData = this.fileToggleComponents.get(propertyKey);
            if (toggleData) {
                toggleData.fileToggles.push(handler);
            }
            
            // Add to relationship with the master "Exclude All" toggle
            const excludeAllRelationship = this.toggleRelationships.get(`exclude-all-${propertyKey}`);
            if (excludeAllRelationship) {
                excludeAllRelationship.addIndividualToggle(handler);
            }
            
            // Create a unique identifier for this file toggle
            const fileToggleId = `file-toggle-${propertyKey}-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
            this.toggleRelationships.set(fileToggleId, new ToggleRelationship(handler));
            
            return toggle;
        });

        // Modify elements and add descriptions
        fileHeaderSetting.nameEl.addClass('file-item-name');
        fileHeaderSetting.settingEl.addClass('bulk-editor-file-header');

        // Add descriptions to the header's descEl
        const fileHeaderDescEl = fileHeaderSetting.descEl;
        fileHeaderDescEl.empty();

        fileHeaderDescEl.createSpan({
            text: "Toggle to ignore this file.",
            cls: "setting-item-description file-header-exclude-desc"
        });
        fileHeaderDescEl.createEl('br', { cls: 'file-header-exclude-desc' });

        const inconsistencyDescSpan = fileHeaderDescEl.createSpan({
            cls: "setting-item-description setting-item-description-subtle"
        });
        if (inconsistencyTypes.missing) {
            inconsistencyDescSpan.createSpan({ cls: 'property-header-stat-icon is-inconsistent', text: '⚠ ' });
            inconsistencyDescSpan.appendText("Missing property.");
        } else if (inconsistencyTypes.value) {
            inconsistencyDescSpan.createSpan({ cls: 'property-header-stat-icon is-inconsistent', text: '⚠ ' });
            inconsistencyDescSpan.appendText("Inconsistent value.");
        }

        // Create Content Section
        const fileContent = fileItem.createDiv({ cls: 'file-item-content' });

        // File details based on inconsistency type
        if (inconsistencyTypes.missing) {
            // Add missing property toggle
            const addMissingSetting = new Setting(fileContent)
                .setName('Add Missing Property')
                .setDesc('Adds this property to the file.')
                .addToggle((toggle: ToggleComponent) => {
                    // Get initial value from file actions
                    const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                    
                    // Create standardized toggle handler
                    const handler = new ToggleHandler(
                        toggle,
                        (isChecked) => {
                            // Handle the Add Missing Property toggle change
                            this.handleAddMissingPropertyToggled(propertyKey, file.path, fileItem, fileContent, isChecked);
                        },
                        this.plugin
                    );
                    
                    // Set initial value
                    handler.setValue(fileActions.add);
                    
                    // Add to relationship with the master "Add All Missing" toggle
                    const relationship = this.toggleRelationships.get(`add-all-missing-${propertyKey}`);
                    if (relationship) {
                        relationship.addIndividualToggle(handler);
                    }
                });
            addMissingSetting.settingEl.setAttr('data-action-key', 'addMissing');
        
            // Set "Use Defined Property Value" toggle
            const useValueOnAddSetting = new Setting(fileContent)
                .setName('Use Defined Property Value')
                .setDesc('Applies the value entered or selected above. If unchecked, adds an empty value.')
                .addToggle((toggle: ToggleComponent) => {
                    // Get initial value from file actions
                    const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                    
                    // Create standardized toggle handler
                    const handler = new ToggleHandler(
                        toggle,
                        (isChecked) => {
                            // Handle the Use Defined Property Value toggle change
                            this.handleUseValueOnAddToggled(propertyKey, file.path, fileItem, isChecked);
                        },
                        this.plugin
                    );
                    
                    // Set initial value and disabled state
                    handler.setValue(fileActions.value);
                    handler.setDisabled(!fileActions.add);
                    
                    // Add to relationship with the master "Apply Value To All" toggle
                    const relationship = this.toggleRelationships.get(`apply-value-all-${propertyKey}`);
                    if (relationship) {
                        relationship.addIndividualToggle(handler);
                    }
                });

            // Add attribute for easier selection
            useValueOnAddSetting.settingEl.setAttr('data-action-key', 'useValueOnAdd');

            // Set initial disabled state based on "Add Missing" toggle
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            if (!fileActions.add) {
                // For any toggle within this setting, make sure it's properly disabled
                const toggleEl = useValueOnAddSetting.controlEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
                if (toggleEl) {
                    toggleEl.disabled = true;
                    
                    // Also disable the entire setting
                    useValueOnAddSetting.settingEl.addClass('setting-disabled');
                    
                    // If there's a toggle handler, update it too
                    const toggleHandler = useValueOnAddSetting.controlEl.querySelector('.toggle-handler') as HTMLElement | null;
                    if (toggleHandler instanceof HTMLElement) {
                        toggleHandler.classList.add('is-disabled');
                    }
                }
            }
        } else if (inconsistencyTypes.value) {
            // Render Disabled Value Replica Directly
            const disabledValueContainer = fileContent.createDiv();
            disabledValueContainer.addClass('dynamic-value-input-container');
            const actualFileType = propertyExists ? properties![propertyKey].type : null;
            const displayType = actualFileType || this.plugin.propertyTypeService.detectPropertyType(propertyValue);

            disabledValueContainer.addClass(`value-input-container-${displayType}`);
            disabledValueContainer.addClass('is-disabled-replica');

            if (displayType === 'list') {
                const listEditorContainer = disabledValueContainer.createDiv({ cls: 'property-value-editor list-editor-container is-disabled-replica' });
                const listValue = Array.isArray(propertyValue) ? propertyValue : [];
                listValue.forEach((item) => {
                    const pill = listEditorContainer.createDiv({ cls: 'list-item-pill is-disabled' });
                    pill.createSpan({ cls: 'pill-text', text: formatValuePreview(item) });
                });
                if (listValue.length === 0) {
                    listEditorContainer.createEl('em', { text: '(Empty list)'});
                }
            } else if (displayType === 'checkbox') {
                const checkboxContainer = disabledValueContainer.createDiv({ cls: 'checkbox-input-container is-disabled-replica'});
                const checkboxInput = checkboxContainer.createEl('input', { type: 'checkbox', cls: 'property-value-checkbox' });
                checkboxInput.checked = !!propertyValue;
                checkboxInput.disabled = true;
            } else {
                const propertyValueDiv = disabledValueContainer.createDiv({
                    cls: 'metadata-input-longtext property-value-editor is-disabled-replica',
                    attr: {
                        contenteditable: 'false',
                        tabindex: '-1',
                        ...( (!propertyValue || String(propertyValue).trim() === '') && { 'data-placeholder': this.getPlaceholderForType(displayType) } )
                    }
                });
                propertyValueDiv.textContent = formatInputValue(propertyValue);
            }

            // Add toggle to control overwriting this value
            const overwriteValueSetting = new Setting(fileContent)
                .setName('Overwrite with Defined Property Value')
                .setDesc('Applies the value entered or selected above, overwriting the current value shown.')
                .addToggle((toggle: ToggleComponent) => {
                    // Get initial value from file actions
                    const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                    
                    // Create standardized toggle handler
                    const handler = new ToggleHandler(
                        toggle,
                        (value) => {
                            // Handle the Overwrite Value toggle change
                            this.handleOverwriteValueToggled(propertyKey, file.path, fileItem, value);
                        },
                        this.plugin
                    );
                    
                    // Set initial value
                    handler.setValue(fileActions.value);
                    
                    // Add to relationship with the master "Overwrite All Values" toggle
                    const relationship = this.toggleRelationships.get(`overwrite-values-all-${propertyKey}`);
                    if (relationship) {
                        relationship.addIndividualToggle(handler);
                    }
                });
            overwriteValueSetting.settingEl.setAttr('data-action-key', 'overwriteValue');
        }

        // Add data attributes for filtering
        if (inconsistencyTypes.missing) {
            fileItem.setAttribute('data-inconsistency-missing', 'true');
        }
        if (inconsistencyTypes.value) {
            fileItem.setAttribute('data-inconsistency-value', 'true');
        }

        // Set initial header appearance
        this.updateFileHeaderAppearance(fileItem, propertyKey);

        // Initialize internal toggles state based on file exclusion
        this.updateInternalTogglesState(fileItem, isFileExcluded);
    }

    /**
     * Clears and re-renders the content (pills and input) of a list editor container.
     */
    private renderListEditorContent(propertyKey: string, container: HTMLElement): void {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;

        // Ensure listValue is an array
        let listValue: YamlPropertyValue[] = [];
        // Prioritize overrideValue if it exists and is an array
        if (Array.isArray(state.overrideValue)) {
            listValue = state.overrideValue;
        } else {
            // Otherwise, try to use initial stats, converting if necessary
            const stats = this.propertyConsistency.get(propertyKey);
            if (stats) {
                const initialValue = stats.value.mostCommonValue ?? stats.value.firstEncounteredValue;
                if (Array.isArray(initialValue)) {
                    listValue = initialValue;
                } else if (initialValue !== null && initialValue !== undefined) {
                    // Treat non-arrays as a single-item list
                    listValue = [initialValue];
                }
                // Store the potentially converted array back into overrideValue
                state.overrideValue = [...listValue];
            }
        }
        // Make sure overrideValue is now definitely an array
        if (!Array.isArray(state.overrideValue)) {
            state.overrideValue = [];
        }

        // Clear existing content
        container.empty();

        // Render pills for each item
        listValue.forEach((item, index) => {
            const pillElement = this.createPill(propertyKey, item, index);
            container.appendChild(pillElement);
        });

        const isListEmpty = listValue.length === 0;

        // Create the contenteditable div for adding new items
        const newItemInput = container.createDiv({
            cls: 'new-item-input',
            attr: {
                contenteditable: 'true',
                'aria-label': 'Add new list item',
                role: 'textbox',
                // Conditionally add data-placeholder attribute
                ...(isListEmpty && { 'data-placeholder': 'Empty' })
            }
        });

        // Event listener for adding items on Enter and preventing newlines
        this.plugin.registerDomEvent(newItemInput, 'keydown', (e: KeyboardEvent) => {
            // Prevent Enter from creating a new line in the div
            if (e.key === 'Enter') {
                e.preventDefault();
                const newValue = newItemInput.textContent?.trim();
                if (newValue) {
                    // Add the new value to the state array
                    if (Array.isArray(state.overrideValue)) {
                        state.overrideValue.push(newValue);
                    } else {
                        state.overrideValue = [newValue];
                    }

                    // Update counter for the new list value (debounced)
                    this.debouncedUpdateValueCounter(propertyKey, [...state.overrideValue], 'list');

                    // Re-render the content of this specific list editor
                    this.renderListEditorContent(propertyKey, container);
                    
                    // Find the *new* input element after re-rendering and focus it
                    const newInputElement = container.querySelector('.new-item-input') as HTMLElement | null;
                    newInputElement?.focus();
                }
            } else if (e.key === 'Backspace') {
                const selection = window.getSelection();
                // Check if input is empty or cursor is at the very start
                const isEmpty = newItemInput.textContent?.length === 0;
                const isAtStart = selection?.anchorOffset === 0 && selection?.focusOffset === 0;
        
                if (isEmpty || isAtStart) {
                    e.preventDefault();
                    // Find the last pill in this container
                    const pills = container.querySelectorAll('.list-item-pill[tabindex="0"]') as NodeListOf<HTMLElement>;
                    const lastPill = pills[pills.length - 1];
                    if (lastPill) {
                        lastPill.focus();
                    }
                }
            }
        });

        // Add click listener to the container to focus the input div when clicking empty space
        this.plugin.registerDomEvent(container, 'click', (e: MouseEvent) => {
            if (e.target === container) {
                newItemInput.focus();
            }
        });

        // Add paste handler to sanitize pasted content (remove newlines)
        this.plugin.registerDomEvent(newItemInput, 'paste', (e: ClipboardEvent) => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain');
            if (text) {
                // Remove line breaks from pasted text
                const sanitizedText = text.replace(/(\r\n|\n|\r)/gm, " ");
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    const textNode = document.createTextNode(sanitizedText);
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    newItemInput.dispatchEvent(new Event('input'));
                }
            }
        });
    }

    /**
     * Creates a pill element for a list item.
     */
    private createPill(propertyKey: string, itemValue: YamlPropertyValue, index: number): HTMLElement {
        const state = this.propertiesState.get(propertyKey);

        const pill = createDiv({
            cls: 'list-item-pill',
            attr: {
                'data-index': index,
                tabindex: '0'
            }
        });

        // Create span for the text content
        const textSpan = pill.createDiv({ cls: 'pill-text' });
        textSpan.textContent = formatValuePreview(itemValue);

        // Create remove button
        const removeButton = pill.createDiv({
            cls: 'remove-pill-button',
            attr: { 'aria-label': 'Remove item' }
        });
        setIcon(removeButton, 'x');

        // Add click listener to remove button
        this.plugin.registerDomEvent(removeButton, 'click', (e: MouseEvent) => {
            e.stopPropagation();
            if (state && Array.isArray(state.overrideValue)) {
                const currentItems = state.overrideValue;
                const itemIndex = parseInt(pill.getAttribute('data-index') || '-1');
                if (itemIndex >= 0 && itemIndex < currentItems.length) {
                    // Remove the item from the array
                    currentItems.splice(itemIndex, 1);

                    // Update counter after removing from list (debounced)
                    this.debouncedUpdateValueCounter(propertyKey, [...currentItems], 'list');
                    // Find the container and re-render its content
                    const listEditorContainer = pill.closest('.list-editor-container');
                    if (listEditorContainer instanceof HTMLElement) {
                        this.renderListEditorContent(propertyKey, listEditorContainer);
                        // Focus the input after removing an item
                        const input = listEditorContainer.querySelector('.new-item-input') as HTMLInputElement | null;
                        input?.focus();
                    }
                }
            }
        });

        // Add Double-click to Edit Functionality
        this.plugin.registerDomEvent(pill, 'dblclick', () => {
            // Ensure state exists and value is an array
            if (!state || !Array.isArray(state.overrideValue)) return;

            const originalValue = itemValue;
            const itemIndex = parseInt(pill.getAttribute('data-index') || '-1');
            if (itemIndex === -1) return;

            // Hide the original pill
            pill.classList.add('is-editing');

            // Create temporary editing input (contenteditable div)
            const editingInput = createDiv({
                cls: 'new-item-input editing-pill-input',
                attr: {
                    contenteditable: 'true',
                    'aria-label': `Edit item ${index + 1}`
                },
                text: formatInputValue(originalValue)
            });

            // Function to finalize edit or cancel
            const finalizeEdit = (saveChanges: boolean) => {
                const listEditorContainer = pill.closest('.list-editor-container');
    
                if (saveChanges) {
                    // Save Logic
                    const newValue = editingInput.textContent?.trim();
                    if (newValue !== null && newValue !== undefined && newValue !== '') {
                        if (Array.isArray(state.overrideValue)) {
                            state.overrideValue[itemIndex] = newValue;
                        }
                    } else {
                        if (Array.isArray(state.overrideValue)) {
                            state.overrideValue.splice(itemIndex, 1);
                        }
                    }

                    // Update counter after editing list item (debounced)
                    if (Array.isArray(state.overrideValue)) {
                        this.debouncedUpdateValueCounter(propertyKey, [...state.overrideValue], 'list');
                    }

                    // Clean up the temporary input
                    editingInput.remove();
                    // Re-render ONLY on save
                    if (listEditorContainer instanceof HTMLElement) {
                        this.renderListEditorContent(propertyKey, listEditorContainer);
                    } else {
                        // Fallback - unlikely
                        pill.classList.remove('is-editing');
                    }
                } else {
                    // Cancel Logic
                    editingInput.remove();
                }
            };

            // Event listeners for the temporary input
            this.plugin.registerDomEvent(editingInput, 'blur', () => {
                // Use a small delay to avoid race conditions with click/enter
                setTimeout(() => {
                    // Check if the element still exists (might have been removed by Enter/Escape)
                    if (editingInput.isConnected) {
                        finalizeEdit(true);
                    }
                }, 150);
            });

            this.plugin.registerDomEvent(editingInput, 'keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // Save changes
                    finalizeEdit(true);
    
                    // Add Focus Logic
                    const listEditorContainer = pill.closest('.list-editor-container');
                    if (listEditorContainer instanceof HTMLElement) {
                        // Find all pills and the input field *after* re-render
                        const pillsAfterRender = listEditorContainer.querySelectorAll('.list-item-pill[tabindex="0"]') as NodeListOf<HTMLElement>;
                        const newItemInputAfterRender = listEditorContainer.querySelector('.new-item-input') as HTMLElement | null;
    
                        // Determine the next element to focus based on the original itemIndex
                        let elementToFocus: HTMLElement | null = null;
                        if (itemIndex + 1 < pillsAfterRender.length) {
                            // Focus the next pill if it exists
                            elementToFocus = pillsAfterRender[itemIndex + 1];
                        } else {
                            // Otherwise, focus the 'add new' input field
                            elementToFocus = newItemInputAfterRender;
                        }
    
                        // Set the focus
                        elementToFocus?.focus();
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    editingInput.remove();
                    pill.classList.remove('is-editing');
                    pill.focus();
                }
            });

            // Insert the editing input right after the hidden pill
            pill.after(editingInput);

            // Focus the input and select its content
            editingInput.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editingInput);
            selection?.removeAllRanges();
            selection?.addRange(range);
        });

        // Add Backspace to Delete Pill Functionality
        this.plugin.registerDomEvent(pill, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Backspace') {
                e.preventDefault();

                if (!state || !Array.isArray(state.overrideValue)) return;

                const itemIndex = parseInt(pill.getAttribute('data-index') || '-1');
                if (itemIndex === -1) return;

                // Remove the item from the state array
                state.overrideValue.splice(itemIndex, 1);

                // Update counter after removing from list (debounced)
                this.debouncedUpdateValueCounter(propertyKey, [...state.overrideValue], 'list');

                // Get container reference *before* potentially removing the pill element during re-render
                const listEditorContainer = pill.closest('.list-editor-container');
                if (!(listEditorContainer instanceof HTMLElement)) return;

                // Re-render the list container
                this.renderListEditorContent(propertyKey, listEditorContainer);

                // Set Focus After Deletion
                const pillsAfterRender = listEditorContainer.querySelectorAll('.list-item-pill[tabindex="0"]') as NodeListOf<HTMLElement>;
                const newItemInputAfterRender = listEditorContainer.querySelector('.new-item-input') as HTMLElement | null;

                let elementToFocus: HTMLElement | null = null;
                if (itemIndex > 0 && pillsAfterRender.length > 0) {
                    // Focus the item that is now at the previous index (or the new last item if the original last was deleted)
                    elementToFocus = pillsAfterRender[Math.min(itemIndex - 1, pillsAfterRender.length - 1)];
                } else {
                    // If the first item was deleted, or no pills remain, focus the input
                    elementToFocus = newItemInputAfterRender;
                }

                elementToFocus?.focus();
            }
        });

        return pill;
    }

    // =================================================================
    // SECTION: Property Data Methods
    // =================================================================

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
                this.plugin.parseFileProperties(file);
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
                            overrideValue: null,
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
                            value: {
                                total: 0,
                                consistent: 0,
                                mostCommonValue: null,
                                firstEncounteredValue: undefined,
                                allUniqueValues: []
                            }
                        });
                    }
                    
                    // Update consistency stats
                    this.updatePropertyConsistency(key, file.path, propertiesWithType[key]);
                });
            }
            
            // If no properties found, show empty-state message and disable all controls
            if (this.propertiesState.size === 0) {
                const fileWord = this.files.length === 1 ? 'file' : 'files';
                if (this.emptyStateEl) {
                    this.emptyStateEl.setText(`No properties found across the selected ${fileWord}.`);
                    this.emptyStateEl.show();
                }
                if (this.propertiesListContainer) this.propertiesListContainer.hide();
                this.enableDisableToggle?.setDisabled(true);
                this.expandButton?.setDisabled(true);
                this.collapseButton?.setDisabled(true);
                this.applyButton?.setDisabled(true);
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
                counts: new Map<string, { count: number; value: YamlPropertyValue }>(),
                firstValue: undefined as YamlPropertyValue | undefined,
                hasFoundFirst: false,
                uniqueValuesSet: new Set<string>(),
                uniqueValues: [] as YamlPropertyValue[]
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
                const valueStr = JSON.stringify(property.value);
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
            let mostCommonValue: YamlPropertyValue = null;
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
                    total: stats.type.total,
                    consistent: 0,
                    mostCommonValue: null,
                    firstEncounteredValue: undefined,
                    allUniqueValues: []
                };
            }

            stats.value.total = stats.type.total;
            stats.value.consistent = maxValueCount;
            stats.value.mostCommonValue = mostCommonValue;
            stats.value.firstEncounteredValue = valueDetails.firstValue;
            stats.value.allUniqueValues = valueDetails.uniqueValues;
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

    /**
     * Calculates how many files have the property with a specific value.
     */
    private calculateValueCount(propertyKey: string, targetValue: YamlPropertyValue): number {
        let count = 0;
        const targetValueString = JSON.stringify(targetValue);

        for (const file of this.files) {
            const fileProps = this.fileProperties.get(file.path);
            if (fileProps && fileProps[propertyKey]) {
                const actualFileValue = fileProps[propertyKey].value;
                const actualFileValueString = JSON.stringify(actualFileValue);

                if (actualFileValueString === targetValueString) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * Parses user input from the editor based on the target type.
     */
    private parseUserInput(inputValue: string | null, targetType: string): YamlPropertyValue {
        if (inputValue === null) return null;
        const trimmedValue = inputValue.trim();

        switch (targetType) {
            case 'number': {
                const num = Number(trimmedValue);
                return !isNaN(num) ? num : null;
            }
            case 'checkbox':
                return trimmedValue.toLowerCase() === 'true';
            case 'date':
            case 'datetime':
                return trimmedValue;
            case 'list':
                return trimmedValue.split(',')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
            case 'text':
            default:
                return inputValue;
        }
    }

    /**
     * Helper to get the Obsidian-defined type for a property key.
     */
    private getObsidianDefinedType(_propertyKey: string): string | null {
        return null;
    }

    /**
     * Processes an existing property value based on the property state and file actions.
     * Handles type conversions and overrides.
     */
    private processPropertyValue(key: string, filePath: string, currentValue: YamlPropertyValue): YamlPropertyValue | undefined {
        const state = this.propertiesState.get(key);
        if (!state) return currentValue;

        // Handle file exclusion first
        if (state.excludedFiles.has(filePath)) {
            return currentValue;
        }

        const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };

        // Check if this property is disabled for editing
        if (!state.enabled) {
            const action = state.disabledAction === 'global'
                ? this.globalSettings.disabledAction
                : state.disabledAction;

            if (action === 'remove') {
                return undefined;
            }
            return currentValue;
        }

        // Property is ENABLED for editing
        let newValue = currentValue;
        const stats = this.propertyConsistency.get(key);
        const targetType = state.changeType ||
                      (stats ? stats.type.mostCommonType : null) ||
                      this.plugin.propertyTypeService.detectPropertyType(currentValue) ||
                      'text';

        // Check if there's an override value specified by the user
        const hasOverride = state.overrideValue !== null && state.overrideValue !== undefined;

        if (hasOverride) {
            // Use the override value, attempting conversion based on targetType
            const override = state.overrideValue;

            switch (targetType) {
                case 'checkbox':
                    if (typeof override === 'boolean') {
                        newValue = override;
                    } else {
                        newValue = String(override).toLowerCase() === 'true';
                    }
                    break;
                case 'number':
                    if (typeof override === 'number') {
                        newValue = override;
                    } else {
                        const num = Number(String(override).trim());
                        newValue = !isNaN(num) ? num : 0;
                    }
                    break;
                case 'date':
                case 'datetime':
                    newValue = String(override).trim();
                    break;
                case 'list':
                    if (Array.isArray(override)) {
                        newValue = [...override];
                    } else {
                        newValue = String(override).split(',').map((s: string) => s.trim()).filter(s => s);
                    }
                    break;
                case 'text':
                default:
                    newValue = String(override);
                    break;
            }
        } else {
            newValue = currentValue;
        }

        // Add Parsing Logic
        if (hasOverride && typeof newValue === 'string') {
            const stringValue = newValue as string;
            switch (targetType) {
                case 'number': {
                    const parsedNum = Number(stringValue.trim());
                    newValue = !isNaN(parsedNum) ? parsedNum : stringValue;
                    break;
                }
                case 'checkbox':
                    newValue = stringValue.trim().toLowerCase() === 'true';
                    break;
                case 'date':
                case 'datetime':
                    newValue = stringValue.trim();
                    break;
                case 'text':
                default:
                    newValue = stringValue;
                    break;
            }
        } else if (hasOverride && targetType === 'list' && Array.isArray(state.overrideValue)) {
            newValue = state.overrideValue;
        }

       return newValue;
    }
    
    /**
     * Determines the value for a property that is missing from a file, based on state.
     */
    private processMissingProperty(key: string, filePath: string): YamlPropertyValue | undefined {
        const state = this.propertiesState.get(key);
        if (!state) return undefined;

        // Handle file exclusion first
        if (state.excludedFiles.has(filePath)) {
            return undefined;
        }

        const stats = this.propertyConsistency.get(key);
        const targetType = state.changeType ||
                        (stats ? stats.type.mostCommonType : null) ||
                        getDefaultTypeForKey(key);

        // Should we add this property?
        let shouldAdd = false;
        if (state.enabled) {
            shouldAdd = state.overrideValue !== null && state.overrideValue !== undefined;
        } else {
            const action = state.disabledAction === 'global'
                ? this.globalSettings.disabledAction
                : state.disabledAction;
            shouldAdd = (action === 'add_if_missing');
        }

        if (!shouldAdd) {
            return undefined;
        }

        // Determine the value to add
        const hasOverride = state.overrideValue !== null && state.overrideValue !== undefined;
        let valueToAdd: YamlPropertyValue;

        if (hasOverride) {
            if (targetType === 'list' && Array.isArray(state.overrideValue)) {
                valueToAdd = state.overrideValue;
            } else if (typeof state.overrideValue === 'string') {
                const stringValue = state.overrideValue as string;
                switch (targetType) {
                    case 'number': {
                        const parsedNum = Number(stringValue.trim());
                        valueToAdd = !isNaN(parsedNum) ? parsedNum : null;
                        break;
                    }
                    case 'checkbox':
                        valueToAdd = stringValue.trim().toLowerCase() === 'true';
                        break;
                    case 'list':
                        valueToAdd = stringValue.split(',')
                                        .map(s => s.trim())
                                        .filter(s => s.length > 0);
                        break;
                    case 'date':
                    case 'datetime':
                        valueToAdd = stringValue.trim();
                        break;
                    case 'text':
                    default:
                        valueToAdd = stringValue;
                        break;
                }
            } else {
                valueToAdd = getEmptyValueForType(targetType);
            }

            return valueToAdd;
        }
    }

    // =================================================================
    // SECTION: UI Update Methods
    // =================================================================

    /**
     * Handles changes to the "Overwrite with Defined Property Value" toggle in a file item
     */
    private handleOverwriteValueToggled(
        propertyKey: string,
        filePath: string,
        fileItem: HTMLElement,
        value: boolean
    ): void {
        // Skip if already updating from master toggle
        if (this.isUpdatingFromIndividualToggle) return;
        
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        this.isUpdatingFromIndividualToggle = true;
        
        try {
            // Update data model
            const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
            fileActions.value = value;
            state.fileActions.set(filePath, fileActions);
            
            // Update the file header appearance
            this.updateFileHeaderAppearance(fileItem, propertyKey);
            
            // Update "Overwrite All Values" master toggle
            const relationship = this.toggleRelationships.get(`overwrite-values-all-${propertyKey}`);
            if (relationship) {
                relationship.updateFromIndividual();
            }

            // Update property and value counters
            this.updatePropertyCountersUI(propertyKey);
            
        } finally {
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to the "Overwrite All Values" toggle
     */
    private handleOverwriteAllValuesToggled(propertyKey: string, value: boolean): void {
        // Skip if already updating from individual toggles
        if (this.isUpdatingFromIndividualToggle) return;
        
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        this.isUpdatingFromIndividualToggle = true;
        
        try {
            // Get inconsistent files container to find UI elements
            const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`) as HTMLElement | null;
            if (!inconsistentFilesContainer) return;
            
            // Get files that have this property (not missing)
            const inconsistentFiles = this.getInconsistentFiles(propertyKey);
            const filesWithValues = inconsistentFiles.filter(file => {
                const properties = this.fileProperties.get(file.path);
                return properties && (propertyKey in properties);
            });
            
            // Update each file
            filesWithValues.forEach(file => {
                // Update data model
                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                fileActions.value = value;
                state.fileActions.set(file.path, fileActions);
                
                // Find this file's toggle in the DOM
                const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`);
                if (!fileItem) return;
                
                // Update "Overwrite Value" toggle
                const overwriteValueToggleEl = fileItem.querySelector('.setting-item[data-action-key="overwriteValue"] input[type="checkbox"]') as HTMLInputElement | null;
                if (overwriteValueToggleEl) {
                    this.setCheckboxVisualState(overwriteValueToggleEl, value);
                }
                
                // Update header appearance
                this.updateFileHeaderAppearance(fileItem as HTMLElement, propertyKey);
            });
            
            // Update property and value counters
            this.updatePropertyCountersUI(propertyKey);
            
        } finally {
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to the "Use Defined Property Value" toggle in a file item
     */
    private handleUseValueOnAddToggled(
        propertyKey: string,
        filePath: string,
        fileItem: HTMLElement,
        isChecked: boolean
    ): void {
        // Skip if already updating from master toggle
        if (this.isUpdatingFromIndividualToggle) return;
        
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        this.isUpdatingFromIndividualToggle = true;
        
        try {
            // Update data model
            const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
            fileActions.value = isChecked;
            state.fileActions.set(filePath, fileActions);
            
            // Update the file header appearance
            this.updateFileHeaderAppearance(fileItem, propertyKey);
            
            // Sync the "Apply Defined Property Value For All" master toggle
            this.refreshApplyValueToAllToggle(propertyKey);

            // Update property and value counters
            this.updatePropertyCountersUI(propertyKey);

        } finally {
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to the "Apply Defined Property Value for All" toggle
     */
    private handleApplyValueToAllToggled(propertyKey: string, value: boolean): void {
        if (this.isUpdatingFromIndividualToggle) return;

        const state = this.propertiesState.get(propertyKey);
        if (!state) return;

        this.isUpdatingFromIndividualToggle = true;

        try {
            const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`) as HTMLElement | null;
            if (!inconsistentFilesContainer) return;

            const inconsistentFiles = this.getInconsistentFiles(propertyKey);

            // Only targets missing-property files where "Add Missing" is ON
            inconsistentFiles.forEach(file => {
                if (state.excludedFiles.has(file.path)) return;

                const properties = this.fileProperties.get(file.path);
                const isMissing = !properties || !(propertyKey in properties);
                if (!isMissing) return;

                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                if (!fileActions.add) return;

                fileActions.value = value;
                state.fileActions.set(file.path, fileActions);

                const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`);
                if (!fileItem) return;

                const checkbox = fileItem.querySelector('.setting-item[data-action-key="useValueOnAdd"] input[type="checkbox"]') as HTMLInputElement | null;
                if (checkbox) this.setCheckboxVisualState(checkbox, value);

                this.updateFileHeaderAppearance(fileItem as HTMLElement, propertyKey);
            });

            this.updatePropertyCountersUI(propertyKey);

        } finally {
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to the "Add Missing Property" toggle in a file item
     */
    private handleAddMissingPropertyToggled(
        propertyKey: string, 
        filePath: string, 
        fileItem: HTMLElement,
        fileContent: HTMLElement,
        isChecked: boolean
    ): void {
        // Skip if already updating from master toggle
        if (this.isUpdatingFromIndividualToggle) return;
        
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        this.isUpdatingFromIndividualToggle = true;
        
        try {
            // Update data model
            const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
            fileActions.add = isChecked;
            state.fileActions.set(filePath, fileActions);
            
            // Find and update the "Use Value" toggle
            const useValueToggle = fileContent.querySelector('.setting-item[data-action-key="useValueOnAdd"]');
            if (useValueToggle instanceof HTMLElement) {
                this.setUseValueToggleEnabled(useValueToggle, isChecked);
                if (!isChecked) {
                    fileActions.value = false;
                    state.fileActions.set(filePath, fileActions);
                }
            }
            
            // Update the file header appearance
            this.updateFileHeaderAppearance(fileItem, propertyKey);
            
            // Update master toggle state through relationship
            const relationship = this.toggleRelationships.get(`add-all-missing-${propertyKey}`);
            if (relationship) {
                relationship.updateFromIndividual();
            }
            
            // Update property and value counters
            this.updatePropertyCountersUI(propertyKey);
            
        } finally {
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to the "Add All Missing Properties" toggle
     */
    private handleAddAllMissingToggled(propertyKey: string, value: boolean): void {
        // Skip processing if already updating from individual toggles
        if (this.isUpdatingFromIndividualToggle) return;
        
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        // Set the updating flag to prevent circular updates
        this.isUpdatingFromIndividualToggle = true;
        
        try {
            // Get inconsistent files missing this property
            const inconsistentFiles = this.getInconsistentFiles(propertyKey);
            const missingFiles = inconsistentFiles.filter(file => {
                const properties = this.fileProperties.get(file.path);
                return !properties || !(propertyKey in properties);
            });
            
            // Get container for finding UI elements
            const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`) as HTMLElement | null;
            if (!inconsistentFilesContainer) return;
            
            if (value) {
                // TURNING ON "Add All Missing Properties"
                
                // 1. Process each inconsistent file
                missingFiles.forEach(file => {
                    // Check if the "Exclude File" toggle is ON or OFF
                    const isExcluded = state.excludedFiles.has(file.path);
                    
                    if (!isExcluded) {
                        // If "Exclude File" is OFF, turn ON "Add Missing Property"
                        const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                        fileActions.add = true;
                        state.fileActions.set(file.path, fileActions);
                        
                        // Find this file's toggles in the DOM
                        const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`);
                        if (!fileItem) return;
                        
                        // Update "Add Missing Property" toggle
                        const addMissingToggleEl = fileItem.querySelector('.setting-item[data-action-key="addMissing"] input[type="checkbox"]') as HTMLInputElement | null;
                        if (addMissingToggleEl) {
                            this.setCheckboxVisualState(addMissingToggleEl, true);
                        }
                        
                        // 2. Enable "Use Defined Property Value" toggle
                        const useValueSettingItem = fileItem.querySelector('.setting-item[data-action-key="useValueOnAdd"]') as HTMLElement | null;
                        if (useValueSettingItem) {
                            this.setUseValueToggleEnabled(useValueSettingItem, true);
                        }
                        
                        // Update header appearance
                        this.updateFileHeaderAppearance(fileItem as HTMLElement, propertyKey);
                    }
                });
                
                // Enable the "Apply Value To All" toggle
                this.updateApplyValueToAllToggleState(propertyKey, false);
                
            } else {
                // TURNING OFF "Add All Missing Properties"
                
                // 1. Process each inconsistent file
                missingFiles.forEach(file => {
                    // Check if the "Exclude File" toggle is ON or OFF
                    const isExcluded = state.excludedFiles.has(file.path);
                    
                    if (!isExcluded) {
                        // Find this file's DOM elements
                        const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`);
                        if (!fileItem) return;
                        
                        // Get file actions
                        const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                        
                        // Check if "Add Missing Property" is ON or OFF
                        if (fileActions.add) {
                            // Case: "Add Missing Property" is ON

                            // Disable "Use Defined Property Value" toggle
                            const useValueSettingItem = fileItem.querySelector('.setting-item[data-action-key="useValueOnAdd"]') as HTMLElement | null;
                            if (useValueSettingItem) {
                                fileActions.value = false;
                                this.setUseValueToggleEnabled(useValueSettingItem, false);
                            }
                            
                            // Toggle OFF "Add Missing Property"
                            fileActions.add = false;
                            
                            // Update "Add Missing Property" toggle in the UI
                            const addMissingToggleEl = fileItem.querySelector('.setting-item[data-action-key="addMissing"] input[type="checkbox"]') as HTMLInputElement | null;
                            if (addMissingToggleEl) {
                                this.setCheckboxVisualState(addMissingToggleEl, false);
                            }
                        }
                        
                        // Save the updated actions
                        state.fileActions.set(file.path, fileActions);
                        
                        // Update header appearance
                        this.updateFileHeaderAppearance(fileItem as HTMLElement, propertyKey);
                    }
                });
                
                // Turn OFF and disable the main "Apply Value To All" toggle
                this.updateApplyValueToAllToggleState(propertyKey, true);
            }
            
            // Update property counters in the UI
            this.updatePropertyCountersUI(propertyKey);
            
        } finally {
            // Always reset the flag when done
            this.isUpdatingFromIndividualToggle = false;
        }
    }

    /**
     * Handles changes to file exclusion toggles
     */
    private handleExcludeFileToggled(propertyKey: string, filePath: string, fileItem: HTMLElement, value: boolean): void {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        // Update our data model
        if (value) {
            // When excluding a file, turn off any action toggles
            const fileActions = state.fileActions.get(filePath) || { type: false, value: false, add: false };
            
            // If "Add Missing Property" is enabled, turn it off
            if (fileActions.add) {
                fileActions.add = false;
                fileActions.value = false; // Also turn off "Use Value"
                state.fileActions.set(filePath, fileActions);
                
                // Update "Add Missing Property" toggle visual state
                const addMissingCheckbox = fileItem.querySelector('.setting-item[data-action-key="addMissing"] input[type="checkbox"]') as HTMLInputElement | null;
                if (addMissingCheckbox) this.setCheckboxVisualState(addMissingCheckbox, false);

                // Disable and turn off "Use Defined Property Value" toggle
                const useValueSettingItem = fileItem.querySelector('.setting-item[data-action-key="useValueOnAdd"]') as HTMLElement | null;
                if (useValueSettingItem) this.setUseValueToggleEnabled(useValueSettingItem, false);
            }
            
            // If "Overwrite Value" is enabled for existing properties, turn it off
            if (fileActions.value && !fileActions.add) {
                fileActions.value = false;
                state.fileActions.set(filePath, fileActions);
                
                // Update "Overwrite Value" toggle visual state
                const overwriteCheckbox = fileItem.querySelector('.setting-item[data-action-key="overwriteValue"] input[type="checkbox"]') as HTMLInputElement | null;
                if (overwriteCheckbox) this.setCheckboxVisualState(overwriteCheckbox, false);
            }
            
            // Add to excluded files
            state.excludedFiles.add(filePath);
            fileItem.classList.add('is-excluded');
        } else {
            // Remove from excluded files
            state.excludedFiles.delete(filePath);
            fileItem.classList.remove('is-excluded');
        }
        
        // Update related UI
        this.updateFileHeaderAppearance(fileItem, propertyKey);
        this.updateInternalTogglesState(fileItem, value);
        
        // Update the master toggle through the relationship
        const excludeAllRelationship = this.toggleRelationships.get(`exclude-all-${propertyKey}`);
        if (excludeAllRelationship) {
            excludeAllRelationship.updateFromIndividual();
        }
        
        // Update property and value counters
        this.updatePropertyCountersUI(propertyKey);
    }

    /**
     * Handles state changes on the "Exclude All Files" toggle
     */
    private handleExcludeAllToggled(propertyKey: string, value: boolean): void {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        // Get the inconsistent files and container
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`) as HTMLElement | null;
        if (!inconsistentFilesContainer) return;
        
        // Update file exclusions based on the toggle state
        if (value) {
            // TURNING ON - exclude all files
            
            // Step 1: Turn off all individual toggles for files
            inconsistentFiles.forEach(file => {
                // Add to excluded files in state
                state.excludedFiles.add(file.path);
                
                // Reset file actions
                state.fileActions.set(file.path, { add: false, value: false, type: false });
                
                // Find and update the file item in the UI
                const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`) as HTMLElement | null;
                if (fileItem) {
                    // Add excluded class to the file item
                    fileItem.classList.add('is-excluded');
                    
                    // Update file header appearance and internal toggle states
                    this.updateFileHeaderAppearance(fileItem, propertyKey);
                    this.updateInternalTogglesState(fileItem, true);

                    // Get file toggle handler from relationship
                    const relationship = this.toggleRelationships.get(`exclude-all-${propertyKey}`);
                    if (relationship) {
                        const fileToggles = relationship.getIndividualToggles();
                        const fileToggle = fileToggles.find(t =>
                            t.getElement()?.closest(`.inconsistent-file-item[data-path="${file.path}"]`)
                        );
                        if (fileToggle) {
                            fileToggle.setValue(true);
                        }
                    }
                }
            });

            // Lock individual toggles while exclude-all is active
            inconsistentFilesContainer.classList.add('is-exclude-all-active');

            // Step 2: Disable action toggles
            this.updateAddAllMissingToggleState(propertyKey, true);
            this.updateApplyValueToAllToggleState(propertyKey, true);
            this.updateOverwriteAllValuesToggleState(propertyKey, true);
            
        } else {
            // TURNING OFF - Un-exclude all files
            
            // Reset exclusions in state
            inconsistentFiles.forEach(file => {
                state.excludedFiles.delete(file.path);
                
                // Find and update the file item in the UI
                const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`) as HTMLElement | null;
                if (fileItem) {
                    // Remove excluded class from the file item
                    fileItem.classList.remove('is-excluded');
                    
                    // Update file header appearance and internal toggle states
                    this.updateFileHeaderAppearance(fileItem, propertyKey);
                    this.updateInternalTogglesState(fileItem, false);

                    // Update individual toggles through relationship
                    const relationship = this.toggleRelationships.get(`exclude-all-${propertyKey}`);
                    if (relationship) {
                        const fileToggles = relationship.getIndividualToggles();
                        const fileToggle = fileToggles.find(t =>
                            t.getElement()?.closest(`.inconsistent-file-item[data-path="${file.path}"]`)
                        );
                        if (fileToggle) {
                            fileToggle.setValue(false);
                        }
                    }
                }
            });

            // Restore individual toggle interactivity
            inconsistentFilesContainer.classList.remove('is-exclude-all-active');

            // Recalculate action toggle states from current file actions
            this.updateAddAllMissingToggleState(propertyKey);
            this.updateApplyValueToAllToggleState(propertyKey);
            this.updateOverwriteAllValuesToggleState(propertyKey);
        }
        
        // Update property and value counters
        this.updatePropertyCountersUI(propertyKey);
    }

    private updatePropertyEnabledState(key: string, enabled: boolean): void {
        const content = this.propertiesListContainer?.querySelector(`#prop-${key} .property-content`);
        if (content instanceof HTMLElement) {
            content.toggleClass('is-property-disabled', !enabled);
        }
    }
    
    /**
     * Updates all property toggle states based on the master toggle
     */
    private updateAllPropertyToggles(enabled: boolean) {
        // Update each property's enabled state in the model
        this.propertiesState.forEach((state, key) => {
            state.enabled = enabled;
        });
        
        // Use our standardized toggle handlers to update UI
        this.propertyToggleHandlers.forEach((handler, key) => {
            handler.setValue(enabled);
            this.updatePropertyEnabledState(key, enabled);
        });
        
        // Process links in all editors after toggling all
        if (this.propertiesListContainer) {
            const editors = this.propertiesListContainer.querySelectorAll('.property-value-editor');
            editors.forEach(editor => {
                if (editor instanceof HTMLElement) {
                    // Find the property key for this editor
                    const propertyItem = editor.closest('.bulk-property-item');
                    if (propertyItem && propertyItem.id.startsWith('prop-')) {
                        const key = propertyItem.id.substring(5);
                        const state = this.propertiesState.get(key);
                        const editorType = state?.changeType || 
                                        this.propertyConsistency.get(key)?.type.mostCommonType || 
                                        'text';
                        this.processLinksInEditor(editor, editorType);
                    }
                }
            });
        }
        
        // Also update our relationship if it exists
        const globalEnableRelationship = this.toggleRelationships.get('global-enable');
        if (globalEnableRelationship) {
            globalEnableRelationship.updateFromMaster(enabled);
        }
    }
    
    /**
     * Updates the expanded/collapsed state of all properties
     */
    private updateAllExpansionState(expanded: boolean) {
        // Update each property's expansion state
        this.propertiesState.forEach((state, key) => {
            state.expanded = expanded;
        });

        // Update the UI
        const propertyItems = this.propertiesListContainer?.querySelectorAll('.bulk-property-item') || [];
        propertyItems.forEach(item => {
            const header = item.querySelector('.setting-item.bulk-property-item-header-setting');
            const contentContainer = item.querySelector('.property-content') as HTMLElement | null;

            if (expanded) {
                item.classList.remove('is-collapsed');
                contentContainer?.show();
                if (header) header.setAttribute('aria-expanded', 'true');
            } else {
                item.classList.add('is-collapsed');
                contentContainer?.hide();
                if (header) header.setAttribute('aria-expanded', 'false');
            }

            // Update hint text
            const hintSpan = item.querySelector('.property-toggle-hint');
            if (hintSpan) {
                hintSpan.textContent = expanded ? 'Click to hide options.' : 'Click to display options.';
            }
        });
    }

    /**
     * Updates the unified editor's value when the property type changes.
     */
    private updateValueControl(
        valueControlContainer: HTMLElement,
        key: string,
        selectedType: string | null
    ): void {
        const state = this.propertiesState.get(key);
        const stats = this.propertyConsistency.get(key);
        if (!state || !stats) return;
    
        const mostCommonTypeValue = stats.type.mostCommonType;
        const actualType = selectedType || mostCommonTypeValue || 'text';
    
        // Clear the container and recreate the unified value container
        valueControlContainer.empty();
        
        // Update container classes for the new type
        valueControlContainer.className = 'dynamic-value-input-container property-main-value-container';
        valueControlContainer.classList.add(`value-input-container-${actualType}`);
        
        // Create a new unified value container
        this.createUnifiedValueContainer(
            valueControlContainer,
            key,
            actualType
        );
    }

    /**
     * Updates the description text and consistency icon for the property value counter.
     */
    private updateValueCounterUI(propertyKey: string, count: number) {
        const propertyItemEl = this.propertiesListContainer?.querySelector(`#prop-${propertyKey}`);
        const valueDescEl = propertyItemEl?.querySelector('.value-description-container');
        const counterSpan = valueDescEl?.querySelector('.value-counter-span');
        const stats = this.propertyConsistency.get(propertyKey);

        if (counterSpan && stats) {
            counterSpan.empty();

            const filesWithProperty = stats.property.present;

            // Set the main text content including the period
            counterSpan.appendText('Current value present in ' + count + '/' + filesWithProperty + (filesWithProperty === 1 ? ' file.' : ' files.'));

            // Determine consistency
            const isConsistent = filesWithProperty > 0 && count === filesWithProperty;

            // Add the icon span AFTER the period
            counterSpan.createSpan({
                cls: `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`,
                text: isConsistent ? ' ✓' : ' ⚠'
            });
        } else if (counterSpan) {
            counterSpan.empty();
            counterSpan.textContent = 'Current value present in ' + count + '/? files.';
        }
    }

    /**
     * Updates the property counter and value counter in the property header.
     * Used when "Add Missing Property" toggles change the effective property count.
     */
    private updatePropertyCountersUI(propertyKey: string) {
        const stats = this.propertyConsistency.get(propertyKey);
        const state = this.propertiesState.get(propertyKey);
        if (!stats || !state) return;

        const propertyItemEl = this.propertiesListContainer?.querySelector(`#prop-${propertyKey}`);
        if (!propertyItemEl) return;
        
        // Find counter rows in the header
        const propertyCounterRow = propertyItemEl.querySelector('.property-header-stat-row:nth-child(1)');
        const valueCounterRow = propertyItemEl.querySelector('.property-header-stat-row:nth-child(2)');
        
        if (!propertyCounterRow || !valueCounterRow) return;
        
        // Calculate effective property present count
        let effectivePresentCount = stats.property.present;
        
        // Track files that will have the same value
        let effectiveConsistentCount = stats.value.consistent;
        
        // Get the defined value (from input or most common)
        const definedValue = state.overrideValue !== null ? 
            state.overrideValue : 
            stats.value.mostCommonValue;
        
        // Count files where property is missing but will be added
        this.files.forEach(file => {
            const properties = this.fileProperties.get(file.path);
            const propertyExists = properties && propertyKey in properties;
            
            // Skip excluded files
            if (state.excludedFiles.has(file.path)) return;
            
            // If property doesn't exist but will be added
            if (!propertyExists) {
                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                
                if (fileActions.add) {
                    // This file will have the property added, count it
                    effectivePresentCount++;
                    
                    // If "Use Defined Property Value" is enabled, count as consistent
                    if (fileActions.value) {
                        effectiveConsistentCount++;
                    }
                }
            } 
            // If property exists but value will be overwritten
            else if (propertyExists) {
                const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
                const currentValue = properties[propertyKey].value;
                
                // Check if value matches the defined value
                const valueMatches = JSON.stringify(currentValue) === JSON.stringify(definedValue);
                
                // If the value doesn't match but will be overwritten, count as consistent
                if (!valueMatches && fileActions.value) {
                    effectiveConsistentCount++;
                }
                // If the value matches but overwrite is off, it's already counted 
            }
        });
        
        // Calculate effective consistency
        const effectiveTypeTotal = effectivePresentCount; // Types total equals properties present
        
        // Update property counter text
        const propertyValueSpan = propertyCounterRow.querySelector('.property-header-stat-value');
        if (propertyValueSpan) {
            propertyValueSpan.textContent = `${effectivePresentCount}/${stats.property.total}`;
        }
        
        // Update property counter icon based on consistency
        const propertyIconSpan = propertyCounterRow.querySelector('.property-header-stat-icon');
        if (propertyIconSpan) {
            const isConsistent = effectivePresentCount === stats.property.total;
            propertyIconSpan.className = `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`;
            propertyIconSpan.textContent = isConsistent ? '✓' : '⚠';
        }
        
        // Update value counter text
        const valueValueSpan = valueCounterRow.querySelector('.property-header-stat-value');
        if (valueValueSpan) {
            valueValueSpan.textContent = `${effectiveConsistentCount}/${effectiveTypeTotal}`;
        }
        
        // Update value counter icon based on consistency
        const valueIconSpan = valueCounterRow.querySelector('.property-header-stat-icon');
        if (valueIconSpan) {
            const isConsistent = effectiveConsistentCount === effectiveTypeTotal;
            valueIconSpan.className = `property-header-stat-icon ${isConsistent ? 'is-consistent' : 'is-inconsistent'}`;
            valueIconSpan.textContent = isConsistent ? '✓' : '⚠';
        }
    }

    /**
     * Updates the master enable toggle state based on individual property states
     */
    private updateMasterEnableToggleState() {
        if (!this.enableDisableToggle) return;
        
        // Don't update while loading
        if (this.propertyToggleHandlers.size === 0) return;
        
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
     * Gets the master Exclude All Files toggle element by its ID
     */
    private getMasterToggleElement(propertyKey: string): HTMLInputElement | null {
        const settingId = `exclude-all-${propertyKey.replace(/\s+/g, '-')}`;
        const settingEl = this.contentEl.querySelector(`#${settingId}`);
        if (!settingEl) return null;

        // Find the checkbox input within this setting
        const toggleEl = settingEl.querySelector('input[type="checkbox"]');
        return toggleEl instanceof HTMLInputElement ? toggleEl : null;
    }

    /**
     * Updates the state of internal toggles when a file is excluded/included
     */
    private updateInternalTogglesState(fileItem: HTMLElement, isExcluded: boolean) {
        const settingItems = fileItem.querySelectorAll('.file-item-content .setting-item');

        settingItems.forEach(item => {
            if (isExcluded) {
                item.classList.add('setting-disabled');
            } else {
                item.classList.remove('setting-disabled');
            }

            const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (checkbox) {
                if (isExcluded) {
                    checkbox.checked = false;
                    checkbox.disabled = true;
                } else {
                    checkbox.disabled = false;
                }
            }

            const checkboxContainer = item.querySelector('.checkbox-container') as HTMLElement | null;
            if (checkboxContainer) {
                if (isExcluded) {
                    checkboxContainer.classList.remove('is-enabled');
                    checkboxContainer.classList.add('is-disabled');
                } else {
                    checkboxContainer.classList.remove('is-disabled');
                }
                const indicator = checkboxContainer.querySelector('.checkbox-indicator') as HTMLElement | null;
                if (indicator && isExcluded) {
                    indicator.classList.remove('is-enabled');
                }
            }

            const toggleControl = item.querySelector('.setting-item-control') as HTMLElement | null;
            if (toggleControl) {
                if (isExcluded) {
                    toggleControl.classList.add('is-disabled');
                } else {
                    toggleControl.classList.remove('is-disabled');
                }
            }
        });
    }

    private setCheckboxVisualState(checkbox: HTMLInputElement, checked: boolean): void {
        checkbox.checked = checked;
        const container = checkbox.closest('.checkbox-container');
        if (container instanceof HTMLElement) {
            container.classList.toggle('is-enabled', checked);
            const indicator = container.querySelector('.checkbox-indicator') as HTMLElement | null;
            if (indicator) indicator.classList.toggle('is-enabled', checked);
        }
    }

    private refreshApplyValueToAllToggle(propertyKey: string): void {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        const masterToggle = this.applyValueToAllToggles.get(propertyKey);
        if (!masterToggle) return;

        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        let hasApplicable = false;
        let allOn = true;

        // Only considers missing-property files where "Add Missing" is ON
        inconsistentFiles.forEach(file => {
            if (state.excludedFiles.has(file.path)) return;
            const properties = this.fileProperties.get(file.path);
            const isMissing = !properties || !(propertyKey in properties);
            if (!isMissing) return;
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            if (!fileActions.add) return;
            hasApplicable = true;
            if (!fileActions.value) allOn = false;
        });

        const shouldBeOn = hasApplicable && allOn;
        if (masterToggle.getValue() !== shouldBeOn) {
            masterToggle.setValue(shouldBeOn);
        }
    }

    private setUseValueToggleEnabled(settingEl: HTMLElement, enabled: boolean): void {
        const control = settingEl.querySelector('.setting-item-control') as HTMLElement | null;
        const checkboxContainer = settingEl.querySelector('.checkbox-container') as HTMLElement | null;
        const indicator = checkboxContainer?.querySelector('.checkbox-indicator') as HTMLElement | null;
        const checkbox = settingEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        if (enabled) {
            settingEl.classList.remove('setting-disabled');
            control?.classList.remove('is-disabled');
            checkboxContainer?.classList.remove('is-disabled');
            if (checkbox) checkbox.disabled = false;
        } else {
            settingEl.classList.add('setting-disabled');
            control?.classList.add('is-disabled');
            checkboxContainer?.classList.add('is-disabled');
            checkboxContainer?.classList.remove('is-enabled');
            indicator?.classList.remove('is-enabled');
            if (checkbox) {
                checkbox.checked = false;
                checkbox.disabled = true;
            }
        }
    }

    /**
     * Registers a toggle handler with a relationship
     */
    private registerToggleWithRelationship(
        toggleHandler: ToggleHandler,
        relationshipKey: string,
        isMaster: boolean = false
    ): void {
        // Get or create the relationship
        let relationship = this.toggleRelationships.get(relationshipKey);
        if (!relationship && isMaster) {
            // Create new relationship with this toggle as master
            relationship = new ToggleRelationship(toggleHandler);
            this.toggleRelationships.set(relationshipKey, relationship);
        } else if (!relationship) {
            // Can't add to non-existent relationship
            return;
        }
        
        if (!isMaster) {
            // Add as individual toggle
            relationship?.addIndividualToggle(toggleHandler);
        }
    }

    /**
     * Unified method to sync states between master "Exclude All" toggle 
     * and individual file toggles
     */
    private syncExclusionToggles(propertyKey: string, source: 'master' | 'individual' = 'individual') {
        // This functionality is now handled through our ToggleRelationship system
        const relationship = this.toggleRelationships.get(`exclude-all-${propertyKey}`);
        if (!relationship) return;
        
        if (source === 'master') {
            // Update individuals from master
            const masterToggle = relationship.getMasterToggle();
            relationship.updateFromMaster(masterToggle.getValue());
        } else {
            // Update master from individuals
            relationship.updateFromIndividual();
        }
    }

    /**
     * Checks if "Add All Missing Properties" toggle should be on or off
     * based on the state of individual file toggles
     * @param propertyKey The property key
     * @param forceDisabled Whether to force the toggle to be disabled
     */
    private updateAddAllMissingToggleState(propertyKey: string, forceDisabled?: boolean) {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        const masterToggle = this.addAllMissingToggles.get(propertyKey);
        if (!masterToggle) return;
        
        // If forceDisabled parameter is provided, handle disable state directly
        if (forceDisabled !== undefined) {
            masterToggle.setDisabled(forceDisabled);
            // If disabling the toggle, also set it to OFF
            if (forceDisabled && masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Continue with original functionality for state syncing
        // Get inconsistent files missing this property
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        const missingFiles = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            return !properties || !(propertyKey in properties);
        });
        
        if (missingFiles.length === 0) return;

        // Re-enable the toggle (may have been force-disabled by "Exclude All")
        masterToggle.setDisabled(false);

        // Check if all missing files have their "Add Missing Property" toggle ON
        const allMissingEnabled = missingFiles.every(file => {
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            return fileActions.add;
        });
        
        // Only update if actually changing
        if (masterToggle.getValue() !== allMissingEnabled) {
            // Use the toggle handler directly instead of forceToggleVisualUpdate
            masterToggle.setValue(allMissingEnabled);
        }
    }

    /**
     * Updates the "Apply Value To All" toggle state based on individual toggles
     * @param propertyKey The property key
     * @param forceDisabled Whether to force the toggle to be disabled
     */
    private updateApplyValueToAllToggleState(propertyKey: string, forceDisabled?: boolean) {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        const masterToggle = this.applyValueToAllToggles.get(propertyKey);
        if (!masterToggle) return;
        
        // If forceDisabled parameter is provided, handle disable state directly
        if (forceDisabled !== undefined) {
            masterToggle.setDisabled(forceDisabled);
            // If disabling the toggle, also set it to OFF
            if (forceDisabled && masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Continue with original functionality
        // Get all files with missing properties
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        const missingPropertyFiles = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            return !properties || !(propertyKey in properties);
        });
        
        // If no files are missing this property, disable the toggle
        if (missingPropertyFiles.length === 0) {
            masterToggle.setDisabled(true);
            if (masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Get the "Add All Missing" toggle state
        const addAllToggle = this.addAllMissingToggles.get(propertyKey);
        const isAddAllEnabled = addAllToggle ? addAllToggle.getValue() : false;
        
        // The "Apply Value To All" toggle should be disabled if "Add All Missing" is OFF
        if (!isAddAllEnabled) {
            masterToggle.setDisabled(true);
            if (masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Enable the toggle since "Add All Missing" is ON
        masterToggle.setDisabled(false);
        
        // Count how many files with missing properties have "Use Value" enabled
        let filesWithUseValueEnabled = 0;
        
        missingPropertyFiles.forEach(file => {
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            if (fileActions.value) {
                filesWithUseValueEnabled++;
            }
        });
        
        // The master toggle should be ON only when ALL files with missing properties
        // have "Use Value" enabled
        const allFilesHaveUseValueEnabled = missingPropertyFiles.length > 0 && 
                                            filesWithUseValueEnabled === missingPropertyFiles.length;
        
        // Update the toggle state if needed
        if (masterToggle.getValue() !== allFilesHaveUseValueEnabled) {
            // Use the toggle handler directly
            masterToggle.setValue(allFilesHaveUseValueEnabled);
        }
    }

    /**
     * Updates the "Overwrite All Values" toggle state based on individual toggles
     * @param propertyKey The property key
     * @param forceDisabled Whether to force the toggle to be disabled
     */
    private updateOverwriteAllValuesToggleState(propertyKey: string, forceDisabled?: boolean) {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        const masterToggle = this.overwriteAllValuesToggles.get(propertyKey);
        if (!masterToggle) return;
        
        // If forceDisabled parameter is provided, handle disable state directly
        if (forceDisabled !== undefined) {
            masterToggle.setDisabled(forceDisabled);
            // If disabling the toggle, also set it to OFF
            if (forceDisabled && masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Continue with original functionality
        // Get all files with this property (not missing)
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        const filesWithValues = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            return properties && (propertyKey in properties);
        });
        
        // If no files have this property, disable the toggle
        if (filesWithValues.length === 0) {
            masterToggle.setDisabled(true);
            if (masterToggle.getValue()) {
                masterToggle.setValue(false);
            }
            return;
        }
        
        // Enable the toggle since there are files with values
        masterToggle.setDisabled(false);
        
        // Count how many files have "Overwrite Value" enabled
        let filesWithOverwriteEnabled = 0;
        
        filesWithValues.forEach(file => {
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            if (fileActions.value) {
                filesWithOverwriteEnabled++;
            }
        });
        
        // The master toggle should be ON only when ALL files with values
        // have "Overwrite Value" enabled
        const allFilesHaveOverwriteEnabled = filesWithValues.length > 0 && 
                                        filesWithOverwriteEnabled === filesWithValues.length;
        
        // Update the toggle state if needed
        if (masterToggle.getValue() !== allFilesHaveOverwriteEnabled) {
            // Use the toggle handler directly
            masterToggle.setValue(allFilesHaveOverwriteEnabled);
        }
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
        
        // Sync the toggle state with 'master' as source to avoid unnecessary DOM updates
        this.syncExclusionToggles(propertyKey, 'master');
        
        // Update the missing files counter - ADD THIS LINE
        const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`);
        if (inconsistentFilesContainer) {
            this.updateMissingFilesCounter(propertyKey, inconsistentFilesContainer as HTMLElement);
            this.updateInconsistentValuesCounter(propertyKey, inconsistentFilesContainer as HTMLElement);
            
            // Update toggle visibility based on missing properties
            this.updateMissingPropertyTogglesVisibility(propertyKey, inconsistentFilesContainer as HTMLElement);
        }

        // NEW: Update property and value counters in the property header
        this.updatePropertyCountersUI(propertyKey);
    }

    /**
     * Updates the file header appearance based on action toggle states.
     */
    private updateFileHeaderAppearance(fileItemEl: HTMLElement, propertyKey: string) {
        const headerEl = fileItemEl.querySelector('.bulk-editor-file-header');
        if (!headerEl) return;

        const state = this.propertiesState.get(propertyKey);
        const filePath = fileItemEl.dataset.path;
        const fileActions = filePath ? (state?.fileActions.get(filePath) || { add: false, value: false, type: false }) : { add: false, value: false, type: false };

        const isMissing = fileItemEl.hasAttribute('data-inconsistency-missing');
        const isValueMismatch = fileItemEl.hasAttribute('data-inconsistency-value');

        let isResolved = false;
        const contentEl = fileItemEl.querySelector('.file-item-content');
        if (contentEl) {
            if (isMissing) {
                const addMissingToggle = contentEl.querySelector('.setting-item[data-action-key="addMissing"] input[type="checkbox"]') as HTMLInputElement | null;
                isResolved = addMissingToggle?.checked || fileActions.add;
            } else if (isValueMismatch) {
                const overwriteToggle = contentEl.querySelector('.setting-item[data-action-key="overwriteValue"] input[type="checkbox"]') as HTMLInputElement | null;
                isResolved = overwriteToggle?.checked || fileActions.value;
            }
        } else {
            if (isMissing && fileActions.add) {
                isResolved = true;
            } else if (isValueMismatch && fileActions.value) {
                isResolved = true;
            }
        }

        // Remove existing state classes first
        headerEl.classList.remove('file-header-state-warning', 'file-header-state-resolved');

        // Add the appropriate class
        if (isResolved) {
            headerEl.classList.add('file-header-state-resolved');
        } else if (isMissing || isValueMismatch) {
            headerEl.classList.add('file-header-state-warning');
        }
    }

    /**
     * Consistently updates the visual state of a toggle and its DOM elements
     */
    private updateToggleState(toggleEl: HTMLElement, checked: boolean, isDisabled = false): void {
        // Update the checkbox input directly
        const input = toggleEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (input) {
            // Set properties directly on the input element
            input.checked = checked;
            input.disabled = isDisabled;
            
            // Force a change event if needed (for state synchronization)
            if (input.checked !== checked) {
                const event = new Event('change', { bubbles: true });
                input.dispatchEvent(event);
            }
        }
        
        // Update checkbox container classes for visual feedback
        const container = toggleEl.closest('.checkbox-container');
        if (container) {
            if (checked) {
                container.classList.add('is-enabled');
            } else {
                container.classList.remove('is-enabled');
            }
            
            if (isDisabled) {
                container.classList.add('is-disabled');
            } else {
                container.classList.remove('is-disabled');
            }
        }
        
        // Handle the parent container - make sure it shows correct visual state
        const settingItem = toggleEl.closest('.setting-item');
        if (settingItem && isDisabled) {
            settingItem.classList.add('setting-disabled');
        } else if (settingItem) {
            settingItem.classList.remove('setting-disabled');
        }
    }

    /**
     * Refreshes the UI of the inconsistent files list for a specific property.
     */
    private refreshInconsistentFilesUI(propertyItemEl: Element, propertyKey: string) {
        const inconsistentFilesContainer = propertyItemEl.querySelector('.inconsistent-files-container') as HTMLElement | null;
        if (!inconsistentFilesContainer) return;

        // Remove the "exclude all active" lock class
        inconsistentFilesContainer.classList.remove('is-exclude-all-active');

        // Reset filter/order dropdowns to their defaults
        const orderBySelect = inconsistentFilesContainer.querySelector('.inconsistent-order-by') as HTMLSelectElement | null;
        const filterBySelect = inconsistentFilesContainer.querySelector('.inconsistent-filter-by') as HTMLSelectElement | null;
        if (orderBySelect) orderBySelect.value = 'name-asc';
        if (filterBySelect) filterBySelect.value = 'all';

        // Re-apply the default ordering/filtering on the file list
        const inconsistentFilesList = inconsistentFilesContainer.querySelector('.inconsistent-files-list') as HTMLElement | null;
        if (inconsistentFilesList) {
            this.reorderInconsistentFiles(propertyKey, inconsistentFilesList, 'name-asc', 'all');
        }

        // Reset "Exclude All" toggle
        const excludeAllCheckbox = inconsistentFilesContainer.querySelector('.inconsistent-files-controls input[type="checkbox"]') as HTMLInputElement | null;
        if (excludeAllCheckbox) this.setCheckboxVisualState(excludeAllCheckbox, false);

        // Reset individual file items
        const fileItems = inconsistentFilesContainer.querySelectorAll('.inconsistent-file-item');
        fileItems.forEach(item => {
            const fileItem = item as HTMLElement;

            // Remove excluded state
            fileItem.classList.remove('is-excluded');

            // Reset the exclude toggle in the file header
            const excludeCheckbox = fileItem.querySelector('.bulk-editor-file-header input[type="checkbox"]') as HTMLInputElement | null;
            if (excludeCheckbox) this.setCheckboxVisualState(excludeCheckbox, false);

            // Re-enable all file-content setting items, then restore initial disabled states
            this.updateInternalTogglesState(fileItem, false);

            // "Use Defined Property Value" must stay disabled when "Add Missing" defaults to OFF
            if (fileItem.hasAttribute('data-inconsistency-missing')) {
                const useValueSettingItem = fileItem.querySelector('.setting-item[data-action-key="useValueOnAdd"]') as HTMLElement | null;
                if (useValueSettingItem) this.setUseValueToggleEnabled(useValueSettingItem, false);
            }

            // Reset the checked state of all action toggles to OFF
            const actionCheckboxes = fileItem.querySelectorAll('.file-item-content input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
            actionCheckboxes.forEach(cb => this.setCheckboxVisualState(cb, false));

            // Restore file header appearance to its default (warning) state
            this.updateFileHeaderAppearance(fileItem, propertyKey);
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
                element.show();
            } else if (filterBy === 'value') {
                if (element.hasAttribute('data-inconsistency-value')) {
                    element.show();
                } else {
                    element.hide();
                }
            } else if (filterBy === 'missing') {
                if (element.hasAttribute('data-inconsistency-missing')) {
                    element.show();
                } else {
                    element.hide();
                }
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
            
            container.createEl('p', { 
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

            // Helper function for name comparison as fallback
            const compareByName = (order: 'asc' | 'desc' = 'asc') => {
                return order === 'asc' ? pathA.localeCompare(pathB) : pathB.localeCompare(pathA);
            };

            // Get inconsistency flags
            const aHasValueMismatch = a.hasAttribute('data-inconsistency-value');
            const bHasValueMismatch = b.hasAttribute('data-inconsistency-value');
            const aIsMissing = a.hasAttribute('data-inconsistency-missing');
            const bIsMissing = b.hasAttribute('data-inconsistency-missing');

            if (orderBy === 'value-mismatch') {
                // Prioritize value mismatches
                if (aHasValueMismatch && !bHasValueMismatch) return -1;
                if (!aHasValueMismatch && bHasValueMismatch) return 1;
                return compareByName('asc');
            } else if (orderBy === 'missing-first') {
                // Prioritize missing properties
                if (aIsMissing && !bIsMissing) return -1;
                if (!aIsMissing && bIsMissing) return 1;
                return compareByName('asc');
            } else if (orderBy === 'name-desc') {
                return compareByName('desc');
            } else { // Default to 'name-asc'
                return compareByName('asc');
            }
        });
        
        // Reattach items in the new order
        visibleItems.forEach(item => {
            container.appendChild(item);
        });
        const inconsistentFilesContainer = container.closest('.inconsistent-files-container') as HTMLElement;
        // Update the missing files counter based on the current view
        this.updateMissingFilesCounter(propertyKey, container.closest('.inconsistent-files-container') as HTMLElement);

        this.updateInconsistentValuesCounter(propertyKey, inconsistentFilesContainer);

        // Update toggle visibility based on missing properties
        this.updateMissingPropertyTogglesVisibility(propertyKey, inconsistentFilesContainer);
    }

    /**
     * Updates the missing files counter for a property
     */
    private updateMissingFilesCounter(propertyKey: string, container: HTMLElement) {
        // Find the counter container
        const missingFilesCounter = container.querySelector('.setting-item:nth-child(2) .property-header-stat-row');
        if (!missingFilesCounter) return;
        
        // Clear existing content
        missingFilesCounter.empty();
        
        // Get files with inconsistencies
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        
        // Count files missing this property
        const missingFilesCount = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            return !properties || !(propertyKey in properties);
        }).length;

        // Check if there are any files missing this property
        const hasMissingPropertyFiles = missingFilesCount > 0;
        
        // Add the appropriate icon and text based on count
        if (missingFilesCount > 0) {
            missingFilesCounter.createSpan({
                cls: "property-header-stat-icon is-inconsistent",
                text: "⚠"
            });
            missingFilesCounter.createSpan({
                text: ` ${missingFilesCount} ${missingFilesCount === 1 ? 'file is' : 'files are'} missing this property`,
                cls: "missing-files-text is-inconsistent"
            });
        } else {
            missingFilesCounter.createSpan({
                cls: "property-header-stat-icon is-consistent",
                text: "✓"
            });
            missingFilesCounter.createSpan({
                text: " No files are missing this property",
                cls: "missing-files-text is-consistent"
            });
        }

        // After updating the counter, also update toggle visibility
        this.updateMissingPropertyTogglesVisibility(propertyKey, container);
    }

    /**
     * Updates the inconsistent values counter for a property
     */
    private updateInconsistentValuesCounter(propertyKey: string, container: HTMLElement) {
        // Find the counter container - this is in the third setting item (Overwrite All Values)
        const inconsistentValuesCounter = container.querySelector('.setting-item:nth-child(4) .property-header-stat-row');
        if (!inconsistentValuesCounter) return;
        
        // Clear existing content
        inconsistentValuesCounter.empty();
        
        // Get files with inconsistencies
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        
        // Count files with inconsistent values
        const filesWithInconsistentValues = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            // File has the property but the value is inconsistent (not the most common value)
            if (properties && propertyKey in properties) {
                const fileValue = properties[propertyKey].value;
                const stats = this.propertyConsistency.get(propertyKey);
                if (stats && stats.value.mostCommonValue !== null) {
                    // Compare values - if different, it's inconsistent
                    return JSON.stringify(fileValue) !== JSON.stringify(stats.value.mostCommonValue);
                }
            }
            return false;
        }).length;
        
        // Add the appropriate icon and text based on count
        if (filesWithInconsistentValues > 0) {
            inconsistentValuesCounter.createSpan({
                cls: "property-header-stat-icon is-inconsistent",
                text: "⚠"
            });
            inconsistentValuesCounter.createSpan({
                text: ` ${filesWithInconsistentValues} ${filesWithInconsistentValues === 1 ? 'file has' : 'files have'} inconsistent value`,
                cls: "missing-files-text is-inconsistent"
            });
        } else {
            inconsistentValuesCounter.createSpan({
                cls: "property-header-stat-icon is-consistent",
                text: "✓"
            });
            inconsistentValuesCounter.createSpan({
                text: " No files have inconsistent value",
                cls: "missing-files-text is-consistent"
            });
        }
        
        // Find and update the toggle visibility
        const overwriteAllToggleControl = container.querySelector('.setting-item:nth-child(4) .setting-item-control');
        if (overwriteAllToggleControl instanceof HTMLElement) {
            if (filesWithInconsistentValues > 0) {
                overwriteAllToggleControl.show();
            } else {
                overwriteAllToggleControl.hide();
            }
        }
    }

    /**
     * Updates visibility of missing-property related toggles based on whether any files are missing the property
     */
    private updateMissingPropertyTogglesVisibility(propertyKey: string, container: HTMLElement) {
        // Get files with inconsistencies
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        
        // Count files missing this property
        const hasMissingPropertyFiles = inconsistentFiles.some(file => {
            const properties = this.fileProperties.get(file.path);
            return !properties || !(propertyKey in properties);
        });
        
        // Check if there are any inconsistent files at all
        const hasInconsistentFiles = inconsistentFiles.length > 0;
        
        // Find the elements
        const excludeAllSetting = container.querySelector('.setting-item:nth-child(1)');
        const addAllMissingSetting = container.querySelector('.setting-item:nth-child(2)');
        const addAllMissingToggleControl = addAllMissingSetting ? addAllMissingSetting.querySelector('.setting-item-control') : null;
        const applyValueSetting = container.querySelector('.setting-item:nth-child(3)');
        const inconsistentFilesList = container.querySelector('.inconsistent-files-list');
        
        // Update visibility - for Add All Missing, just hide the toggle control
        if (addAllMissingToggleControl instanceof HTMLElement) {
            if (hasMissingPropertyFiles) {
                addAllMissingToggleControl.show();
            } else {
                addAllMissingToggleControl.hide();
            }
        }

        // For Apply Value, hide the entire setting
        if (applyValueSetting instanceof HTMLElement) {
            if (hasMissingPropertyFiles) {
                applyValueSetting.show();
            } else {
                applyValueSetting.hide();
            }
        }

        // For Exclude All, hide the entire setting if no inconsistent files
        if (excludeAllSetting instanceof HTMLElement) {
            if (hasInconsistentFiles) {
                excludeAllSetting.show();
            } else {
                excludeAllSetting.hide();
            }

            // Handle Add All Missing Properties top border based on Exclude All visibility
            if (addAllMissingSetting instanceof HTMLElement) {
                if (!hasInconsistentFiles) {
                    addAllMissingSetting.addClass('no-top-border-padded');
                } else {
                    addAllMissingSetting.removeClass('no-top-border-padded');
                }
            }
        }

        // Hide the inconsistent files list container if empty
        if (inconsistentFilesList instanceof HTMLElement) {
            if (hasInconsistentFiles) {
                inconsistentFilesList.show();
            } else {
                inconsistentFilesList.hide();
            }
        }
    }

    // =================================================================
    // SECTION: Drag and Drop for Property Ordering
    // =================================================================

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
            const htmlHandle = handle as HTMLElement; 
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

    // =================================================================
    // SECTION: Utility Methods
    // =================================================================

    /**
     * Simple confirmation dialog.
     */
    private async confirmRevert(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const confirmModal = new Modal(this.app);
            confirmModal.contentEl.addClass("confirm-modal");
            confirmModal.contentEl.createEl("p", { text: message });

            const buttonContainer = confirmModal.contentEl.createDiv("modal-button-container");

            const cancelBtn = buttonContainer.createEl("button", { text: "Cancel", cls: "mod-cancel" });
            this.plugin.registerDomEvent(cancelBtn, "click", () => {
                confirmModal.close();
                resolve(false);
            });

            const revertBtn = buttonContainer.createEl("button", { text: "Revert", cls: "mod-warning" });
            this.plugin.registerDomEvent(revertBtn, "click", () => {
                confirmModal.close();
                resolve(true);
            });

            confirmModal.open();
        });
    }
    
    /**
     * Returns the appropriate placeholder text based on property type.
     */
    private getPlaceholderForType(type: string): string {
        switch (type) {
            case 'text':
            case 'list':
            case 'number':
                return 'Empty';
            case 'date':
                return 'YYYY-MM-DD';
            case 'datetime':
                return 'YYYY-MM-DD HH:MM';
            case 'checkbox':
                return '';
            default:
                return `Enter ${type} value...`;
        }
    }

    /**
     * Validates if a given string value is compatible with the target property type.
     */
    private validateInputValue(value: string | null, type: string): boolean {
        if (value === null) return true;
        const trimmedValue = value.trim();

        // Allow empty input as valid (user might be deleting)
        if (trimmedValue === '') {
            return true;
        }

        switch (type) {
            case 'number':
                return !isNaN(Number(trimmedValue)) && trimmedValue !== '';
            case 'date':
                if (window.moment) {
                    return window.moment(trimmedValue, 'YYYY-MM-DD', true).isValid();
                } else {
                    return /^\d{4}-\d{2}-\d{2}$/.test(trimmedValue);
                }
            case 'datetime':
                if (window.moment) {
                    return window.moment(trimmedValue, 'YYYY-MM-DD HH:mm', true).isValid() ||
                           window.moment(trimmedValue, moment.ISO_8601, true).isValid();
                } else {
                    return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(trimmedValue);
                }
            case 'text':
            case 'list':
            case 'checkbox':
            default:
                return true;
        }
    }
    
    /**
     * Processes text content in the editor to identify and make links clickable.
     */
    private processLinksInEditor(element: HTMLElement, type: string): void {
        // Skip if this is not a link-compatible type, or if content has multiple lines
        if ((type !== 'text' && type !== 'list') || 
            (element.textContent && element.textContent.includes('\n'))) {
            return;
        }
        
        // Get the current content
        const currentContent = element.textContent || '';
        
        // Process based on type
        if (type === 'text') {
            // For text fields, ONLY make the entire content clickable if it's a valid URL
            if (this.isValidUrl(currentContent)) {
                // Only modify the DOM if needed
                if (!element.querySelector('.metadata-link') || 
                    element.querySelector('.metadata-link')?.textContent !== currentContent) {
                    
                    // Clear the element
                    element.empty();
                    
                    // Create a clickable link element
                    const linkElement = this.createClickableLinkElement(currentContent);
                    element.appendChild(linkElement);
                }
            } else {
                // If it's not a valid URL anymore, convert any link spans back to plain text
                const linkSpans = element.querySelectorAll('.metadata-link');
                if (linkSpans.length > 0) {
                    linkSpans.forEach(span => {
                        const textNode = document.createTextNode(span.textContent || '');
                        span.parentNode?.replaceChild(textNode, span);
                    });
                }
            }
        }
    }

    /**
     * Checks if a string is a valid URL with a stricter validation
     */
    private isValidUrl(text: string): boolean {
        const urlRegex = /^(https?:\/\/)(www\.)?([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+)(\/[^\s]*)?$/;
        return urlRegex.test(text);
    }
    
    /**
     * Creates a clickable link element for the editor
     */
    private createClickableLinkElement(link: string): HTMLElement {
        const linkElement = createEl('span', { cls: 'metadata-link', text: link });
        
        // Add click handler
        this.plugin.registerDomEvent(linkElement, 'click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            handleLinkClick(this.app, link, e);
        });
        
        return linkElement;
    }

    /**
     * Counts the actual visual lines in a contenteditable element.
     */
    private countVisualLines(element: HTMLElement): number {
        // Get the computed line height
        const computedStyle = window.getComputedStyle(element);
        let lineHeight = parseInt(computedStyle.lineHeight);
        if (isNaN(lineHeight)) {
            const fontSize = parseInt(computedStyle.fontSize);
            lineHeight = Math.round(fontSize * 1.5);
        }
        
        // Create a clone to measure without affecting the original
        const clone = element.cloneNode(true) as HTMLElement;
        clone.addClass('yaml-pm-measurement-clone');
        clone.setCssProps({ '--yaml-pm-clone-width': element.offsetWidth + 'px' });
        this.modalEl.appendChild(clone);

        const contentHeight = clone.scrollHeight;
        this.modalEl.removeChild(clone);
        
        // Get padding
        const paddingTop = parseInt(computedStyle.paddingTop) || 0;
        const paddingBottom = parseInt(computedStyle.paddingBottom) || 0;
        
        // Calculate the actual content height without padding
        const textHeight = contentHeight - paddingTop - paddingBottom;
        
        // Estimate the number of lines
        const lines = Math.max(1, Math.round(textHeight / lineHeight));
        
        return lines;
    }

    /**
     * Automatically adjusts the height of a contenteditable div based on its content.
     */
    private autoResizeEditableDiv(element: HTMLElement): void {
        // Prevent resizing logic for list editor containers
        if (element.classList.contains('list-editor-container')) {
            return;
        }
    
        // Use the new method to count visual lines
        const lineCount = this.countVisualLines(element);
        
        // Get current focus state
        const isFocused = document.activeElement === element;
        
        // Remove all sizing classes first
        element.classList.remove('editor-lines-1', 'editor-lines-2', 'editor-lines-3', 'editor-lines-many');
        
        // Add focus class if focused
        element.classList.toggle('editor-focused', isFocused);
        
        // Add appropriate line count class
        if (lineCount <= 3) {
            element.classList.add(`editor-lines-${lineCount}`);
        } else {
            element.classList.add('editor-lines-many');
        }
    }

    /**
     * Creates an array value display with expand/collapse functionality
     */
    private createArrayValueDisplay(container: HTMLElement, arrayValue: YamlPropertyValue[], propertyType: string | null) {
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
     * Applies property value toggles to all files with missing properties
     */
    private applyPropertyValueToggles(propertyKey: string, checked: boolean): void {
        const state = this.propertiesState.get(propertyKey);
        if (!state) return;
        
        // Get files with inconsistencies
        const inconsistentFiles = this.getInconsistentFiles(propertyKey);
        
        // Filter to get only files with missing properties where "Add Missing" is enabled
        const targetFiles = inconsistentFiles.filter(file => {
            const properties = this.fileProperties.get(file.path);
            if (properties && (propertyKey in properties)) return false; // Skip existing properties
            
            // Skip excluded files
            if (state.excludedFiles.has(file.path)) return false;
            
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            return fileActions.add; // Only include files where "Add Missing" is enabled
        });
        
        // Get relevant container
        const inconsistentFilesContainer = this.propertiesListContainer?.querySelector(`#prop-${propertyKey} .inconsistent-files-container`);
        if (!inconsistentFilesContainer) return;
        
        // Update each file
        targetFiles.forEach(file => {
            // Update data model
            const fileActions = state.fileActions.get(file.path) || { type: false, value: false, add: false };
            fileActions.value = checked;
            state.fileActions.set(file.path, fileActions);
            
            // Find this file's toggle in the DOM
            const fileItem = inconsistentFilesContainer.querySelector(`.inconsistent-file-item[data-path="${file.path}"]`);
            if (!fileItem) return;
            
            // Update header appearance
            this.updateFileHeaderAppearance(fileItem as HTMLElement, propertyKey);
        });
        
        // Update property and value counters in the property header
        this.updatePropertyCountersUI(propertyKey);
    }

    /**
     * Disables or enables a setting item and all its toggles
     */
    private updateSettingItemState(settingItem: Element | null, disabled: boolean): void {
        if (!settingItem) return;
        
        if (disabled) {
            settingItem.addClass('setting-disabled');
            
            // Disable any checkbox inputs within the setting
            const toggleInputs = settingItem.querySelectorAll('input[type="checkbox"]');
            toggleInputs.forEach(input => {
                if (input instanceof HTMLInputElement) {
                    input.disabled = true;
                }
            });
        } else {
            settingItem.removeClass('setting-disabled');
            
            // Enable any checkbox inputs within the setting
            const toggleInputs = settingItem.querySelectorAll('input[type="checkbox"]');
            toggleInputs.forEach(input => {
                if (input instanceof HTMLInputElement) {
                    input.disabled = false;
                }
            });
        }
    }

    // =================================================================
    // SECTION: Apply Changes and Action Handlers
    // =================================================================

    /**
     * Applies changes to all selected files
     */
    private async applyChanges() {
        // Show progress notice
        const notice = new Notice('Applying changes to files...', 0);
        
        try {
            let successCount = 0;
            
            // Process each file
            for (const file of this.files) {
                try {
                    // Get existing properties
                    const existingProperties = this.plugin.parseFileProperties(file);

                    // Start with a fresh object to control property order
                    const newProperties: Record<string, YamlPropertyValue> = {};
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
            
            // Close the modal and return to main menu
            this.close();
            new PropertyManagerMenu(this.app, this.plugin).open();
        } catch (error) {
            console.error('Error applying changes:', error);
            notice.hide();
            new Notice('Error applying changes. Please try again.');
        }
    }
}