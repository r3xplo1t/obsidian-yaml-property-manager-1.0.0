import { YAMLPropertyManagerSettings } from './interfaces';

/**
 * Property types supported by the plugin, aligned with Obsidian's property system
 * These types determine how properties are displayed and edited in the UI
 */
export const PROPERTY_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'list', label: 'List' },
    { value: 'number', label: 'Number' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date & Time' }
];

/**
 * CSS color variables for property type indicators
 * Uses Obsidian's built-in color variables for consistency
 */
export const TYPE_COLORS = {
    text: 'var(--text-normal)',
    list: 'var(--color-purple)',
    number: 'var(--color-blue)',
    checkbox: 'var(--color-green)',
    date: 'var(--color-orange)',
    datetime: 'var(--color-orange)'
};

/**
 * Default plugin settings
 * Initialize all settings to ensure type safety and prevent undefined errors
 */
export const DEFAULT_SETTINGS: YAMLPropertyManagerSettings = {
    templatePaths: [],
    recentTemplates: [],
    maxRecentTemplates: 5,
    expandedTemplatePaths: []
};

/**
 * UI-related constants for consistent spacing and sizing
 */
export const UI_CONSTANTS = {
    ANIMATION_DURATION: 'var(--anim-duration-moderate)',
    ANIMATION_CURVE: 'var(--anim-motion-smooth)',
    MODAL_WIDTH: 'var(--modal-width)',
    MODAL_MAX_WIDTH: 'var(--modal-max-width)'
};