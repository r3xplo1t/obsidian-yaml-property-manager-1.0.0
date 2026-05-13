/**
 * YAML Property Manager - Common Helper Functions
 * Centralized location for reusable utility functions used across the plugin
 */

import { App, Notice } from 'obsidian';
import type { YamlPropertyValue } from './interfaces';

// ==========================================
// Formatting and Value Handling
// ==========================================

/**
 * Format a value for YAML frontmatter
 * Handles different data types and ensures proper YAML syntax
 *
 * @param value - The value to format
 * @returns Properly formatted YAML string representation
 */
export function formatYamlValue(value: YamlPropertyValue): string {
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

    if (typeof value === 'object' && value !== null) {
        const rec = value as Record<string, YamlPropertyValue>;
        // Empty object
        if (Object.keys(rec).length === 0) {
            return '{}';
        }

        // Convert to nested YAML format
        return `\n  ${Object.entries(rec)
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
export function formatInputValue(value: YamlPropertyValue): string {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        // Join array elements with commas for simple editing
        return value.map(item =>
            typeof item === 'string' ? item
            : typeof item === 'number' || typeof item === 'boolean' ? String(item)
            : item === null ? ''
            : JSON.stringify(item)
        ).join(', ');
    }

    if (typeof value === 'object' && value !== null) {
        try {
            // Format as JSON for complex objects
            return JSON.stringify(value, null, 2);
        } catch {
            return '[Complex Object]';
        }
    }

    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for preview display
 * Formats values to match Obsidian's native property display
 *
 * @param value - The value to format
 * @param propertyType - Optional property type hint
 * @returns Formatted string for preview
 */
export function formatValuePreview(value: YamlPropertyValue, propertyType?: string): string {
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
            const processedLinks = (value as string[]).map(item => {
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
            // For small arrays, show all items
            if (value.length <= 3) {
                return value.map(String).join(', ');
            }

            // For larger arrays, show the first item and count
            const firstUrl = value[0];
            return `${typeof firstUrl === 'string' ? firstUrl : formatInputValue(firstUrl)}, ${value.length - 1} more items`;
        }

        // For regular arrays, just display them as strings (not as links)
        // For small arrays, show all items
        if (value.length <= 3) {
            return value.map(item => formatInputValue(item)).join(', ');
        }

        // For larger arrays, show the first item and count
        return `${formatInputValue(value[0])}, ${value.length - 1} more items`;
    }

    // Handle objects
    if (typeof value === 'object' && value !== null) {
        const rec = value;
        const keys = Object.keys(rec);
        if (keys.length === 0) return '';

        if (keys.length <= 2) {
            return keys.map(key => `${key}: ${formatInputValue(rec[key])}`).join(', ');
        }

        return `${keys[0]}: ${formatInputValue(rec[keys[0]])}, ... +${keys.length - 1} more!`;
    }

    // For booleans, numbers, etc.
    return String(value);
}

/**
 * Format a value for very short display contexts
 *
 * @param value - The value to format
 * @returns Very short string representation
 */
export function formatShortValue(value: YamlPropertyValue): string {
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
 * @param value - The string to parse
 * @returns Information about detected links
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

// ==========================================
// Type and Value Helpers
// ==========================================

/**
 * Get an empty value for a specific property type
 *
 * @param type - The property type
 * @returns An appropriate default empty value
 */
export function getEmptyValueForType(type: string): YamlPropertyValue {
    switch (type) {
        case 'number': return 0;
        case 'checkbox': return false;
        case 'list': return [];
        case 'date': return '';
        case 'datetime': return '';
        default: return '';
    }
}

/**
 * Infer the most likely type for a property based on its key name
 *
 * @param key - The property key name
 * @returns The inferred property type
 */
export function getDefaultTypeForKey(key: string): string {
    // Check if the key name suggests a specific type
    if (key.includes('date') || key.includes('time')) {
        return 'datetime';
    } else if (key.includes('list') || key.includes('tags') || key.endsWith('s')) {
        return 'list';
    } else if (key.includes('enable') || key.includes('check') || key.includes('toggle')) {
        return 'checkbox';
    } else if (key.includes('count') || key.includes('number') || key.includes('amount')) {
        return 'number';
    } else {
        return 'text';
    }
}

/**
 * Checks if a value is potentially a link that should be clickable
 *
 * @param value - The value to check
 * @returns True if value appears to be a link
 */
export function isPotentialLink(value: YamlPropertyValue): boolean {
    // Handle arrays with single items
    if (Array.isArray(value) && value.length === 1) {
        return isPotentialLink(value[0]);
    }

    // Only strings can be links
    if (typeof value !== 'string') {
        return false;
    }

    const trimmedValue = value.trim();

    // Only treat these specific formats as links
    return (
        // Wiki links
        (trimmedValue.startsWith('[[') && trimmedValue.endsWith(']]')) ||
        // URLs
        trimmedValue.startsWith('https://') ||
        trimmedValue.startsWith('http://') ||
        trimmedValue.startsWith('obsidian://')
    );
}

/**
 * Handles clicks on potential links within property values
 * Supports various link formats like wikilinks and URLs
 *
 * @param app - Obsidian App instance
 * @param linkTarget - The value that might contain a link
 * @param event - The mouse event that triggered the handler
 */
export function handleLinkClick(app: App, linkTarget: YamlPropertyValue, event: MouseEvent): void {
    event.stopPropagation(); // Prevent triggering other actions if nested

    // Handle array with a single element
    if (Array.isArray(linkTarget) && linkTarget.length === 1) {
        // Extract the single element and process it
        handleLinkClick(app, linkTarget[0], event);
        return;
    }

    if (typeof linkTarget !== 'string') {
        console.warn("handleLinkClick called with non-string target:", linkTarget);
        return;
    }

    // Check for external links first
    if (linkTarget.startsWith('https://') || linkTarget.startsWith('http://')) {
        window.open(linkTarget, '_blank');
        return;
    }

    // Attempt to parse Obsidian-style links (wikilinks, markdown links)
    const linkInfo = parseValueLinks(linkTarget);
    const sourcePath = "";

    // If this is a valid link with a path, use that path
    if (linkInfo.isLink && linkInfo.path) {
        try {
            app.workspace.openLinkText(linkInfo.path, sourcePath, false).catch(() => {
                new Notice(`Could not open link: ${linkInfo.path}`);
            });
            return;
        } catch (error) {
            logError('YAML Property Manager', `Error processing link: ${linkTarget}`, error);
            new Notice(`Could not process link: ${linkTarget}`);
            return;
        }
    }

    // Fallback - try to resolve the raw link target
    try {
        app.workspace.openLinkText(linkTarget, sourcePath, false).catch(() => {
            new Notice(`Could not open link: ${linkTarget}`);
        });
    } catch (error) {
        logError('YAML Property Manager', `Error processing link: ${linkTarget}`, error);
        new Notice(`Could not process link: ${linkTarget}`);
    }
}

// ==========================================
// DOM and UI Helpers
// ==========================================

/**
 * Find the next focusable element in the DOM
 *
 * @param currentEl - The current element
 * @returns The next focusable element or null if none found
 */
export function findNextFocusableElement(currentEl: HTMLElement, scope: HTMLElement = activeDocument.body): HTMLElement | null {
    const allFocusable = Array.from(
        scope.querySelectorAll<HTMLElement>('.tree-item-self[tabindex="0"], .clickable-icon[tabindex="0"]')
    );

    const currentIndex = allFocusable.indexOf(currentEl);
    if (currentIndex >= 0 && currentIndex < allFocusable.length - 1) {
        return allFocusable[currentIndex + 1];
    }
    return null;
}

export function findPrevFocusableElement(currentEl: HTMLElement, scope: HTMLElement = activeDocument.body): HTMLElement | null {
    const allFocusable = Array.from(
        scope.querySelectorAll<HTMLElement>('.tree-item-self[tabindex="0"], .clickable-icon[tabindex="0"]')
    );

    const currentIndex = allFocusable.indexOf(currentEl);
    if (currentIndex > 0) {
        return allFocusable[currentIndex - 1];
    }
    return null;
}

/**
 * Creates a toggle button element with label
 *
 * @param container - The parent container element
 * @param label - Label text for the toggle
 * @param initial - Initial toggle state
 * @param onChange - Callback function when toggle changes
 * @returns The created toggle element
 */
export function createToggle(
    container: HTMLElement,
    label: string,
    initial: boolean,
    onChange: (value: boolean) => void
): HTMLElement {
    const toggleContainer = container.createDiv({ cls: 'setting-item toggle-container' });

    // Create label
    const labelEl = toggleContainer.createDiv({ cls: 'setting-item-info' });
    labelEl.createDiv({ cls: 'setting-item-name', text: label });

    // Create toggle
    const toggleEl = toggleContainer.createDiv({ cls: 'setting-item-control' });
    const checkbox = toggleEl.createEl('input', {
        type: 'checkbox',
        cls: 'toggle-checkbox',
        attr: {
            'checked': initial ? 'checked' : '',
            'aria-label': label,
            'id': `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`
        }
    });

    // Add aria label to container
    toggleContainer.setAttribute('aria-labelledby', checkbox.id);

    // Set initial state
    checkbox.checked = initial;

    // Add change handler
    checkbox.addEventListener('change', () => {
        onChange(checkbox.checked);
    });

    return toggleContainer;
}

/**
 * Sets the expanded/collapsed state of a collapsible element
 *
 * @param element - The element to expand/collapse
 * @param expanded - Whether element should be expanded
 */
export function setExpandedState(element: HTMLElement, expanded: boolean): void {
    if (!element) return;

    // Update ARIA attribute
    element.setAttribute('aria-expanded', String(expanded));

    // Look for collapse icon
    const collapseIcon = element.querySelector('.collapse-icon');
    if (collapseIcon) {
        if (expanded) {
            collapseIcon.classList.remove('is-collapsed');
        } else {
            collapseIcon.classList.add('is-collapsed');
        }
    }

    // Find content container
    const contentEl = element.parentElement?.querySelector('.tree-item-children, .property-content');
    if (contentEl?.instanceOf(HTMLElement)) {
        if (expanded) {
            contentEl.show();
        } else {
            contentEl.hide();
        }
    }
}

/**
 * Clear all child elements from a parent element
 *
 * @param element - The parent element to clear
 */
export function clearChildren(element: HTMLElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

/**
 * Scroll an element into view if it's not already visible
 *
 * @param element - The element to scroll into view
 */
export function scrollIntoViewIfNeeded(element: HTMLElement): void {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect();

    if (!parentRect) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
    }

    // Check if element is out of view
    if (
        rect.bottom > parentRect.bottom ||
        rect.top < parentRect.top
    ) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ==========================================
// File and Path Utilities
// ==========================================

/**
 * Gets the parent path from a file path
 *
 * @param path - The file path
 * @returns The parent directory path
 */
export function getParentPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) return '';
    return path.substring(0, lastSlash);
}

/**
 * Gets the basename (filename without extension) from a path
 *
 * @param path - The file path
 * @returns The basename
 */
export function getBasename(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    const filename = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? filename : filename.substring(0, lastDot);
}

// ==========================================
// General Utilities
// ==========================================

export { debounce } from 'obsidian';

/**
 * Logs an error with a consistent prefix
 *
 * @param prefix - The logger prefix (e.g., component name)
 * @param message - The error message
 * @param error - The error object
 */
export function logError(prefix: string, message: string, error: unknown): void {
    console.error(`[${prefix}] ${message}`, error);
}
