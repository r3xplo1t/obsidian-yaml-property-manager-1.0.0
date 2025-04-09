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
        // For multiline text, preserve line breaks
        if (value === 'multitext' || value.includes('\n')) {
            return value; // Return the original string with line breaks intact
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
            return '[Complex Object]';
        }
    }
    
    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for preview display
 * Corrected to match Obsidian's native property display
 *
 * @param value - The value to format
 * @param propertyType - Optional property type hint
 * @returns Formatted string for preview
 */
export function formatValuePreview(value: any, propertyType?: string): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    // Handle string values
    if (typeof value === 'string') {
        // For multiline text, preserve line breaks rather than converting to spaces
        if (propertyType === 'multitext') {
            return value; // Return the original string for ONLY multitext
        }
        
        // Only process as links if they are actual wikilinks
        if (value.startsWith('[[') && value.endsWith(']]')) {
            const linkContent = value.substring(2, value.length - 2);
            
            // Handle aliases with pipe character
            const pipeIndex = linkContent.indexOf('|');
            if (pipeIndex !== -1) {
                return linkContent.substring(pipeIndex + 1).trim();
            }
            
            return linkContent.trim();
        }
        
        // Otherwise return the string as-is without any link processing
        return value;
    }

    // Handle array values
    if (Array.isArray(value)) {
        if (value.length === 0) return '';
        
        // For true wiki link arrays, process them as links (only these should be treated as links)
        if (propertyType === 'list' && 
            value.every(item => 
                typeof item === 'string' && 
                item.startsWith('[[') && 
                item.endsWith(']]')
            )) {
            // Process wiki links in array
            const processedLinks = value.map(item => {
                const linkContent = item.substring(2, item.length - 2);
                const pipeIndex = linkContent.indexOf('|');
                if (pipeIndex !== -1) {
                    return linkContent.substring(pipeIndex + 1).trim();
                }
                return linkContent.trim();
            });
            
            // For small arrays, show all items
            if (value.length <= 3) {
                return processedLinks.join(', ');
            }
            
            // For larger arrays, show the first item and count
            return `${processedLinks[0]}, ${value.length - 1} more items`;
        }
        
        // For URL arrays, they should be treated as links in Obsidian
        if (propertyType === 'list' && 
            value.every(item => 
                typeof item === 'string' && 
                (item.startsWith('http://') || item.startsWith('https://'))
            )) {
            // Process URLs in array
            // For small arrays, show all items
            if (value.length <= 3) {
                return value.join(', ');
            }
            
            // For larger arrays, show the first item and count
            return `${value[0]}, ${value.length - 1} more items`;
        }
        
        // For regular arrays, just display them as strings (not as links)
        // For small arrays, show all items
        if (value.length <= 3) {
            return value.map(item => String(item)).join(', ');
        }
        
        // For larger arrays, show the first item and count
        return `${String(value[0])}, ${value.length - 1} more items`;
    }

    // Handle objects
    if (typeof value === 'object' && value !== null) {
        const keys = Object.keys(value);
        if (keys.length === 0) return '';
        
        if (keys.length <= 2) {
            return keys.map(key => `${key}: ${String(value[key])}`).join(', ');
        }
        
        return `${keys[0]}: ${String(value[keys[0]])}, ... +${keys.length - 1} more!`;
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
                path: linkText.substring(0, pipeIndex).trim(),
                displayText: linkText.substring(pipeIndex + 1).trim()
            };
        } else {
            return {
                isLink: true,
                type: 'wiki',
                path: linkText.trim(),
                displayText: linkText.trim()
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