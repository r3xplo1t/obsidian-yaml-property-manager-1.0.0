import { App, Modal, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
// Import from specific files to avoid circular dependencies
import type { PropertyWithType } from '../PropertyTypeService';
import type { TemplateNode } from '../interfaces';
import { formatValuePreview } from '../propertyFormatters';

interface PropertyStats {
    count: number;
    typeConsistency: {
        count: number;
        mostCommonType: string;
    };
    valueConsistency: {
        count: number;
        mostCommonValue: any;
    };
    files: Array<{
        path: string;
        name: string;
        type: string;
        value: any;
        propertyWithType?: PropertyWithType;
        hasDifference: boolean;
    }>;
}

export class BulkPropertyEditorModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty(); // Make sure we clear any existing content
        contentEl.addClass('yaml-window__bulk-editor');
        
        // Add title header
        contentEl.createEl('h2', { 
            text: 'List of Properties',
            cls: 'yaml-property-header'
        });

        // Properties container
        const propertyContainer = contentEl.createDiv({ cls: 'yaml-property-container' });
        
        // Add a loading indicator
        const loadingEl = propertyContainer.createEl('p', { 
            text: 'Loading properties...',
            cls: 'yaml-loading-message' 
        });

        try {
            // Load properties from selected files
            await this.loadSelectedFilesProperties(propertyContainer);
            
            // Remove loading indicator
            loadingEl.remove();
        } catch (error) {
            console.error('Error loading properties:', error);
            
            // Update loading indicator to show error
            loadingEl.setText('Error loading properties. Check console for details.');
            loadingEl.addClass('yaml-error-message');
        }

        // Buttons container attached directly to modal
        const buttonContainer = this.modalEl.createDiv({ cls: 'modal-button-container' });

        // Apply button
        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Changes',
            cls: 'mod-cta'
        });
        
        applyButton.disabled = true;

        applyButton.addEventListener('click', async () => {
            // This will be implemented in a future feature
            // For now, just close the modal
            this.close();
        });

        // Close button
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });

        cancelButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
    }

    async loadSelectedFilesProperties(container: HTMLElement) {
        console.log(`Attempting to load properties from ${this.files.length} selected files`);
        
        // Set to keep track of unique property names
        const propertySet = new Set<string>();
        
        // Map to store property statistics
        const propertyStats = new Map<string, PropertyStats>();
        
        // Process each selected file
        for (const file of this.files) {
            try {
                console.log(`Processing file: ${file.path}`);
                
                // Parse properties from file
                const properties = await this.plugin.parseFileProperties(file);
                
                // Get properties with type information
                const propertiesWithType = this.plugin.propertyCache.get(file.path) || 
                this.plugin.propertyTypeService.preservePropertyTypes(properties);
                
                console.log(`Properties found in ${file.path}:`, properties);
                
                // Add property names to the set and collect statistics
                Object.entries(properties).forEach(([propName, propValue]) => {
                    // Only process non-empty property names
                    if (propName.trim() === '') {
                        return;
                    }
                    
                    propertySet.add(propName);
                    
                    // Initialize property stats if not exists
                    if (!propertyStats.has(propName)) {
                        propertyStats.set(propName, {
                            count: 0,
                            typeConsistency: {
                                count: 0,
                                mostCommonType: ''
                            },
                            valueConsistency: {
                                count: 0,
                                mostCommonValue: null
                            },
                            files: []
                        });
                    }
                    
                    const stats = propertyStats.get(propName)!;
                    stats.count++;
                    
                    // Get the property type
                    const obsidianType = this.plugin.propertyTypeService.getValuePropertyType(propName, propValue);
                    const internalType = this.plugin.getInternalPropertyType(propName, propValue);

                    // Add file info
                    stats.files.push({
                        path: file.path,
                        name: file.name,
                        type: internalType,  // Use the internal type we just calculated
                        value: propValue,
                        propertyWithType: propertiesWithType[propName],
                        hasDifference: false // Will be determined later
                    });
                });
            } catch (error) {
                console.error(`Error parsing properties for ${file.path}:`, error);
            }
        }
        
        // Calculate consistency statistics for each property
        for (const [propName, stats] of propertyStats.entries()) {
            // Find most common type
            const typeCount = new Map<string, number>();
            stats.files.forEach(file => {
                const count = typeCount.get(file.type) || 0;
                typeCount.set(file.type, count + 1);
            });
            
            let mostCommonType = '';
            let maxTypeCount = 0;
            
            for (const [type, count] of typeCount.entries()) {
                if (count > maxTypeCount) {
                    mostCommonType = type;
                    maxTypeCount = count;
                }
            }
            
            stats.typeConsistency.mostCommonType = mostCommonType;
            stats.typeConsistency.count = maxTypeCount;
            
            // Find most common value (convert to string for comparison)
            const valueCount = new Map<string, { count: number, value: any }>();
            stats.files.forEach(file => {
                const valueStr = JSON.stringify(file.value);
                const entry = valueCount.get(valueStr) || { count: 0, value: file.value };
                entry.count++;
                valueCount.set(valueStr, entry);
            });
            
            let mostCommonValueStr = '';
            let maxValueCount = 0;
            
            for (const [valueStr, entry] of valueCount.entries()) {
                if (entry.count > maxValueCount) {
                    mostCommonValueStr = valueStr;
                    maxValueCount = entry.count;
                    stats.valueConsistency.mostCommonValue = entry.value;
                }
            }
            
            stats.valueConsistency.count = maxValueCount;
            
            // Mark files with differences
            stats.files.forEach(file => {
                if (file.type !== mostCommonType || 
                    JSON.stringify(file.value) !== mostCommonValueStr) {
                    file.hasDifference = true;
                }
            });
        }
        
        console.log(`Total unique properties found: ${propertySet.size}`);
        console.log(`Property names:`, Array.from(propertySet));
        
        // Track if we've added any property items
        let itemsAdded = 0;
        
        // Create a property item for each unique property
        for (const propName of propertySet) {
            // Skip empty property names
            if (propName.trim() === '') {
                continue;
            }
            
            console.log(`Creating property item for: ${propName}`);
            
            // Create property item
            const propertyItem = container.createDiv({ cls: 'yaml-property' });
            
            // Create property header
            const propertyHeader = propertyItem.createDiv({ cls: 'yaml-property-header' });
            
            // Add property name
            propertyHeader.createEl('span', { 
                text: propName, 
                cls: 'yaml-property-name' 
            });
            
            // Get property stats
            const stats = propertyStats.get(propName);
            
            // Detect property type - first get sample value from first file that has this property
            let sampleValue = null;
            for (const file of this.files) {
                try {
                    const props = await this.plugin.parseFileProperties(file);
                    if (props[propName] !== undefined) {
                        sampleValue = props[propName];
                        break;
                    }
                } catch (error) {
                    console.error(`Error getting sample value for ${propName} from ${file.path}:`, error);
                }
            }
            
            // Add property type container
            const propertyType = propertyItem.createDiv({ cls: 'yaml-property-type' });
            
            // Get type using the new helper method
            const internalType = this.plugin.getInternalPropertyType(propName, sampleValue);
            const typeDisplayName = this.plugin.propertyTypeService.getPropertyTypeDisplayName(internalType);
            
            propertyType.createEl('span', { 
                text: `Type: ${typeDisplayName}`, 
                cls: 'yaml-property-type-text' 
            });
            
            // Add property value container
            const propertyValue = propertyItem.createDiv({ cls: 'yaml-property-value' });
    
            // Check if value is empty
            const isEmpty = sampleValue === null || sampleValue === undefined || sampleValue === '' || 
                        (typeof sampleValue === 'object' && Object.keys(sampleValue).length === 0);
    
            if (isEmpty) {
                // Display "No value" text for empty values
                propertyValue.createEl('span', { 
                    text: 'No value', 
                    cls: 'yaml-property-empty-value' 
                });
            } else if (Array.isArray(sampleValue)) {
                // For arrays, show simple count
                propertyValue.createEl('span', { 
                    text: `Array (${sampleValue.length} ${sampleValue.length === 1 ? 'item' : 'items'})`, 
                    cls: 'yaml-property-value-text' 
                });
            } else {
                // For other values, show formatted preview
                propertyValue.createEl('span', { 
                    text: formatValuePreview(sampleValue), 
                    cls: 'yaml-property-value-text' 
                });
            }
            
            // Add statistics container
            if (stats) {
                const statsContainer = propertyItem.createDiv({ cls: 'yaml-property-stats' });
                
                // Occurrence statistics
                const occurrenceItem = statsContainer.createDiv({ cls: 'yaml-property-stat-item' });
                occurrenceItem.createEl('span', {
                    text: 'Occurrence: ',
                    cls: 'yaml-property-stat-label'
                });
                occurrenceItem.createEl('span', {
                    text: `${stats.count}/${this.files.length} files`,
                    cls: 'yaml-property-stat-value'
                });
                if (stats.count < this.files.length) {
                    occurrenceItem.createEl('span', {
                        text: '⚠️',
                        cls: 'yaml-property-stat-warning',
                        attr: { title: 'This property is missing in some files' }
                    });
                }
                
                // Type consistency statistics
                const typeItem = statsContainer.createDiv({ cls: 'yaml-property-stat-item' });
                typeItem.createEl('span', {
                    text: 'Type Consistency: ',
                    cls: 'yaml-property-stat-label'
                });
                typeItem.createEl('span', {
                    text: `${stats.typeConsistency.count}/${stats.count} files`,
                    cls: 'yaml-property-stat-value'
                });
                if (stats.typeConsistency.count < stats.count) {
                    typeItem.createEl('span', {
                        text: '⚠️',
                        cls: 'yaml-property-stat-warning',
                        attr: { title: 'Property types differ across files' }
                    });
                }
                
                // Value consistency statistics
                const valueItem = statsContainer.createDiv({ cls: 'yaml-property-stat-item' });
                valueItem.createEl('span', {
                    text: 'Value Consistency: ',
                    cls: 'yaml-property-stat-label'
                });
                valueItem.createEl('span', {
                    text: `${stats.valueConsistency.count}/${stats.count} files`,
                    cls: 'yaml-property-stat-value'
                });
                if (stats.valueConsistency.count < stats.count) {
                    valueItem.createEl('span', {
                        text: '⚠️',
                        cls: 'yaml-property-stat-warning',
                        attr: { title: 'Property values differ across files' }
                    });
                }
                
                // Add toggle button if there are inconsistencies OR if property doesn't exist in all files
                if (stats.typeConsistency.count < stats.count || 
                    stats.valueConsistency.count < stats.count || 
                    stats.count < this.files.length) {
                    
                    const toggleButton = statsContainer.createEl('button', {
                        cls: 'yaml-property-files-toggle',
                        text: '▼'
                    });
                    
                    // Create files container (collapsed by default)
                    const filesContainer = propertyItem.createDiv({ 
                        cls: 'yaml-property-files yaml-property-files--collapsed' 
                    });

                    // Create filter bar container
                    const filterBar = filesContainer.createDiv({ 
                        cls: 'yaml-property-files-filter-bar' 
                    });

                    // Add filter explanation text
                    filterBar.createEl('span', {
                        text: 'Filter by:',
                        cls: 'yaml-property-files-filter-label'
                    });

                    // Create filter button container
                    const filterButtonContainer = filterBar.createDiv({
                        cls: 'yaml-property-files-filter-buttons'
                    });

                    // Add filter toggle buttons with the correct order
                    const allButton = filterButtonContainer.createEl('button', {
                        text: 'All',
                        cls: 'yaml-property-files-filter-button yaml-property-files-filter-button--active',
                        attr: {
                            'data-filter': 'all',
                            'title': 'Show all files'
                        }
                    });

                    const missingButton = filterButtonContainer.createEl('button', {
                        text: 'Missing',
                        cls: 'yaml-property-files-filter-button',
                        attr: {
                            'data-filter': 'missing',
                            'title': 'Show files missing this property'
                        }
                    });

                    const differentTypeButton = filterButtonContainer.createEl('button', {
                        text: 'Different Types',
                        cls: 'yaml-property-files-filter-button',
                        attr: {
                            'data-filter': 'different-type',
                            'title': 'Show files with different property types'
                        }
                    });

                    const differentValueButton = filterButtonContainer.createEl('button', {
                        text: 'Different Values',
                        cls: 'yaml-property-files-filter-button',
                        attr: {
                            'data-filter': 'different-value',
                            'title': 'Show files with different property values'
                        }
                    });

                    // Store active filters
                    const activeFilters = new Set(['all']);

                    // Helper function to update file visibility based on active filters
                    const updateFileVisibility = () => {
                        // Get all file items
                        const fileItems = filesContainer.querySelectorAll('.yaml-property-file');
                        
                        // If "All" is active, show all files
                        if (activeFilters.has('all')) {
                            fileItems.forEach((fileItem: HTMLElement) => {
                                fileItem.style.display = '';
                            });
                            return;
                        }
                        
                        // Otherwise, filter files based on active filters
                        fileItems.forEach((fileItem: HTMLElement) => {
                            // Hide by default, then show if it matches any active filter
                            fileItem.style.display = 'none';
                            
                            // Check each active filter
                            if ((activeFilters.has('different-type') && fileItem.hasClass('yaml-property-file--different-type')) ||
                                (activeFilters.has('different-value') && fileItem.hasClass('yaml-property-file--different-value')) ||
                                (activeFilters.has('missing') && fileItem.hasClass('yaml-property-file--missing'))) {
                                fileItem.style.display = '';
                            }
                        });
                    };

                    // "All" button click handler
                    allButton.addEventListener('click', () => {
                        // Clear all filters and set only "All"
                        activeFilters.clear();
                        activeFilters.add('all');
                        
                        // Update button states
                        allButton.addClass('yaml-property-files-filter-button--active');
                        differentTypeButton.removeClass('yaml-property-files-filter-button--active');
                        differentValueButton.removeClass('yaml-property-files-filter-button--active');
                        missingButton.removeClass('yaml-property-files-filter-button--active');
                        
                        // Update file visibility
                        updateFileVisibility();
                    });

                    // Helper function for filter button click handling
                    const handleFilterButtonClick = (button: HTMLElement, filter: string) => {
                        // If "All" is active, deactivate it
                        if (activeFilters.has('all')) {
                            activeFilters.delete('all');
                            allButton.removeClass('yaml-property-files-filter-button--active');
                        }
                        
                        // Toggle this filter
                        if (activeFilters.has(filter)) {
                            activeFilters.delete(filter);
                            button.removeClass('yaml-property-files-filter-button--active');
                            
                            // If no filters active, activate "All"
                            if (activeFilters.size === 0) {
                                activeFilters.add('all');
                                allButton.addClass('yaml-property-files-filter-button--active');
                            }
                        } else {
                            activeFilters.add(filter);
                            button.addClass('yaml-property-files-filter-button--active');
                        }
                        
                        // Update file visibility
                        updateFileVisibility();
                    };

                    // Other filter buttons click handlers
                    differentTypeButton.addEventListener('click', () => {
                        handleFilterButtonClick(differentTypeButton, 'different-type');
                    });

                    differentValueButton.addEventListener('click', () => {
                        handleFilterButtonClick(differentValueButton, 'different-value');
                    });

                    missingButton.addEventListener('click', () => {
                        handleFilterButtonClick(missingButton, 'missing');
                    });
                    
                    // Determine which files to show
                    interface FileDisplayInfo {
                        path: string;
                        name: string;
                        type?: string;
                        value?: any;
                        propertyWithType?: PropertyWithType;
                        hasDifference?: boolean;
                        isMissing?: boolean;
                        file?: TFile; // Make this optional since it's not present in all objects
                    }
                    
                    let filesToShow: FileDisplayInfo[] = [];
                    // Create a set of paths that have the property for quick lookup
                    const propertyFilePaths = new Set(stats.files.map(file => file.path));

                    // 1. If there are inconsistencies, add files with differences
                    if (stats.typeConsistency.count < stats.count || 
                        stats.valueConsistency.count < stats.count) {
                        // Add files with type or value differences
                        const filesWithDifferences = stats.files.filter(file => file.hasDifference);
                        filesToShow = [...filesWithDifferences];
                    } 

                    // 2. If property doesn't exist in all files, add files that are MISSING the property
                    if (stats.count < this.files.length) {
                        // Get files that don't have this property
                        const missingFiles = this.files
                            .filter(file => !propertyFilePaths.has(file.path))
                            .map(file => ({
                                path: file.path,
                                name: file.name,
                                isMissing: true
                            }));
                        
                        // Add missing files to the list
                        filesToShow = [...filesToShow, ...missingFiles];
                    }

                    // If no files to show based on criteria above, show all files that have the property
                    if (filesToShow.length === 0) {
                        filesToShow = [...stats.files];
                    }
                    
                    // Add each file to the container
                    filesToShow.forEach(file => {
                        const fileItem = filesContainer.createDiv({ 
                            cls: file.isMissing ? 'yaml-property-file yaml-property-file--missing' : 'yaml-property-file' 
                        });
                        
                        // File header with name
                        const fileHeader = fileItem.createDiv({ cls: 'yaml-property-file-header' });
                        fileHeader.createEl('span', {
                            text: file.name,
                            cls: 'yaml-property-file-name'
                        });

                        // For files missing the property, show a message instead of type and value
                        if (file.isMissing) {
                            const missingMessage = fileItem.createDiv({ cls: 'yaml-property-missing-message' });
                            missingMessage.createEl('span', {
                                text: 'Property not found in this file.',
                                cls: 'yaml-property-missing-text'
                            });
                        } else {
                            // File type (highlight if different)
                            const isDifferentType = file.type !== stats.typeConsistency.mostCommonType;
                            if (isDifferentType) {
                                fileItem.addClass('yaml-property-file--different-type');
                            }
                            const fileTypeEl = fileItem.createDiv({
                                cls: 'yaml-property-file-type'
                            });
                            fileTypeEl.createEl('span', {
                                text: `Type: ${this.plugin.propertyTypeService.getPropertyTypeDisplayName(file.type ?? 'text')}`,
                                cls: 'yaml-property-type-text'
                            });
                            
                            // File value (highlight if different)
                            const isDifferentValue = JSON.stringify(file.value) !== 
                                JSON.stringify(stats.valueConsistency.mostCommonValue);

                            if (isDifferentValue) {
                                fileItem.addClass('yaml-property-file--different-value');
                            }

                            const fileValue = fileItem.createDiv({
                                cls: 'yaml-property-file-value'
                            });
                            
                            if (file.value === null || file.value === undefined || file.value === '' ||
                                (typeof file.value === 'object' && Object.keys(file.value).length === 0)) {
                                fileValue.createEl('span', {
                                    text: 'No value',
                                    cls: 'yaml-property-empty-value'
                                });
                            } else if (Array.isArray(file.value)) {
                                fileValue.createEl('span', {
                                    text: `Array (${file.value.length} ${file.value.length === 1 ? 'item' : 'items'})`,
                                    cls: 'yaml-property-value-text'
                                });
                            } else {
                                fileValue.createEl('span', {
                                    text: formatValuePreview(file.value),
                                    cls: 'yaml-property-value-text'
                                });
                            }
                        }
                    });
                    
                    // Toggle button event listener
                    toggleButton.addEventListener('click', () => {
                        const isCollapsed = filesContainer.hasClass('yaml-property-files--collapsed');
                        filesContainer.toggleClass('yaml-property-files--collapsed', !isCollapsed);
                        toggleButton.textContent = !isCollapsed ? '▼' : '▲';
                    });
                }
            }
            
            itemsAdded++;
        }
        
        // If no properties were added
        if (itemsAdded === 0) {
            console.log('No properties found or all were empty, showing message');
            container.createEl('p', {
                text: 'No properties found in the selected files.',
                cls: 'yaml-no-properties-message'
            });
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}