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
 * Creates a compact representation suitable for UI previews, stripping [[...]] brackets.
 *
 * @param value - The value to format
 * @param propertyType - Optional property type hint (used for date/datetime)
 * @returns Formatted string for preview
 */
export function formatValuePreview(value: any, propertyType?: string): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value === 'string') {
        let displayValue = value;

        if (displayValue.startsWith('[[') && displayValue.endsWith(']]')) {
            displayValue = displayValue.substring(2, displayValue.length - 2).trim();
        }

        // Handle special property types like date/datetime (no change here)
        if (propertyType) {
            if (propertyType === 'date' || propertyType === 'datetime') {
                // Return date/datetime strings directly without further modification/truncation
                return displayValue;
            }
        }

        // Truncate long strings (apply after stripping brackets)
        if (displayValue.length > 30) {
            return `${displayValue.substring(0, 27)}...`;
        }

        // Return the potentially modified string value
        return displayValue;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        // Check if array contains complex items (arrays or objects)
        const hasComplexItems = value.some(item => Array.isArray(item) || (typeof item === 'object' && item !== null));
        if (hasComplexItems) {
             return `[Array: ${value.length} items]`; // Keep simple preview for complex arrays
        } else {
            // For simple arrays, attempt to join and preview
            const joined = value.map(item => formatValuePreview(item)).join(', ');
             if (joined.length > 30) {
                 return `[${value.length} items]...`; // Truncate joined preview
             }
             return `[${joined}]`; // Show simple array content
        }
    }

    if (typeof value === 'object') {
        // Handle potential null objects explicitly if needed, though initial check covers null
        if (value === null) return 'null';
        // Basic object preview
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        return `{${keys.slice(0, 2).join(', ')}${keys.length > 2 ? ', ...' : ''}}`; // Preview first few keys
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

/**
 * Parse a string value to detect if it contains a link
 * Supports wiki-links, markdown links, and raw URLs
 * 
 * @param value - The string value to analyze
 * @returns Object with link information
 */
export function parseValueLinks(value: string): {
    isLink: boolean, 
    type?: 'wiki' | 'markdown' | 'url',
    path?: string, 
    displayText: string
} {
    // Check for wiki-links [[Link]] or [[Link|Alias]]
    if (value.startsWith('[[') && value.endsWith(']]')) {
        const linkText = value.substring(2, value.length - 2);
        const pipeIndex = linkText.indexOf('|');
        
        if (pipeIndex !== -1) {
            return {
                isLink: true,
                type: 'wiki',
                path: linkText.substring(0, pipeIndex),
                displayText: linkText.substring(pipeIndex + 1)
            };
        } else {
            return {
                isLink: true,
                type: 'wiki',
                path: linkText,
                displayText: linkText
            };
        }
    }
    
    // Check for markdown links [Text](URL)
    const markdownLinkRegex = /^\[([^\]]+)\]\(([^)]+)\)$/;
    const markdownMatch = markdownLinkRegex.exec(value);
    if (markdownMatch) {
        const displayText = markdownMatch[1];
        const url = markdownMatch[2];
        
        // Determine if it's an internal or external link
        const isExternal = url.startsWith('http://') || url.startsWith('https://');
        
        return {
            isLink: true,
            type: isExternal ? 'url' : 'markdown', 
            path: url,
            displayText: displayText
        };
    }
    
    // Check for plain URLs
    const urlRegex = /^(https?:\/\/[^\s]+)$/;
    const urlMatch = urlRegex.exec(value);
    if (urlMatch) {
        return {
            isLink: true,
            type: 'url',
            path: urlMatch[1],
            displayText: urlMatch[1]
        };
    }
    
    // Not a link
    return {
        isLink: false,
        displayText: value
    };
}