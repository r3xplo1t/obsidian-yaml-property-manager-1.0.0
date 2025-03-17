import { App, TFile } from 'obsidian';
import { detectPropertyType } from '../utils/propertyTypes';

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
     * Get the property type for a value using combined detection
     * Tries Obsidian APIs first, then falls back to our detection
     */
    getValuePropertyType(propertyName: string, propertyValue: any): ObsidianPropertyType {
        try {
            // First try Obsidian's property type (if globally defined)
            const globalType = this.getPropertyType(propertyName);
            if (globalType && globalType !== 'text') {
                return globalType;
            }
            
            // If no specific type defined, detect from value
            const detectedType = detectPropertyType(propertyValue);
            return this.convertToObsidianType(detectedType);
        } catch (error) {
            console.error("Error detecting property type:", error);
            return 'text'; // Safe default
        }
    }

    /**
     * Convert our internal types to Obsidian types
     */
    private convertToObsidianType(internalType: string): ObsidianPropertyType {
        switch (internalType) {
            case "text": return "text";
            case "number": return "number";
            case "checkbox": return "checkbox";
            case "date": return "date";
            case "datetime": return "datetime";
            case "list": return "list";
            default: return "text";
        }
    }

    /**
     * Get the property type using a combined approach:
     * 1. Try Obsidian's type system first
     * 2. Fall back to our own detection if needed
     */
    // In PropertyTypeService.ts, fix the getPropertyType method:
    getPropertyType(propertyName: string): ObsidianPropertyType | null {
        try {
            // Access Obsidian's internal property type manager
            // @ts-ignore - Accessing Obsidian's internal API
            const metadataTypeManager = this.app.metadataTypeManager;
            
            if (!metadataTypeManager) {
                console.debug("metadataTypeManager not available");
                return null;
            }
            
            // Your Obsidian version doesn't have getPropertyType, but it DOES have getPropertyInfo
            if (typeof metadataTypeManager.getPropertyInfo === 'function') {
                const propertyInfo = metadataTypeManager.getPropertyInfo(propertyName);
                return propertyInfo?.type || null;
            }
            
            // Try direct access to properties object as last resort
            if (metadataTypeManager.properties && propertyName in metadataTypeManager.properties) {
                return metadataTypeManager.properties[propertyName]?.type || null;
            }
            
            return null; // Nothing worked
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