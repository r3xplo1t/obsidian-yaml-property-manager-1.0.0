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

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';

        // Use the updated formatShortValue which cleans the items
        const itemStrings = value.map(item => formatShortValue(item));

        let previewString = itemStrings.join(', ');

        const maxLength = 60; // Adjust as needed
        if (previewString.length > maxLength) {
            let trimIndex = previewString.lastIndexOf(',', maxLength - 4);
            if (trimIndex === -1 || trimIndex < maxLength / 2) {
                trimIndex = maxLength - 3;
            }
            previewString = previewString.substring(0, trimIndex) + '...';
        }
        return previewString;
    }

    // Handling for non-array types remains the same...
    if (typeof value === 'string') {
        if (propertyType === 'date' || propertyType === 'datetime') {
            return value;
        }
        const stringMaxLength = 30;
        if (value.length > stringMaxLength) {
            // Check if it's a wikilink before truncating display string
             if (value.startsWith('[[') && value.endsWith(']]')) {
                 let cleanValue = value.substring(2, value.length - 2);
                 const pipeIndex = cleanValue.indexOf('|');
                 if (pipeIndex !== -1) {
                     cleanValue = cleanValue.substring(pipeIndex + 1);
                 }
                 // Truncate the cleaned value if needed
                 return cleanValue.length > stringMaxLength ? `${cleanValue.substring(0, stringMaxLength - 3)}...` : cleanValue;
             }
            // Standard string truncation
            return `${value.substring(0, stringMaxLength - 3)}...`;
        }
        // Display non-array strings directly (might still contain [[..]] if not truncated)
        // Or apply cleaning here too if desired for single strings:
        // if (value.startsWith('[[') && value.endsWith(']]')) { ... clean it ... }
        return value;
    }

    if (typeof value === 'object') {
        return '{Object}';
    }

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
        let cleanValue = value;

        // Check if it looks like a wikilink [[Link]] or [[Link|Alias]]
        if (cleanValue.startsWith('[[') && cleanValue.endsWith(']]')) {
            // Remove the brackets
            cleanValue = cleanValue.substring(2, cleanValue.length - 2);
            // Check for alias |
            const pipeIndex = cleanValue.indexOf('|');
            if (pipeIndex !== -1) {
                // Use only the alias part (after the pipe)
                cleanValue = cleanValue.substring(pipeIndex + 1);
            }
        }

        // Truncate if necessary (AFTER cleaning)
        if (cleanValue.length > 15) { // Shorter limit for items within a list preview
            return `${cleanValue.substring(0, 13)}...`;
        }
        // Return the cleaned value directly, without adding quotes
        return cleanValue;
    }

    if (Array.isArray(value)) {
        // More concise array preview for nested arrays
        return `[${value.length}]`;
    }

    if (typeof value === 'object') {
        return '{...}';
    }

    // For numbers, booleans, etc., just convert to string
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