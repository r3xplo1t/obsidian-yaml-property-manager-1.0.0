import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { YAMLPropertyManagerSettings, DEFAULT_SETTINGS } from './src/models';
import { formatYamlValue } from './src/utils';
import {
    PropertyManagerModal,
    TemplateSelectionModal,
    BatchFileSelectorModal,
    BulkPropertyEditorModal,
    YAMLPropertyManagerSettingTab
} from './src/modals';
import { PropertyWithType, preservePropertyTypes, restorePropertyValues, detectPropertyType } from './src/utils/propertyTypes';
import { PropertyTypeService, ObsidianPropertyType } from './src/services/PropertyTypeService';

export default class YAMLPropertyManagerPlugin extends Plugin {
    settings: YAMLPropertyManagerSettings;
    selectedFiles: TFile[] = []; // Added central file selection storage
    propertyCache: Map<string, Record<string, PropertyWithType>> = new Map();
    propertyTypeService: PropertyTypeService;

    // Helper method to get internal type from a property value
    public getInternalPropertyType(propertyName: string, propertyValue: any): string {
        const obsidianType = this.propertyTypeService.getValuePropertyType(propertyName, propertyValue);
        return this.convertFromObsidianType(obsidianType);
    }

    async onload() {
        await this.loadSettings();
        
        // Initialize the Property Type Service
        this.propertyTypeService = new PropertyTypeService(this.app);

        // Add command to open the property manager
        this.addCommand({
            id: 'open-property-manager',
            name: 'Open Property Manager',
            callback: () => {
                new PropertyManagerModal(this.app, this).open();
            }
        });

        // Add command to apply template to current file
        this.addCommand({
            id: 'apply-template-to-current-file',
            name: 'Apply Template to Current File',
            checkCallback: (checking: boolean) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    if (!checking) {
                        new TemplateSelectionModal(this.app, this, [activeView.file]).open();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'apply-template-to-multiple-files',
            name: 'Apply Template to Multiple Files',
            callback: () => {
                // This likely opens a file selector and then the template modal
                const batchSelector = new BatchFileSelectorModal(this.app, (files) => {
                    if (files && files.length > 0) {
                        this.selectedFiles = [...files];
                        new TemplateSelectionModal(this.app, this, this.selectedFiles).open();
                    }
                });
                batchSelector.open();
            }
        });

        // Add settings tab
        this.addSettingTab(new YAMLPropertyManagerSettingTab(this.app, this));
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        
        // Migrate from old format if needed
        if (loadedData && 'defaultTemplateFilePath' in loadedData && 
            loadedData.defaultTemplateFilePath && 
            !('templatePaths' in loadedData)) {
            
            this.settings.templatePaths = [{
                type: 'file',
                path: loadedData.defaultTemplateFilePath,
                includeSubdirectories: false
            }];
            
            // Remove old property
            delete (this.settings as any).defaultTemplateFilePath;
            
            // Save migrated settings
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Add template to recent templates list
    addToRecentTemplates(templatePath: string) {
        // Implementation remains the same...
        // Your existing method here
    }

    // Get all template files based on configuration
    async getAllTemplateFiles(): Promise<TFile[]> {
        const templates: TFile[] = [];
        const processedPaths = new Set<string>(); // To avoid duplicates
        
        try {
            for (const templatePath of this.settings.templatePaths) {
                if (templatePath.type === 'file') {
                    // Handle individual file
                    const file = this.app.vault.getAbstractFileByPath(templatePath.path);
                    if (file instanceof TFile && file.extension === 'md' && !processedPaths.has(file.path)) {
                        templates.push(file);
                        processedPaths.add(file.path);
                    }
                } else {
                    // Handle directory
                    const folder = this.app.vault.getAbstractFileByPath(templatePath.path);
                    if (folder && folder instanceof TFolder) {
                        const filesInFolder = await this.getTemplateFilesFromFolder(
                            folder, 
                            templatePath.includeSubdirectories,
                            processedPaths
                        );
                        templates.push(...filesInFolder);
                    }
                }
            }
        } catch (error) {
            console.error("Error getting template files:", error);
            // Don't rethrow, just return what we have so far
        }
        
        return templates; // Ensure this return exists
    }

    // Recursively get template files from a folder
    async getTemplateFilesFromFolder(
        folder: TFolder, 
        includeSubfolders: boolean, 
        processedPaths: Set<string>
    ): Promise<TFile[]> {
        const templates: TFile[] = [];
        
        try {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md' && !processedPaths.has(child.path)) {
                    templates.push(child);
                    processedPaths.add(child.path);
                } else if (includeSubfolders && child instanceof TFolder) {
                    const subfolderTemplates = await this.getTemplateFilesFromFolder(
                        child, 
                        includeSubfolders,
                        processedPaths
                    );
                    templates.push(...subfolderTemplates);
                }
            }
        } catch (error) {
            console.error(`Error processing folder ${folder.path}:`, error);
            // Don't rethrow, just return what we have so far
        }
        
        return templates; // Ensure this return exists
    }

    // Property utility functions
    
    // Parse YAML frontmatter from a file
    async parseFileProperties(file: TFile): Promise<Record<string, any>> {
        try {
            const properties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
            
            // Create properties with types using BOTH Obsidian's types and our detection
            const propertiesWithTypes: Record<string, PropertyWithType> = {};
            
            for (const [key, value] of Object.entries(properties)) {
                // First try file-specific type from Obsidian
                let obsidianType = this.propertyTypeService.getFilePropertyType(file, key);
                
                // If not available, use our combined detection approach
                if (!obsidianType) {
                    obsidianType = this.propertyTypeService.getValuePropertyType(key, value);
                }
                
                // Convert to our internal type format
                const type = this.convertFromObsidianType(obsidianType);
                    
                propertiesWithTypes[key] = {
                    value, 
                    type,
                    originalString: typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '' ? 
                        value : undefined
                };
            }
            
            // Store the typed properties in the cache
            this.propertyCache.set(file.path, propertiesWithTypes);
            
            return properties;
        } catch (error) {
            console.error(`Error parsing properties for ${file.path}:`, error);
            return {};
        }
    }

    // Apply properties to a file
    async applyProperties(file: TFile, properties: Record<string, any>, preserveExisting: boolean = false) {
        try {
            // Implementation remains the same...
            // Your existing method here

            // For example:
            // Read the file content
            const content = await this.app.vault.read(file);
            
            // Check if file already has frontmatter
            const hasFrontMatter = content.startsWith('---\n');
            
            // If preserving existing properties, merge with existing ones
            if (preserveExisting && hasFrontMatter) {
                const existingProperties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
                properties = { ...existingProperties, ...properties };
            }
            
            // Format properties as YAML
            const yamlProperties = Object.entries(properties)
                .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
                .join('\n');
            
            let newContent = '';
            
            if (hasFrontMatter) {
                // Replace existing frontmatter
                const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
                const fileContent = content.substring(endOfFrontMatter);
                newContent = `---\n${yamlProperties}\n---\n${fileContent}`;
            } else {
                // Add new frontmatter
                newContent = `---\n${yamlProperties}\n---\n\n${content}`;
            }
            
            // Write the new content
            await this.app.vault.modify(file, newContent);
            
            return true;
        } catch (error) {
            console.error('Error applying properties:', error);
            new Notice(`Error applying properties to ${file.name}: ${error.message}`);
            return false;
        }
    }

    // Set a single property on a file
    async setProperty(filePath: string, propertyName: string, propertyValue: any): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            return false;
        }
        
        try {
            // Get existing properties
            const existingProperties = await this.parseFileProperties(file);
            
            // Update the property
            const updatedProperties = {
                ...existingProperties,
                [propertyName]: propertyValue
            };
            
            // Apply the updated properties
            return await this.applyProperties(file, updatedProperties);
        } catch (error) {
            console.error(`Error setting property for ${filePath}:`, error);
            return false;
        }
    }
    
    async findFilesByProperty(propertyName: string, propertyValue: any): Promise<TFile[]> {
        const files = this.app.vault.getMarkdownFiles();
        const matchingFiles: TFile[] = [];
        
        for (const file of files) {
            try {
                const properties = await this.parseFileProperties(file);
                if (properties[propertyName] !== undefined) {
                    // Check for equality or array inclusion
                    const value = properties[propertyName];
                    let matches = false;
                    
                    if (Array.isArray(value) && value.includes(propertyValue)) {
                        matches = true;
                    } else if (value === propertyValue) {
                        matches = true;
                    }
                    
                    if (matches) {
                        matchingFiles.push(file);
                    }
                }
            } catch (error) {
                console.error(`Error checking properties in ${file.path}:`, error);
                // Continue with the next file
            }
        }
        
        return matchingFiles; // Make sure this return statement exists
    }

    // Apply template properties to multiple files
    async applyTemplateToFiles(templateFile: TFile, targetFiles: TFile[], 
        propertiesToApply: string[], consistentProperties: string[]) {
        // Implementation remains the same...
        // Your existing method here
    }
    
    // Debug logging helper
    public debug(message: string, ...data: any[]) {
        console.log(`[YAML Property Manager] ${message}`, ...data);
    }
    
    // Navigation method to move between modals
    navigateToModal(currentModal: Modal, targetModalType: string, ...args: any[]) {
        // Add debug logging
        console.log(`Navigating from current modal to ${targetModalType}`);
        
        // Close current modal
        currentModal.close();
        
        // Handle special case for file selection
        if (targetModalType === 'bulkEdit') {
            console.log("Handling bulkEdit navigation");
            
            // If files are explicitly provided, use them
            if (Array.isArray(args[0]) && args[0].length > 0) {
                this.debug(`Navigating to bulk edit with ${args[0].length} explicitly provided files`);
                this.selectedFiles = args[0];
            }
            
            // Check if we have files selected
            if (this.selectedFiles.length === 0) {
                this.debug('No files selected for bulk edit');
                new Notice('Please select files first');
                new PropertyManagerModal(this.app, this).open();
                return;
            }
            
            this.debug(`Opening bulk edit with ${this.selectedFiles.length} files`);
            new BulkPropertyEditorModal(this.app, this, [...this.selectedFiles]).open();
            return;
        }
        
        // Handle other modal types
        switch (targetModalType) {
            case 'main':
                console.log("Opening main modal");
                new PropertyManagerModal(this.app, this).open();
                break;
            case 'template':
                console.log("Handling template modal navigation");
                if (this.selectedFiles.length === 0 && Array.isArray(args[0]) && args[0].length > 0) {
                    this.selectedFiles = args[0];
                }
                
                if (this.selectedFiles.length > 0) {
                    console.log(`Opening template modal with ${this.selectedFiles.length} files`);
                    new TemplateSelectionModal(this.app, this, [...this.selectedFiles]).open();
                } else {
                    new Notice('Please select files first');
                    new PropertyManagerModal(this.app, this).open();
                }
                break;
            case 'batchSelect':
                if (typeof args[0] === 'function') {
                    new BatchFileSelectorModal(this.app, (files: TFile[]) => {
                        if (files && files.length > 0) {
                            this.debug(`Batch selection returned ${files.length} files`);
                            this.selectedFiles = [...files];
                            args[0](files);
                        }
                    }).open();
                }
                break;
            default:
                console.log(`Unknown modal type: ${targetModalType}`);
        }
    }

    // Helper to convert Obsidian types to your internal types
    public convertFromObsidianType(type: ObsidianPropertyType): string {
        switch (type) {
            case "text": return "text";
            case "number": return "number";
            case "checkbox": return "checkbox";
            case "date": return "date";
            case "datetime": return "datetime";
            case "list": return "list";
            case "multi-select": return "list";
            case "file": return "text";
            case "relation": return "text";
            case "url": return "text";
            case "email": return "text";
            case "phone": return "text";
            case "select": return "text";
            default: return "text";
        }
    }
}