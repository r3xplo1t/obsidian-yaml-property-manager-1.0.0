// Export utility functions
export { formatYamlValue, formatInputValue, formatValuePreview } from './propertyFormatters';

// Export models and constants
export type { 
    YAMLPropertyManagerSettings, 
    TemplatePath,
    TemplateNode,
    TreeNode 
} from './interfaces';

export { 
    PROPERTY_TYPES, 
    DEFAULT_SETTINGS 
} from './constants';

// Export all from the unified PropertyTypeService
export { PropertyTypeService } from './PropertyTypeService';
export type { 
    PropertyWithType,
    ObsidianPropertyType,
    ObsidianPropertyDefinition
} from './PropertyTypeService';

// Export modals - now we can include them
export { PropertyManagerModal } from './modals/PropertyManagerModal';
export { TemplateApplicationModal } from './modals/TemplateApplicationModal';
export { BrowserModal } from './modals/BrowserModal';
export type { BrowserModalResult } from './modals/BrowserModal';
export { BulkPropertyEditorModal } from './modals/BulkPropertyEditorModal';
export { YAMLPropertyManagerSettingTab } from './modals/YAMLPropertyManagerSettingTab';