import { YAMLPropertyManagerSettings } from './interfaces';

export const PROPERTY_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'list', label: 'List' },
    { value: 'number', label: 'Number' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date & Time' }
];

export const DEFAULT_SETTINGS: YAMLPropertyManagerSettings = {
    templatePaths: [],
    recentTemplates: [],
    maxRecentTemplates: 5,
    expandedTemplatePaths: [] // Initialize with empty array
};