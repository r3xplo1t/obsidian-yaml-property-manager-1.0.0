import { TFile, TFolder } from 'obsidian';

/**
 * Plugin settings interface
 * Defines the structure of the settings that are saved to data.json
 */
export interface YAMLPropertyManagerSettings {
    /** List of paths to template files or directories */
    templatePaths: TemplatePath[];
    
    /** List of recently used template paths for quick access */
    recentTemplates: string[];
    
    /** Maximum number of recent templates to store */
    maxRecentTemplates: number;
    
    /** Paths that should be expanded in the template browser UI */
    expandedTemplatePaths: string[];
}

/**
 * Template path configuration
 * Represents either a file or directory path used for templates
 */
export interface TemplatePath {
    /** Whether this path points to a file or directory */
    type: 'file' | 'directory';
    
    /** Path to the template file or directory */
    path: string;
    
    /** For directories, whether to include subdirectories */
    includeSubdirectories: boolean;
}

/**
 * Template tree node
 * Used to build hierarchical structure of templates for UI display
 */
export interface TemplateNode {
    /** Type of node (folder or file) */
    type: 'folder' | 'file';
    
    /** Display name of the node */
    name: string;
    
    /** Full path to the node */
    path: string;
    
    /** Child nodes (empty array for files) */
    children: TemplateNode[];
    
    /** Reference to the TFile object (for file nodes only) */
    file?: TFile;
}

/**
 * Settings UI tree node
 * Used specifically for the settings tab template selection UI
 */
export interface TreeNode {
    /** Display name of the node */
    name: string;
    
    /** Full path to the node */
    path: string;
    
    /** Whether this node represents a directory */
    isDirectory: boolean;
    
    /** Child nodes (empty array for files) */
    children: TreeNode[];
    
    /** Index in the templatePaths array (for tracking in UI) */
    templatePathIndex?: number;
}

/**
 * Property filter options
 * Used for filtering properties in bulk operations
 */
export interface PropertyFilterOptions {
    /** Show properties with inconsistent types */
    showDifferentTypes: boolean;
    
    /** Show properties with inconsistent values */
    showDifferentValues: boolean;
    
    /** Show properties missing from some files */
    showMissing: boolean;
    
    /** Show all properties regardless of filter */
    showAll: boolean;
}