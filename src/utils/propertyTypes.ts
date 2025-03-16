/**
 * Detect property type following Obsidian's property type detection logic
 */
export function detectPropertyType(propertyValue: any): string {
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
        // Keep all string values as text, even if they contain only digits
        // This ensures numbers specified as text remain text
        
        // Full ISO date with time (Date & Time)
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
        
        // Full ISO date with time (Date & Time)
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(propertyValue)) {
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
 */
export function getPropertyTypeDisplayName(type: string): string {
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
 * Interface for properties with preserved type information
 */
export interface PropertyWithType {
    value: any;
    type: string;
    originalString?: string;
}

/**
 * Preserves the type information of property values
 * @param properties The properties object
 * @returns Properties with type metadata
 */
export function preservePropertyTypes(properties: Record<string, any>): Record<string, PropertyWithType> {
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
            result[key] = { value: preservePropertyTypes(value), type: 'object' };
        } else {
            result[key] = { value, type: typeof value };
        }
    }
    
    return result;
}

/**
 * Restores the original property values with preserved types
 * @param properties Properties with type metadata
 * @returns Original properties object
 */
export function restorePropertyValues(properties: Record<string, PropertyWithType>): Record<string, any> {
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
            result[key] = restorePropertyValues(propertyWithType.value);
        } else {
            // Use the original value for other types
            result[key] = propertyWithType.value;
        }
    }
    
    return result;
}