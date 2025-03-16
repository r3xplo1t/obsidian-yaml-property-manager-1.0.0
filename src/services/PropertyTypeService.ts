import { App, TFile } from 'obsidian';

export type ObsidianPropertyType = 
    'text' | 'number' | 'checkbox' | 
    'date' | 'datetime' | 'select' | 
    'multi-select' | 'relation' | 'file' | 
    'list' | 'url' | 'email' | 'phone';

export interface ObsidianPropertyDefinition {
    name: string;
    type: ObsidianPropertyType;
    options?: string[];
}

// Interface for internal property definitions from Obsidian's API
interface InternalPropertyDefinition {
    type?: ObsidianPropertyType;
    options?: string[];
    [key: string]: any;
}

export class PropertyTypeService {
    constructor(private app: App) {}
    
    /**
     * Get the Obsidian-defined type for a property
     */
    getPropertyType(propertyName: string): ObsidianPropertyType | null {
        try {
            // Access Obsidian's internal property type manager
            // @ts-ignore - Accessing Obsidian's internal API
            const metadataTypeManager = this.app.metadataTypeManager;
            
            if (!metadataTypeManager) {
                console.debug("metadataTypeManager not available");
                return null;
            }
            
            // Get the property definition
            const propertyType = metadataTypeManager.getPropertyType(propertyName);
            
            return propertyType || 'text'; // Default to text if not defined
        } catch (error) {
            console.error("Error accessing property type:", error);
            return null;
        }
    }
    
    /**
     * Get all property definitions from Obsidian
     */
    getAllPropertyDefinitions(): ObsidianPropertyDefinition[] {
        try {
            // @ts-ignore - Accessing Obsidian's internal API
            const metadataTypeManager = this.app.metadataTypeManager;
            
            if (!metadataTypeManager) {
                console.debug("metadataTypeManager not available");
                return [];
            }
            
            // Get all property types
            // Different versions of Obsidian might use different methods
            if (typeof metadataTypeManager.getPropertyDefinitions === 'function') {
                return metadataTypeManager.getPropertyDefinitions();
            } else if (typeof metadataTypeManager.getAllPropertyDefinitions === 'function') {
                return metadataTypeManager.getAllPropertyDefinitions();
            } else {
                // Fallback approach - try to extract from the metadata cache
                // @ts-ignore - Accessing internal properties
                const definitions = this.app.metadataCache.propertyDefinitions;
                if (definitions) {
                    return Object.entries(definitions).map(([name, def]) => ({
                        name,
                        type: (def as InternalPropertyDefinition).type || 'text',
                        options: (def as InternalPropertyDefinition).options
                    }));
                }
            }
            
            return [];
        } catch (error) {
            console.error("Error accessing property definitions:", error);
            return [];
        }
    }
    
    /**
     * Set or update a property type definition
     */
    setPropertyType(propertyName: string, propertyType: ObsidianPropertyType, options?: string[]): boolean {
        try {
            // @ts-ignore - Accessing Obsidian's internal API
            const metadataTypeManager = this.app.metadataTypeManager;
            
            if (!metadataTypeManager) {
                console.debug("metadataTypeManager not available");
                return false;
            }
            
            // Different versions of Obsidian might use different methods
            if (typeof metadataTypeManager.setPropertyType === 'function') {
                metadataTypeManager.setPropertyType(propertyName, propertyType, options);
                return true;
            } else if (typeof metadataTypeManager.defineProperty === 'function') {
                metadataTypeManager.defineProperty(propertyName, {
                    type: propertyType,
                    options: options
                });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error("Error setting property type:", error);
            return false;
        }
    }
    
    /**
     * Get the property type for a specific property in a file
     * This is different from the global type definition - it's the actual
     * inferred type for this specific instance
     */
    getFilePropertyType(file: TFile, propertyName: string): ObsidianPropertyType | null {
        try {
            const fileCache = this.app.metadataCache.getFileCache(file);
            if (!fileCache || !fileCache.frontmatter) {
                return null;
            }
            
            // If the property doesn't exist in this file
            if (!(propertyName in fileCache.frontmatter)) {
                return null;
            }
            
            // Try to get from frontmatter cache directly
            // @ts-ignore - Accessing internal properties
            const frontmatterTypes = fileCache.frontmatterTypes;
            if (frontmatterTypes && propertyName in frontmatterTypes) {
                return frontmatterTypes[propertyName];
            }
            
            // Get the value for regex-based detection
            const value = fileCache.frontmatter[propertyName];
            
            // For date/time values, use our more accurate regex detection
            if (typeof value === 'string') {
                // Date format (YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    return 'date';
                }
                
                // Date & Time format (YYYY-MM-DD HH:MM)
                if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
                    return 'datetime';
                }
            }
            
            // For other basic types, use simple JavaScript type detection
            if (typeof value === 'boolean') {
                return 'checkbox';
            }
            
            if (typeof value === 'number') {
                return 'number';
            }
            
            if (Array.isArray(value)) {
                return 'list';
            }
            
            // Default
            return 'text';
        } catch (error) {
            console.error("Error getting file property type:", error);
            return null;
        }
    }
    
    /**
     * Get the most basic type of a value using only JavaScript type detection
     * No regex patterns are used here
     */
    private getBasicValueType(value: any): ObsidianPropertyType {
        if (value === null || value === undefined) {
            return 'text';
        }
        
        if (typeof value === 'boolean') {
            return 'checkbox';
        }
        
        if (typeof value === 'number') {
            return 'number';
        }
        
        if (Array.isArray(value)) {
            return 'list';
        }
        
        // For strings, we just return 'text' without any regex-based subtype detection
        if (typeof value === 'string') {
            return 'text';
        }
        
        return 'text';
    }
}