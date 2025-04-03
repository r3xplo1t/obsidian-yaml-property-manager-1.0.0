import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, TFolder, TAbstractFile, normalizePath } from 'obsidian';
import { 
    // Models
    DEFAULT_SETTINGS,
    
    // Utils
    formatYamlValue,
    
    // Services
    PropertyTypeService,
    
    // Modals
    PropertyManagerModal,
    TemplateApplicationModal,
    BrowserModal,
    BulkPropertyEditorModal,
    YAMLPropertyManagerSettingTab
} from './src';

// Import types with explicit type imports
import type {
    YAMLPropertyManagerSettings,
    PropertyWithType, 
    ObsidianPropertyType
} from './src';

// Type definitions
type ModalType = 'main' | 'bulkEdit' | 'template' | 'batchSelect';
type FileSelectionResult = { files: TFile[], folders: TFolder[] };
type TemplatePathType = 'file' | 'directory';

/**
 * YAML Property Manager Plugin
 * Provides tools for managing YAML frontmatter across multiple files
 */
export default class YAMLPropertyManagerPlugin extends Plugin {
    settings: YAMLPropertyManagerSettings;
    selectedFiles: TFile[] = []; // Central file selection storage
    propertyCache: Map<string, Record<string, PropertyWithType>> = new Map();
    propertyTypeService: PropertyTypeService;

    //#region Lifecycle Methods

    async onload(): Promise<void> {
        await this.loadSettings();
        
        // Initialize the Property Type Service
        this.propertyTypeService = new PropertyTypeService(this.app);

        // Defer vault event handling to onLayoutReady to ensure Obsidian is fully loaded
        this.app.workspace.onLayoutReady(() => {
            this.registerVaultEvents();
        });

        this.registerCommands();
        this.addSettingTab(new YAMLPropertyManagerSettingTab(this.app, this));
    }

    onunload(): void {
        try {
            // Clear data structures to prevent memory leaks
            this.propertyCache.clear();
            this.selectedFiles = [];
            
            // Attempt to save any pending settings
            this.saveSettings().catch(error => {
                this.logError("Error saving settings during unload:", error);
            });
        } catch (error) {
            console.error("Error during plugin cleanup:", error);
        }
    }

    //#endregion

    //#region Settings Management

    async loadSettings(): Promise<void> {
        try {
            const loadedData = await this.loadData();
            this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
            
            // Migrate from old format if needed
            if (loadedData && 'defaultTemplateFilePath' in loadedData && 
                loadedData.defaultTemplateFilePath && 
                !('templatePaths' in loadedData)) {
                
                this.settings.templatePaths = [{
                    type: 'file' as TemplatePathType,
                    path: normalizePath(loadedData.defaultTemplateFilePath),
                    includeSubdirectories: false
                }];
                
                // Remove old property
                delete (this.settings as any).defaultTemplateFilePath;
                
                // Save migrated settings
                await this.saveSettings();
            }
        } catch (error) {
            console.error("Failed to load settings:", error);
            this.settings = Object.assign({}, DEFAULT_SETTINGS);
            new Notice("Failed to load settings. Using defaults.");
        }
    }

    async saveSettings(): Promise<void> {
        try {
            await this.saveData(this.settings);
        } catch (error) {
            console.error("Failed to save settings:", error);
            new Notice("Failed to save settings. Please try again.");
        }
    }

    // Add template to recent templates list
    addToRecentTemplates(templatePath: string): void {
        if (!templatePath) return;
        
        // Normalize the path first
        const normalizedPath = normalizePath(templatePath);
        
        // Get recent templates or initialize if doesn't exist
        const recentTemplates = this.settings.recentTemplates || [];
        
        // Normalize all paths for consistent comparison
        const normalizedRecentTemplates = recentTemplates.map(path => normalizePath(path));
        
        // Remove if already in the list (to move to the top)
        const existingIndex = normalizedRecentTemplates.indexOf(normalizedPath);
        if (existingIndex > -1) {
            recentTemplates.splice(existingIndex, 1);
        }
        
        // Add to the beginning of the list
        recentTemplates.unshift(normalizedPath);
        
        // Limit to max number of recent templates
        this.settings.recentTemplates = recentTemplates.slice(0, this.settings.maxRecentTemplates || 10);
        
        // Save settings
        this.saveSettings();
    }

    //#endregion

    //#region Command Registration

    private registerCommands(): void {
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
                        new TemplateApplicationModal(this.app, this, activeView.file ? [activeView.file] : []).open();
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
                const browser = new BrowserModal(
                    this.app,
                    this,
                    (result: FileSelectionResult) => {
                        if (result.files && result.files.length > 0) {
                            this.selectedFiles = [...result.files];
                            new TemplateApplicationModal(this.app, this, this.selectedFiles).open();
                        }
                    },
                    {
                        title: "Select Files for Template Application",
                        description: "Choose files to apply a template to.",
                        confirmButtonText: "Select Files"
                    }
                );
                browser.open();
            }
        });

        // Add command to reload the plugin
        this.addCommand({
            id: 'reload-yaml-property-manager',
            name: 'Reload YAML Property Manager',
            callback: () => this.reloadPlugin()
        });
    }

    /**
     * Register vault-related events
     * Separated to allow deferring to onLayoutReady
     */
    private registerVaultEvents(): void {
        // Register any vault events here
        this.registerEvent(
            this.app.vault.on('modify', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    // Clear cache for the modified file
                    this.propertyCache.delete(file.path);
                }
            })
        );
    }

    //#endregion

    //#region Template Management

    // Get all template files based on configuration
    async getAllTemplateFiles(): Promise<TFile[]> {
        const templates: TFile[] = [];
        const processedPaths = new Set<string>(); // To avoid duplicates
        
        try {
            for (const templatePath of this.settings.templatePaths) {
                // Normalize the path first
                const normalizedPath = normalizePath(templatePath.path);
                
                if (templatePath.type === 'file') {
                    // Handle individual file
                    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
                    if (file instanceof TFile && file.extension === 'md' && !processedPaths.has(file.path)) {
                        templates.push(file);
                        processedPaths.add(file.path);
                    }
                } else {
                    // Handle directory
                    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
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
            this.logError("Error getting template files:", error);
            // Don't rethrow, just return what we have so far
        }
        
        return templates;
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
            this.logError(`Error processing folder ${folder.path}:`, error);
            // Don't rethrow, just return what we have so far
        }
        
        return templates;
    }

    //#endregion

    //#region Property Management

    /**
     * Get internal type from a property value
     * @param propertyName - Name of the property
     * @param propertyValue - Value to analyze
     * @returns Internal type string
     */
    public getInternalPropertyType(propertyName: string, propertyValue: any): string {
        const obsidianType = this.propertyTypeService.getValuePropertyType(propertyName, propertyValue);
        return this.convertFromObsidianType(obsidianType);
    }

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
            this.logError(`Error parsing properties for ${file.path}:`, error);
            return {};
        }
    }

    // Apply properties to a file
    async applyProperties(file: TFile, properties: Record<string, any>, preserveExisting: boolean = false): Promise<boolean> {
        try {
            // Use Obsidian's built-in processFrontMatter method for consistent YAML formatting
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                if (preserveExisting) {
                    // Merge with existing properties
                    Object.entries(properties).forEach(([key, value]) => {
                        frontmatter[key] = value;
                    });
                } else {
                    // Replace frontmatter entirely
                    // First, clear all existing keys
                    Object.keys(frontmatter).forEach(key => {
                        delete frontmatter[key];
                    });
                    
                    // Then add the new properties
                    Object.entries(properties).forEach(([key, value]) => {
                        frontmatter[key] = value;
                    });
                }
            });
            
            return true;
        } catch (error) {
            this.logError('Error applying properties:', error);
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
            // Use Obsidian's processFrontMatter for atomic and consistent updates
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter[propertyName] = propertyValue;
            });
            
            return true;
        } catch (error) {
            this.logError(`Error setting property for ${filePath}:`, error);
            return false;
        }
    }
    
    async findFilesByProperty(propertyName: string, propertyValue: any): Promise<TFile[]> {
        const files = this.app.vault.getMarkdownFiles();
        const matchingFiles: TFile[] = [];
        
        propertyName = propertyName.trim(); // Trim the property name for consistency
        
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
                this.logError(`Error checking properties in ${file.path}:`, error);
                // Continue with the next file
            }
        }
        
        return matchingFiles;
    }

    // Apply template properties to multiple files
    async applyTemplateToFiles(
        templateFile: TFile, 
        targetFiles: TFile[], 
        propertiesToApply: string[], 
        consistentProperties: string[]
    ): Promise<number> {
        try {
            // Get template properties
            const templateProperties = await this.parseFileProperties(templateFile);
            
            // Filter to only specified properties
            const filteredProperties: Record<string, any> = {};
            for (const key of propertiesToApply) {
                if (key in templateProperties) {
                    filteredProperties[key] = templateProperties[key];
                }
            }
            
            // Process each target file
            let successCount = 0;
            for (const file of targetFiles) {
                // Skip the template file itself
                if (file.path === templateFile.path) continue;
                
                try {
                    // For consistent properties, check if all files have the same value
                    if (consistentProperties.length > 0) {
                        // Use processFrontMatter for atomic operations
                        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                            const fileProperties = frontmatter || {};
                            
                            // Create a copy of filteredProperties to modify
                            const propertiesForThisFile = {...filteredProperties};
                            
                            // Remove any consistent properties that don't match
                            for (const key of consistentProperties) {
                                // Only check if the property is in the template and target file
                                if (key in propertiesForThisFile && key in fileProperties) {
                                    const templateValue = propertiesForThisFile[key];
                                    const fileValue = fileProperties[key];
                                    
                                    // If values don't match, remove from properties to apply
                                    if (JSON.stringify(templateValue) !== JSON.stringify(fileValue)) {
                                        delete propertiesForThisFile[key];
                                    }
                                }
                            }
                            
                            // Apply the filtered properties
                            for (const [key, value] of Object.entries(propertiesForThisFile)) {
                                frontmatter[key] = value;
                            }
                        });
                        
                        successCount++;
                    } else {
                        // No consistent properties check needed, just apply all filtered properties
                        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                            for (const [key, value] of Object.entries(filteredProperties)) {
                                frontmatter[key] = value;
                            }
                        });
                        
                        successCount++;
                    }
                    
                    // Clear cache for the modified file
                    this.propertyCache.delete(file.path);
                    
                } catch (error) {
                    this.logError(`Error applying template to ${file.path}:`, error);
                    // Continue with other files
                }
            }
            
            new Notice(`Applied template to ${successCount} of ${targetFiles.length} ${targetFiles.length === 1 ? 'file' : 'files'}`);
            return successCount;
        } catch (error) {
            this.logError('Error applying template:', error);
            new Notice(`Error applying template: ${error.message}`);
            return 0;
        }
    }
    
    //#endregion

    //#region Navigation and UI

    // Navigation method to move between modals
    navigateToModal(currentModal: Modal, targetModalType: ModalType, ...args: any[]): void {
        // Close current modal
        currentModal.close();
        
        // Handle navigation based on target type
        switch (targetModalType) {
            case 'main':
                this.openMainModal();
                break;
            case 'bulkEdit':
                this.openBulkEditModal(args);
                break;
            case 'template':
                this.openTemplateModal(args);
                break;
            case 'batchSelect':
                this.openBatchSelectModal(args);
                break;
        }
    }

    // Helper methods for modal navigation
    private openMainModal(): void {
        new PropertyManagerModal(this.app, this).open();
    }

    private openBulkEditModal(args: any[]): void {        
        // If files are explicitly provided, use them
        if (Array.isArray(args[0]) && args[0].length > 0) {
            this.selectedFiles = args[0];
        }
        
        // Check if we have files selected
        if (this.selectedFiles.length === 0) {
            new Notice('Please select files first');
            this.openMainModal();
            return;
        }
        
        new BulkPropertyEditorModal(this.app, this, [...this.selectedFiles]).open();
    }

    private openTemplateModal(args: any[]): void {        
        // If files are provided as an argument, use them
        if (this.selectedFiles.length === 0 && Array.isArray(args[0]) && args[0].length > 0) {
            this.selectedFiles = args[0];
        }
        
        if (this.selectedFiles.length > 0) {
            new TemplateApplicationModal(this.app, this, [...this.selectedFiles]).open();
        } else {
            new Notice('Please select files first');
            this.openMainModal();
        }
    }

    private openBatchSelectModal(args: any[]): void {
        if (typeof args[0] === 'function') {
            const callback = args[0];
            
            // Create browser modal with proper icon buttons
            const browser = new BrowserModal(
                this.app,
                this,
                (result: FileSelectionResult) => {
                    if (result.files && result.files.length > 0) {
                        this.selectedFiles = [...result.files];
                        callback(result.files);
                    }
                },
                {
                    title: "Select Files",
                    description: "Choose files to process.",
                    confirmButtonText: "Select Files"
                }
            );
            browser.open();
        }
    }

    //#endregion

    //#region Utility Methods

    // Helper to convert Obsidian types to your internal types
    public convertFromObsidianType(type: ObsidianPropertyType): string {
        switch (type) {
            case "text": return "text";
            case "number": return "number";
            case "checkbox": return "checkbox";
            case "date": return "date";
            case "datetime": return "datetime";
            case "list": return "list";
            default: return "text";
        }
    }

    async reloadPlugin(): Promise<void> {
        try {
            // Create a notice to indicate reload is happening
            new Notice('Reloading YAML Property Manager...');
            
            // Get plugin ID
            const pluginId = this.manifest.id;
            
            // Access the internal plugins API (not exposed in public types)
            // This is necessary to programmatically disable/enable the plugin
            const pluginManager = (this.app as any).plugins;
            
            // First disable the plugin
            await pluginManager.disablePlugin(pluginId);
            
            // Then enable it again after a short delay
            setTimeout(async () => {
                await pluginManager.enablePlugin(pluginId);
                new Notice('YAML Property Manager has been reloaded');
            }, 300);
        } catch (error) {
            this.logError('Error reloading plugin:', error);
            new Notice('Failed to reload plugin: ' + error.message);
        }
    }

    // Error logging helper
    public logError(message: string, error: any): void {
        console.error(`[YAML Property Manager] ${message}`, error);
    }

    //#endregion
}