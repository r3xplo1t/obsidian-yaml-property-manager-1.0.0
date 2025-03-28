/**
 * YAML Property Manager - Index exports
 * Organized export structure following Obsidian plugin patterns
 */

// -------- Models & Types --------
// Core interfaces and types
export type { 
    YAMLPropertyManagerSettings, 
    TemplatePath,
    TemplateNode,
    TreeNode 
} from './interfaces';

// Property-related types
export type { 
    PropertyWithType,
    ObsidianPropertyType,
    ObsidianPropertyDefinition
} from './PropertyTypeService';

// Modal result types
export type { BrowserModalResult } from './modals/BrowserModal';

// -------- Constants & Configuration --------
export { 
    PROPERTY_TYPES, 
    DEFAULT_SETTINGS 
} from './constants';

// -------- Services --------
// Property type management service
export { PropertyTypeService } from './PropertyTypeService';

// -------- Utilities --------
// YAML formatting utilities
export { 
    formatYamlValue, 
    formatInputValue, 
    formatValuePreview 
} from './propertyFormatters';

// -------- UI Components --------
// Main plugin modals
export { PropertyManagerModal } from './modals/PropertyManagerModal';
export { TemplateApplicationModal } from './modals/TemplateApplicationModal';
export { BrowserModal } from './modals/BrowserModal';
export { BulkPropertyEditorModal } from './modals/BulkPropertyEditorModal';
export { YAMLPropertyManagerSettingTab } from './modals/YAMLPropertyManagerSettingTab';