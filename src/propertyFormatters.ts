/**
 * YAML Property Manager - Property Formatting Utilities
 * Functions for consistent formatting of property values across the plugin
 */

/**
 * Format a value for YAML frontmatter
 * Handles different data types and ensures proper YAML syntax
 * 
 * @param value - The value to format
 * @returns Properly formatted YAML string representation
 */
export function formatYamlValue(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    
    if (typeof value === 'string') {
        // Check if string is multi-line
        if (value.includes('\n')) {
            // Split the string into lines
            const lines = value.split('\n');
            
            // Use block scalar style with '|-' to preserve line breaks
            return `|-\n  ${lines.map(line => line.trim() ? line : '').join('\n  ')}`;
        }
        
        // Always use quotes for strings that look like numbers
        if (!isNaN(Number(value)) && value.trim() !== '') {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        
        // For single-line strings with special characters
        if (value.includes('"') || value.includes("'") || 
            value.includes(':') || value.includes('#') || value.trim() !== value ||
            value.includes('[[') || value.includes(']]')) {
            // Use quotes for special strings
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        
        return value;
    }
    
    if (Array.isArray(value)) {
        // Empty array
        if (value.length === 0) {
            return '[]';
        }
        
        // For arrays, ensure each item is on a new line with proper indentation
        return value.map(item => {
            // Format each item, ensuring it's properly quoted if needed
            const formattedItem = formatYamlValue(item);
            return `\n  - ${formattedItem}`;
        }).join('');
    }
    
    if (typeof value === 'object') {
        // Empty object
        if (Object.keys(value).length === 0) {
            return '{}';
        }
        
        // Convert to nested YAML format
        return `\n  ${Object.entries(value)
            .map(([k, v]) => `${k}: ${formatYamlValue(v).replace(/\n/g, '\n  ')}`)
            .join('\n  ')}`;
    }
    
    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for input fields in the UI
 * Converts various data types to a string representation suitable for editing
 * 
 * @param value - The value to format
 * @returns String representation for input fields
 */
export function formatInputValue(value: any): string {
    if (value === null || value === undefined) {
        return '';
    }
    
    if (typeof value === 'string') {
        return value;
    }
    
    if (Array.isArray(value)) {
        // Join array elements with commas for simple editing
        return value.map(item => 
            typeof item === 'string' ? item : String(item)
        ).join(', ');
    }
    
    if (typeof value === 'object') {
        try {
            // Format as JSON for complex objects
            return JSON.stringify(value, null, 2);
        } catch (e) {
            console.error('Error stringifying object:', e);
            return '[Complex Object]';
        }
    }
    
    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for preview display
 * Creates a compact representation suitable for UI previews
 * 
 * @param value - The value to format
 * @returns Formatted string for preview
 */
export function formatValuePreview(value: any, propertyType?: string): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value === 'string') {
        // Handle special property types
        if (propertyType) {
            // For date/datetime types, don't add quotes
            if (propertyType === 'date' || propertyType === 'datetime') {
                return value;
            }
        }
        
        // Truncate long strings
        if (value.length > 30) {
            return `${value.substring(0, 27)}...`;
        }
        
        // Return string values without quotes unless they need escaping
        return value;
    }
    
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return `[Array: ${value.length} items]`;
    }
    
    if (typeof value === 'object') {
        return '{Object}';
    }
    
    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for very short display contexts
 * Internal helper for formatValuePreview
 * 
 * @param value - The value to format
 * @returns Very short string representation
 * @private
 */
function formatShortValue(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    
    if (typeof value === 'string') {
        if (value.length > 8) {
            return `"${value.substring(0, 6)}..."`;
        }
        return `"${value}"`;
    }
    
    if (Array.isArray(value)) {
        return `[Array:${value.length}]`;
    }
    
    if (typeof value === 'object') {
        return '{...}';
    }
    
    return String(value);
}

/**
 * Detect if a string value represents a specific data type
 * Useful for handling types like dates, numbers, etc.
 * 
 * @param value - String value to analyze
 * @returns Detected type name
 */
export function detectStringValueType(value: string): string {
    if (!value) return 'text';
    
    // Date & Time format (YYYY-MM-DD HH:MM)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
        return "datetime";
    }
    
    // YYYY-MM-DD format (Date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "date";
    }
    
    // Number detection
    if (!isNaN(Number(value)) && value.trim() !== '') {
        return "number";
    }
    
    // Boolean detection
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        return "checkbox";
    }
    
    return "text";
}