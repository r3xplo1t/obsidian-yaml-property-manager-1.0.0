import { App, TFile, TFolder } from 'obsidian';

export interface YAMLPropertyManagerSettings {
    templatePaths: TemplatePath[];
    recentTemplates: string[];
    maxRecentTemplates: number;
    expandedTemplatePaths?: string[]; // New field for expanded path persistence
}

export interface TemplatePath {
    type: 'file' | 'directory';
    path: string;
    includeSubdirectories: boolean;
}

export interface TemplateNode {
    type: 'folder' | 'file';
    name: string;
    path: string;
    children: TemplateNode[];
    file?: TFile;
}

// Tree node for settings display
export interface TreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children: TreeNode[];
    templatePathIndex?: number;
}