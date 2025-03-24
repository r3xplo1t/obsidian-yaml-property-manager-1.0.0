// Helper function to format values for YAML
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
        // For arrays, ensure each item is on a new line with proper indentation
        return value.map(item => {
            // Format each item, ensuring it's properly quoted if needed
            const formattedItem = formatYamlValue(item);
            return `\n  - ${formattedItem}`;
        }).join('');
    }
    
    if (typeof value === 'object') {
        // Convert to nested YAML format
        return `\n  ${Object.entries(value)
            .map(([k, v]) => `${k}: ${formatYamlValue(v).replace(/\n/g, '\n  ')}`)
            .join('\n  ')}`;
    }
    
    // For booleans, numbers, etc.
    return String(value);
}

// Helper function to format values for input fields
export function formatInputValue(value: any): string {
    if (value === null || value === undefined) {
    return '';
    }
}

// Helper function to format value previews
export function formatValuePreview(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value === 'string') {
        // Truncate long strings
        if (value.length > 30) {
            return `"${value.substring(0, 27)}..."`;
        }
        return `"${value}"`;
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