import { App, TFile } from 'obsidian';
import type { YamlPropertyValue } from './interfaces';

/**
 * Types supported by the plugin, following Obsidian's property system
 */
export type ObsidianPropertyType =
    'text' | 'number' | 'checkbox' |
    'date' | 'datetime' | 'list' | 'multitext';

/**
 * Property definition structure
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
    value: YamlPropertyValue;
    type: string;
    originalString?: string;
}

/**
 * Service class for handling property types using Obsidian's public API
 */
export class PropertyTypeService {
    /**
     * Create a new PropertyTypeService
     * @param app - The Obsidian App instance
     */
    constructor(private app: App) {}

    /**
     * Get the property type for a value using detection
     *
     * @param propertyName - Name of the property (unused in this implementation)
     * @param propertyValue - Value to detect type for
     * @returns The detected property type
     */
    getValuePropertyType(_propertyName: string, propertyValue: YamlPropertyValue): ObsidianPropertyType {
        return this.detectPropertyType(propertyValue);
    }

    /**
     * Get the property type for a specific property in a file
     * Uses only public Obsidian API
     *
     * @param file - The file to check
     * @param propertyName - Name of the property
     * @returns The property type or null if not found
     */
    getFilePropertyType(file: TFile, propertyName: string): ObsidianPropertyType | null {
        try {
            const fileCache = this.app.metadataCache.getFileCache(file);
            if (!fileCache?.frontmatter) {
                return null;
            }
            if (!(propertyName in fileCache.frontmatter)) {
                return null;
            }
            return this.detectPropertyType(fileCache.frontmatter[propertyName] as YamlPropertyValue);
        } catch {
            return null;
        }
    }


    /**
     * Detect property type based on value analysis
     *
     * @param propertyValue - The value to detect type for
     * @returns The detected type
     */
    detectPropertyType(propertyValue: YamlPropertyValue): ObsidianPropertyType {
        // Null/undefined values are treated as text
        if (propertyValue === null || propertyValue === undefined) {
            return "text";
        }

        // Arrays become list type properties
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

            // Try to interpret as number
            if (!isNaN(Number(propertyValue)) && propertyValue.trim() !== '') {
                return "number";
            }

            // All other strings are text
            return "text";
        }

        // Objects and other types default to text
        return "text";
    }

    /**
     * Get display-friendly name for property type
     *
     * @param type - The type string
     * @returns User-friendly display name
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
     * Modify the frontmatter of a file using Obsidian's public API
     *
     * @param file - The file to modify
     * @param propertyName - The property to change
     * @param propertyValue - The new value
     * @returns Promise resolving to true if successful
     */
    async setFileProperty(file: TFile, propertyName: string, propertyValue: YamlPropertyValue): Promise<boolean> {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, YamlPropertyValue>) => {
                frontmatter[propertyName] = propertyValue;
            });
            return true;
        } catch (error) {
            console.error(`Error setting property ${propertyName}:`, error);
            return false;
        }
    }

    /**
     * Preserves the type information of property values
     *
     * @param properties - Object of property values
     * @returns Object with preserved type information
     */
    preservePropertyTypes(properties: Record<string, YamlPropertyValue>): Record<string, PropertyWithType> {
        const result: Record<string, PropertyWithType> = {};

        for (const [key, value] of Object.entries(properties)) {
            if (value === null || value === undefined) {
                result[key] = { value: null, type: 'null' };
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
                result[key] = { value: processedArray as YamlPropertyValue[], type: 'array' };
            } else if (typeof value === 'object') {
                result[key] = { value: this.preservePropertyTypes(value as Record<string, YamlPropertyValue>) as unknown as YamlPropertyValue, type: 'object' };
            } else {
                result[key] = { value, type: typeof value };
            }
        }

        return result;
    }

    /**
     * Convert from Obsidian property type to the plugin's internal type string
     *
     * @param type - An ObsidianPropertyType value
     * @returns Internal type string used throughout the plugin
     */
    convertFromObsidianType(type: ObsidianPropertyType): string {
        switch (type) {
            case "text":      return "text";
            case "number":    return "number";
            case "checkbox":  return "checkbox";
            case "date":      return "date";
            case "datetime":  return "datetime";
            case "list":      return "list";
            case "multitext": return "list";
            default:          return "text";
        }
    }

    /**
     * Restores the original property values with preserved types
     *
     * @param properties - Object with preserved type information
     * @returns Object with original values
     */
    restorePropertyValues(properties: Record<string, PropertyWithType>): Record<string, YamlPropertyValue> {
        const result: Record<string, YamlPropertyValue> = {};

        for (const [key, propertyWithType] of Object.entries(properties)) {
            if (propertyWithType.type === 'string' && propertyWithType.originalString) {
                // Restore the original string format
                result[key] = propertyWithType.originalString;
            } else if (propertyWithType.type === 'array' && Array.isArray(propertyWithType.value)) {
                // Process arrays
                result[key] = propertyWithType.value.map(item => {
                    if (item && typeof item === 'object' && 'type' in item && (item as unknown as PropertyWithType).type === 'string' && (item as unknown as PropertyWithType).originalString) {
                        return (item as unknown as PropertyWithType).originalString as string;
                    }
                    return item;
                });
            } else if (propertyWithType.type === 'object' && typeof propertyWithType.value === 'object' && propertyWithType.value !== null) {
                // Recursively restore nested objects
                result[key] = this.restorePropertyValues(propertyWithType.value as unknown as Record<string, PropertyWithType>) as unknown as YamlPropertyValue;
            } else {
                // Use the original value for other types
                result[key] = propertyWithType.value;
            }
        }

        return result;
    }
}
