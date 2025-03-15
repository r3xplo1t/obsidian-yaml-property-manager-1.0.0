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
import { PropertyWithType, preservePropertyTypes, restorePropertyValues } from './src/utils/propertyTypes';

export default class YAMLPropertyManagerPlugin extends Plugin {
    settings: YAMLPropertyManagerSettings;
    selectedFiles: TFile[] = []; // Added central file selection storage
    propertyCache: Map<string, Record<string, PropertyWithType>> = new Map();

    async onload() {
        await this.loadSettings();

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

        // Add settings tab
        this.addSettingTab(new YAMLPropertyManagerSettingTab(this.app, this));
    }

    onunload() {
        // Clean up plugin resources
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
        // Remove if already exists
        this.settings.recentTemplates = this.settings.recentTemplates.filter(path => path !== templatePath);
        
        // Add to the beginning
        this.settings.recentTemplates.unshift(templatePath);
        
        // Trim to max size
        if (this.settings.recentTemplates.length > this.settings.maxRecentTemplates) {
            this.settings.recentTemplates = 
                this.settings.recentTemplates.slice(0, this.settings.maxRecentTemplates);
        }
        
        this.saveSettings();
    }

    // Get all template files based on configuration
    async getAllTemplateFiles(): Promise<TFile[]> {
        const templates: TFile[] = [];
        const processedPaths = new Set<string>(); // To avoid duplicates
        
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
        
        return templates;
    }

    // Recursively get template files from a folder
    async getTemplateFilesFromFolder(
        folder: TFolder, 
        includeSubfolders: boolean, 
        processedPaths: Set<string>
    ): Promise<TFile[]> {
        const templates: TFile[] = [];
        
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
        
        return templates;
    }

    // Property utility functions
    
    // Parse YAML frontmatter from a file
    async parseFileProperties(file: TFile): Promise<Record<string, any>> {
        try {
            const content = await this.app.vault.read(file);
            const properties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
            
            // Add these new lines
            // Preserve the type information
            const propertiesWithTypes = preservePropertyTypes(properties);
            
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
            // Read the file content
            const content = await this.app.vault.read(file);
            
            // Check if file already has frontmatter
            const hasFrontMatter = content.startsWith('---\n');
            
            let newContent = '';
            let fileContent = content;
            
            // If preserving existing properties, merge with existing ones
            if (preserveExisting && hasFrontMatter) {
                const existingProperties = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
                properties = { ...existingProperties, ...properties };
            }
            
            // Flatten and sanitize array properties
            const sanitizedProperties: Record<string, any> = {};
            for (const [key, value] of Object.entries(properties)) {
                // Ensure arrays are properly flattened
                sanitizedProperties[key] = Array.isArray(value) 
                    ? value.reduce((acc: any[], item) => {
                        // Recursively flatten nested arrays
                        if (Array.isArray(item)) {
                            return acc.concat(item);
                        }
                        acc.push(item);
                        return acc;
                    }, [])
                    : value;
            }
            
            // Format properties as YAML
            const yamlProperties = Object.entries(sanitizedProperties)
                .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
                .join('\n');
            
            // Generate new content with properties
            if (hasFrontMatter) {
                // Replace existing frontmatter
                const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
                fileContent = content.substring(endOfFrontMatter);
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

    // Apply template properties to multiple files
    async applyTemplateToFiles(templateFile: TFile, targetFiles: TFile[], 
        propertiesToApply: string[], consistentProperties: string[]) {
        
        try {
            // Get template properties
            const templateProperties = await this.parseFileProperties(templateFile);
            
            // Filter to only include specified properties
            const filteredProperties: Record<string, any> = {};
            for (const key of propertiesToApply) {
                if (key in templateProperties) {
                    filteredProperties[key] = templateProperties[key];
                }
            }
            
            // Apply to each target file
            let successCount = 0;
            for (const file of targetFiles) {
                // Skip the template file itself if it's in the target list
                if (file.path === templateFile.path) continue;
                
                // Create a copy of filtered properties
                const propertiesToApplyToFile = { ...filteredProperties };
                
                // For non-consistent properties, don't override existing values
                if (consistentProperties.length < propertiesToApply.length) {
                    const nonConsistentProps = propertiesToApply.filter(p => !consistentProperties.includes(p));
                    const existingProperties = await this.parseFileProperties(file);
                    
                    for (const prop of nonConsistentProps) {
                        if (prop in existingProperties) {
                            propertiesToApplyToFile[prop] = existingProperties[prop];
                        }
                    }
                }
                
                // Apply the properties
                const success = await this.applyProperties(file, propertiesToApplyToFile, false);
                if (success) successCount++;
            }
            
            new Notice(`Applied template to ${successCount} of ${targetFiles.length} files`);
            return successCount;
        } catch (error) {
            console.error('Error applying template:', error);
            new Notice(`Error applying template: ${error.message}`);
            return 0;
        }
    }
    
    // Debug logging helper
    public debug(message: string, ...data: any[]) {
        console.log(`[YAML Property Manager] ${message}`, ...data);
    }
    
    // Navigation method to move between modals
    navigateToModal(currentModal: Modal, targetModalType: string, ...args: any[]) {
        // Close current modal
        currentModal.close();
        
        // Handle special case for file selection
        if (targetModalType === 'bulkEdit') {
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
                new PropertyManagerModal(this.app, this).open();
                break;
            case 'template':
                if (this.selectedFiles.length === 0 && Array.isArray(args[0]) && args[0].length > 0) {
                    this.selectedFiles = args[0];
                }
                
                if (this.selectedFiles.length > 0) {
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
        }
    }
}