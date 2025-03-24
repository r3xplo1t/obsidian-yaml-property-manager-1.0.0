import { App, TFile } from 'obsidian';

// Re-export types and interfaces so they can be used by other files
// that previously imported from propertyTypes.ts

/**
 * Types supported by Obsidian's property system
 */
export type ObsidianPropertyType = 
    'text' | 'number' | 'checkbox' | 
    'date' | 'datetime' | 'select' | 
    'multi-select' | 'relation' | 'file' | 
    'list' | 'url' | 'email' | 'phone';

/**
 * Property definition from Obsidian's metadata system
 */
export interface ObsidianPropertyDefinition {
    name: string;
    type: ObsidianPropertyType;
    options?: string[];
}

/**
 * Interface for properties with preserved type information
 */
export interface PropertyWithType {
    value: any;
    type: string;
    originalString?: string;
}

/**
 * Interface for internal property definitions from Obsidian's API
 */
interface InternalPropertyDefinition {
    type?: ObsidianPropertyType;
    options?: string[];
    [key: string]: any;
}

/**
 * Unified service class for handling property types
 * Combines interaction with Obsidian's type system and standalone utility functions
 */
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
            const detectedType = this.detectPropertyType(propertyValue);
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
     * Get the property type using Obsidian's internal API
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
            
            // Try getPropertyInfo method first (newer Obsidian versions)
            if (typeof metadataTypeManager.getPropertyInfo === 'function') {
                const propertyInfo = metadataTypeManager.getPropertyInfo(propertyName);
                return propertyInfo?.type || null;
            }
            
            // Try direct access to properties object as fallback
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
            
            // Get all property types - try different methods for different Obsidian versions
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
            
            // Use our type detection function
            return this.convertToObsidianType(this.detectPropertyType(value));
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

    /**
     * Detect property type following Obsidian's property type detection logic
     * Moved from propertyTypes.ts to be a method of the service
     */
    detectPropertyType(propertyValue: any): string {
        // Null/undefined values are treated as text in Obsidian
        if (propertyValue === null || propertyValue === undefined) {
            return "text";
        }
        
        // Arrays become list type properties in Obsidian
        if (Array.isArray(propertyValue)) {
            return "list";
        }
        
        // Boolean values become checkbox properties
        if (typeof propertyValue === "boolean") {
            return "checkbox";
        }
        
        // Numbers become number properties
        if (typeof propertyValue === "number") {
            return "number";
        }
        
        // String values require more specific checking
        if (typeof propertyValue === "string") {
            // Date & Time format (YYYY-MM-DD HH:MM)
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(propertyValue)) {
                return "datetime";
            }
            
            // YYYY-MM-DD format (Date)
            if (/^\d{4}-\d{2}-\d{2}$/.test(propertyValue)) {
                return "date";
            }
            
            // All other strings are text
            return "text";
        }
        
        // Objects and other types default to text
        return "text";
    }
    
    /**
     * Get display-friendly name for property type
     * Moved from propertyTypes.ts to be a method of the service
     */
    getPropertyTypeDisplayName(type: string): string {
        switch (type.toLowerCase()) {
            case "text": return "Text";
            case "list": return "List";
            case "number": return "Number";
            case "checkbox": return "Checkbox";
            case "date": return "Date";
            case "datetime": return "Date & Time";
            default: return "Text";
        }
    }
    
    /**
     * Preserves the type information of property values
     * Moved from propertyTypes.ts to be a method of the service
     */
    preservePropertyTypes(properties: Record<string, any>): Record<string, PropertyWithType> {
        const result: Record<string, PropertyWithType> = {};
        
        for (const [key, value] of Object.entries(properties)) {
            if (value === null || value === undefined) {
                result[key] = { value, type: 'null' };
            } else if (typeof value === 'string') {
                // Check if it's a number-like string
                const isNumericString = !isNaN(Number(value)) && value.trim() !== '';
                result[key] = { 
                    value,
                    type: 'string',
                    // Save original string format if it's numeric
                    originalString: isNumericString ? value : undefined
                };
            } else if (typeof value === 'number') {
                result[key] = { value, type: 'number' };
            } else if (typeof value === 'boolean') {
                result[key] = { value, type: 'boolean' };
            } else if (Array.isArray(value)) {
                // Recursively process array items
                const processedArray = value.map(item => {
                    if (typeof item === 'string') {
                        // For strings in arrays that look like numbers
                        const isNumericString = !isNaN(Number(item)) && item.trim() !== '';
                        return isNumericString ? { value: item, type: 'string', originalString: item } : item;
                    }
                    return item;
                });
                result[key] = { value: processedArray, type: 'array' };
            } else if (typeof value === 'object') {
                result[key] = { value: this.preservePropertyTypes(value), type: 'object' };
            } else {
                result[key] = { value, type: typeof value };
            }
        }
        
        return result;
    }
    
    /**
     * Restores the original property values with preserved types
     * Moved from propertyTypes.ts to be a method of the service
     */
    restorePropertyValues(properties: Record<string, PropertyWithType>): Record<string, any> {
        const result: Record<string, any> = {};
        
        for (const [key, propertyWithType] of Object.entries(properties)) {
            if (propertyWithType.type === 'string' && propertyWithType.originalString) {
                // Restore the original string format
                result[key] = propertyWithType.originalString;
            } else if (propertyWithType.type === 'array' && Array.isArray(propertyWithType.value)) {
                // Process arrays
                result[key] = propertyWithType.value.map(item => {
                    if (item && typeof item === 'object' && 'type' in item && item.type === 'string' && item.originalString) {
                        return item.originalString;
                    }
                    return item;
                });
            } else if (propertyWithType.type === 'object' && typeof propertyWithType.value === 'object') {
                // Recursively restore nested objects
                result[key] = this.restorePropertyValues(propertyWithType.value);
            } else {
                // Use the original value for other types
                result[key] = propertyWithType.value;
            }
        }
        
        return result;
    }
}