import { App, PluginSettingTab, Setting, Notice, ButtonComponent, Modal, setTooltip, setIcon, EventRef } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { BrowserModal } from './BrowserModal';
import { TreeNode } from '../interfaces';
import { findNextFocusableElement, findPrevFocusableElement } from '../commonHelpers';
import { QRCodeModal } from './QRCodeModal';

export class SettingTab extends PluginSettingTab {
    plugin: YAMLPropertyManagerPlugin;
    private expandedPaths: Set<string> = new Set();
    private rootNode: TreeNode;
    private settingsSaveTimeout: NodeJS.Timeout | null = null;

    constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        
        // Initialize expanded paths from settings
        if (this.plugin.settings.expandedTemplatePaths) {
            this.expandedPaths = new Set(this.plugin.settings.expandedTemplatePaths);
        }
    }

    private async removeTemplateWithScrollPreservation(templatePathIndex: number | undefined, node: TreeNode, nodeElement: HTMLElement): Promise<void> {
        // Create a notice that will stay until completion
        const debugNotice = new Notice(`Removing template: ${node.path}...`, 0);
        
        try {
            // Save the current scroll position of the container
            const container = nodeElement.closest('#template-paths-container');
            const scrollPosition = container ? container.scrollTop : 0;
            
            // Start animation - use animation class that comes with Obsidian
            nodeElement.addClass('is-removing');
            
            // Wait for animation
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Get all paths that should be KEPT (not matching our removal criteria)
            const pathsToKeep = this.plugin.settings.templatePaths.filter(tp => {
                // Don't keep if it's the exact path we're removing
                if (tp.path === node.path) {
                    return false;
                }
                
                // Don't keep if it's a child path (for directories)
                if (node.isDirectory && tp.path.startsWith(node.path + '/')) {
                    return false;
                }
                
                // Keep everything else
                return true;
            });
            
            // Replace the entire template paths array with our filtered version
            this.plugin.settings.templatePaths = pathsToKeep;
            
            // Also remove this path and any child paths from expanded paths
            if (node.isDirectory) {
                const expandedPathsToKeep = Array.from(this.expandedPaths).filter(path => {
                    return path !== node.path && !path.startsWith(node.path + '/');
                });
                this.expandedPaths = new Set(expandedPathsToKeep);
                
                // Update the settings with the new expanded paths
                this.plugin.settings.expandedTemplatePaths = expandedPathsToKeep;
            }
            
            // Save settings
            await this.plugin.saveSettings();
            
            // Remove node from DOM
            nodeElement.remove();
            
            // Refresh display ONLY if there are no template paths left
            if (this.plugin.settings.templatePaths.length === 0) {
                const templatePathsContainer = container as HTMLElement;
                
                // Instead of full refresh, just update the container
                if (templatePathsContainer) {
                    templatePathsContainer.empty();
                    new Setting(templatePathsContainer)
                        .setDesc('No template paths configured. Add template files or directories below.');
                }
            }
            
            // Close the debug notice
            debugNotice.hide();
            
            // Show success notification
            new Notice(`Template "${node.name}" removed successfully`);
        } catch (error) {
            console.error("Error removing template:", error);
            debugNotice.hide();
            new Notice(`Failed to remove template: ${error.message}`);
            
            // Force refresh on error
            this.display();
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        // Template Paths Section - Using Setting component for heading
        new Setting(containerEl)
            .setName('Template Paths')
            .setHeading();
        
        // Create a container for template paths using Obsidian's native classes
        const templatePathsContainer = containerEl.createDiv({
            cls: 'nav-folder-container',
            attr: { id: 'template-paths-container' }
        });
        
        // Display existing template paths in a hierarchical structure
        if (this.plugin.settings.templatePaths.length === 0) {
            // Create an empty message using Obsidian's Setting component
            new Setting(templatePathsContainer)
                .setDesc('No template paths configured. Add template files or directories below.');
        } else {
            // Generate a tree structure of the templates
            this.renderTemplatePathsHierarchy(templatePathsContainer);
        }
        
        // Single button to add templates - using Obsidian's native Setting API
        new Setting(containerEl)
            .setName('Template Selection')
            .setDesc('Browse and select template files or folders to use with YAML Property Manager')
            .addButton(button => {
                // Get the button element after setting up the button
                const buttonEl = button
                    .setButtonText('Browse and Select Templates')
                    .setCta()
                    .onClick(() => {
                        new BrowserModal(
                            this.app,
                            this.plugin,
                            async (result) => {
                            // Process selected files and folders
                            let countAdded = 0;
                            let countRemoved = 0;
                            
                            // Create sets for easier lookup
                            const resultFilePaths = new Set(result.files.map(f => f.path));
                            const resultFolderPaths = new Set(result.folders.map(f => f.path));
                            
                            // Check which existing templates should be removed
                            const pathsToKeep = [];
                            
                            for (const templatePath of this.plugin.settings.templatePaths) {
                                const isFile = templatePath.type === 'file';
                                const isFolder = templatePath.type === 'directory';
                                
                                if ((isFile && resultFilePaths.has(templatePath.path)) || 
                                    (isFolder && resultFolderPaths.has(templatePath.path))) {
                                    // This path is still selected, keep it
                                    pathsToKeep.push(templatePath);
                                } else {
                                    // This path is no longer selected, remove it
                                    countRemoved++;
                                }
                            }
                            
                            // Update settings with paths to keep
                            this.plugin.settings.templatePaths = pathsToKeep;
                            
                            // Now add new files and folders that aren't already in the settings
                            for (const file of result.files) {
                                const alreadyExists = this.plugin.settings.templatePaths.some(
                                    tp => tp.type === 'file' && tp.path === file.path
                                );
                                
                                if (!alreadyExists) {
                                    this.plugin.settings.templatePaths.push({
                                        type: 'file',
                                        path: file.path,
                                        includeSubdirectories: true
                                    });
                                    countAdded++;
                                }
                            }
                            
                            for (const folder of result.folders) {
                                const alreadyExists = this.plugin.settings.templatePaths.some(
                                    tp => tp.type === 'directory' && tp.path === folder.path
                                );
                                
                                if (!alreadyExists) {
                                    this.plugin.settings.templatePaths.push({
                                        type: 'directory',
                                        path: folder.path,
                                        includeSubdirectories: true
                                    });
                                    countAdded++;
                                }
                            }
                            
                            // Save settings and refresh if any changes were made
                            if (countAdded > 0 || countRemoved > 0) {
                                await this.plugin.saveSettings();
                                
                                // Build notification message
                                let noticeMsg = '';
                                if (countAdded > 0) {
                                    noticeMsg += `Added ${countAdded} template source${countAdded !== 1 ? 's' : ''}`;
                                }
                                if (countRemoved > 0) {
                                    if (noticeMsg) noticeMsg += ' and ';
                                    noticeMsg += `Removed ${countRemoved} template source${countRemoved !== 1 ? 's' : ''}`;
                                }
                                
                                new Notice(noticeMsg);
                                this.display(); // Refresh view
                            } else if (result.files.length > 0 || result.folders.length > 0) {
                                new Notice('No changes made to your template list');
                            }
                        },
                        {
                            title: "Select Template Files and Directories",
                            description: "Select files to use as templates, or select entire directories. Check the box to include a file or folder.",
                            confirmButtonText: "Apply Selected Files & Folders",
                            existingPathsToHighlight: this.plugin.settings.templatePaths
                        }
                    ).open();
                })
                .buttonEl;  // Get the button element
                
            // Add Obsidian tooltip to the button
            setTooltip(buttonEl, 'Select template files and folders', {
                placement: 'top'
            });
            
            return button;
        });
        
        // Max recent templates - With proper method chaining
        new Setting(containerEl)
        .setName('Max Recent Templates')
        .setDesc('Maximum number of recent templates to remember')
        .addSlider(slider => slider
            .setLimits(1, 10, 1)
            .setValue(this.plugin.settings.maxRecentTemplates)
            .setDynamicTooltip()
            .onChange((value) => {
                this.plugin.settings.maxRecentTemplates = value;
                if (this.plugin.settings.recentTemplates.length > value) {
                    this.plugin.settings.recentTemplates = 
                        this.plugin.settings.recentTemplates.slice(0, value);
                }
                this.debouncedSaveSettings(300);
            })
        );
        
        // Clear recent templates
        new Setting(containerEl)
        .setName('Recent Templates')
        .setDesc('Clear the list of recently used templates')
        .addButton(button => button
            .setButtonText('Clear Recent Templates')
            .onClick(async () => {
                this.plugin.settings.recentTemplates = [];
                await this.plugin.saveSettings();
                new Notice('Recent templates cleared');
            }));

        // Troubleshooting Section
        new Setting(containerEl)
            .setName('Troubleshooting')
            .setHeading();
                
        // Reset Template Paths button
        new Setting(containerEl)
            .setName('Reset Template Paths')
            .setDesc('If you experience issues with template paths not being removed correctly, use this button to reset all template paths.')
            .addButton(button => button
                .setButtonText('Reset All Template Paths')
                .setWarning()
                .onClick(async () => {
                    // Improve the confirmation modal for resetting template paths
                    const modal = new Modal(this.app);
                    modal.titleEl.setText('Confirm Reset');

                    // Add the mod-confirmation class to apply Dialog styling
                    modal.containerEl.addClass('mod-confirmation');

                    // Use Obsidian's setting pattern for modal content
                    new Setting(modal.contentEl)
                        .setDesc('Are you sure you want to reset all template paths? This cannot be undone.');

                    // Use Obsidian's button container styling
                    const buttonContainer = modal.contentEl.createDiv({ 
                        cls: 'modal-button-container' 
                    });

                    // Create buttons using ButtonComponent
                    const cancelButton = new ButtonComponent(buttonContainer)
                        .setButtonText('Cancel')
                        .onClick(() => {
                            modal.close();
                        });

                    const confirmButton = new ButtonComponent(buttonContainer)
                        .setButtonText('Reset All Paths')
                        .setWarning()
                        .onClick(async () => {
                            // Reset all template paths
                            this.plugin.settings.templatePaths = [];
                            await this.plugin.saveSettings();
                            new Notice('All template paths have been reset');
                            this.display();
                            modal.close();
                        });

                    // Handle keyboard navigation
                    modal.scope.register([], 'Escape', () => {
                        modal.close();
                    });

                    modal.open();

                    // Set focus to the cancel button (safer default)
                    setTimeout(() => cancelButton.buttonEl.focus(), 50);
                })
        );

        // Support Development Section
        containerEl.createEl('h2', { text: 'Support Development' });

        const supportSetting = new Setting(containerEl)
            .setName('Enjoying YAML Property Manager?')
            .setDesc('If this plugin helps your workflow, please consider supporting its continued development. Every contribution is appreciated!');

        // Create a general container for the buttons within the control element
        // This container will use flex to layout buttons side-by-side
        const buttonsContainer = supportSetting.controlEl.createDiv({
            cls: 'yaml-property-manager-support-buttons-container'
        });


        // 1. Create the QR Code Button (Icon Button)
        const qrButton = new ButtonComponent(buttonsContainer)
            .setIcon('qr-code') // Using Lucide icon for QR code
            .setTooltip('Show QR Code to Scan')
            .setClass('yaml-property-manager-qr-button') // For specific styling
            .onClick(async () => {
            // Construct the full path to the image asset
            // this.plugin.manifest.dir provides the path to the plugin's root folder
            if (!this.plugin.manifest.dir) {
                new Notice('Plugin directory not found. Cannot display QR code.');
                console.error('YAML Property Manager: Plugin manifest.dir is undefined.');
                return;
            }
            const imageRelativePath = 'bmc_qr.png'; // Path if image is copied to plugin's root build folder
            
            const fullImagePath = this.app.vault.adapter.getResourcePath(
                `${this.plugin.manifest.dir}/${imageRelativePath}`
            );

            if (fullImagePath) { // getResourcePath itself doesn't guarantee existence, just formats a path
                new QRCodeModal(this.app, this.plugin, fullImagePath).open();
            } else {
                // This 'else' might not be hit if getResourcePath always returns a string.
                // The check for file existence above or an error in loading the image in the modal
                // would be more indicative of a problem.
                new Notice('Could not generate resource path for QR code image.');
                console.error('YAML Property Manager: QR code image path could not be resolved by getResourcePath:', `${this.plugin.manifest.dir}/${imageRelativePath}`);
            }
        });
        qrButton.buttonEl.style.marginRight = '10px'; // Add some space between QR button and BMC button


        // 2. Create the "Buy me a coffee" custom button (your existing styled anchor tag)
        // This is the bmcButtonAnchor from your previous setup
        const bmcButtonAnchor = buttonsContainer.createEl('a', {
            cls: 'yaml-property-manager-bmc-link-button generate-btn-preview selected-yellow font-Comic',
            href: (this.plugin.manifest as any).fundingUrl || 'https://www.buymeacoffee.com/r3xplo1t',
            attr: {
                target: '_blank',
                rel: 'noopener noreferrer',
                role: 'button'
            }
        });

        // Inner div for flex layout within the BMC button
        const innerFlexDiv = bmcButtonAnchor.createDiv({
            cls: 'flex-container-bmc'
        });

        // Span for the icon within the BMC button
        const iconSpan = innerFlexDiv.createSpan({
            cls: 'btn-icon',
            text: '☕'
        });

        // Span for the custom text within the BMC button
        const textSpan = innerFlexDiv.createSpan({
            cls: 'btn-custom-text custom-font-stl',
            text: 'Buy me a\u00A0coffee'
        });
    }

    // Render template paths as a hierarchy
    renderTemplatePathsHierarchy(container: HTMLElement) {
        // Clear the container first
        container.empty();
        
        // First, build a hierarchical tree structure
        this.rootNode = {
            name: this.app.vault.getName(),
            path: '',
            isDirectory: true,
            children: []
        };
        
        // Helper to find or create a node for a path
        const getNodeForPath = (path: string, isDirectory: boolean): TreeNode => {
            if (path === '') return this.rootNode;
            
            const parts = path.split('/');
            let currentNode = this.rootNode;
            let currentPath = '';
            
            // Navigate/create the tree structure
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isLastPart = i === parts.length - 1;
                
                // Look for existing node
                let found = currentNode.children.find(c => c.name === part);
                
                if (!found) {
                    // Create a new node
                    const newNode: TreeNode = {
                        name: part,
                        path: currentPath,
                        isDirectory: isLastPart ? isDirectory : true, // Intermediate nodes are always directories
                        children: []
                    };
                    
                    currentNode.children.push(newNode);
                    found = newNode;
                }
                
                currentNode = found;
            }
            
            return currentNode;
        };
        
        // Add all template paths to the tree
        this.plugin.settings.templatePaths.forEach((tp, index) => {
            const node = getNodeForPath(tp.path, tp.type === 'directory');
            node.templatePathIndex = index; // Store reference to original index
        });
        
        // Sort helper for tree nodes
        const sortTreeNodes = (nodes: TreeNode[]) => {
            // Sort by type first (directories before files), then by name
            nodes.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            
            // Recursively sort children
            for (const node of nodes) {
                if (node.children.length > 0) {
                    sortTreeNodes(node.children);
                }
            }
        };
        
        // Sort the tree
        sortTreeNodes(this.rootNode.children);
        
        // Deduplicate nodes before rendering
        const deduplicateNodes = (node: TreeNode) => {
            // Create a map to track paths
            const pathMap = new Map<string, TreeNode>();
            
            // Filter out duplicate children
            node.children = node.children.filter(child => {
                const key = `${child.path}-${child.isDirectory}`;
                if (pathMap.has(key)) {
                    return false;
                }
                pathMap.set(key, child);
                return true;
            });
            
            // Recursively deduplicate children
            node.children.forEach(child => {
                if (child.children.length > 0) {
                    deduplicateNodes(child);
                }
            });
        };
        
        // Apply deduplication to the root node
        deduplicateNodes(this.rootNode);
        
        // Create a tree container using Obsidian's native classes
        const treeRoot = container.createDiv({ cls: 'tree-item nav-folder mod-root' });
        
        // Render the tree starting with the root's children
        for (const child of this.rootNode.children) {
            this.renderTreeItem(treeRoot, child, 0);
        }
        
        // Add an info message if no templates are configured
        if (this.rootNode.children.length === 0) {
            const emptyState = container.createDiv({
                cls: 'nav-empty-state'
            });
            
            emptyState.createSpan({
                text: 'No template paths configured. Add template files or directories below.',
                cls: 'nav-empty-state-text'
            });
        }
    }

    private renderTreeItem(parentEl: HTMLElement, node: TreeNode, level: number) {
        // Create a tree item container
        const itemEl = parentEl.createDiv({ 
            cls: 'tree-item ' + (node.isDirectory ? 'nav-folder' : 'nav-file') 
        });
        
        // Create the self (clickable title area)
        const selfEl = itemEl.createDiv({ 
            cls: 'tree-item-self ' + (node.isDirectory ? 'mod-collapsible' : ''),
            attr: {
                'aria-label': node.isDirectory ? `Folder: ${node.name}` : `File: ${node.name}`,
                'data-path': node.path,
                'tabindex': '0',
                'role': node.isDirectory ? 'button' : 'listitem',
                ...(node.isDirectory ? { 
                    'aria-expanded': this.expandedPaths.has(node.path).toString(),
                    'aria-controls': `children-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}` 
                } : {})
            }
        });
        
        // Add collapse indicator for directories
        if (node.isDirectory) {
            const collapseIconEl = selfEl.createDiv({ cls: 'tree-item-icon collapse-icon' });
            setIcon(collapseIconEl, 'right-triangle');
            
            // When collapsed, add is-collapsed class to point right
            if (!this.expandedPaths.has(node.path)) {
                collapseIconEl.addClass('is-collapsed');
            }
        }
        
        // Add the main content
        const innerEl = selfEl.createDiv({ cls: 'tree-item-inner' });
        innerEl.createSpan({ 
            text: node.name,
            cls: 'tree-item-inner-text'
        });
        
        // Add delete button with improved accessibility
        const flairContainer = selfEl.createDiv({ cls: 'tree-item-flair-outer' });
        const deleteButton = flairContainer.createDiv({ 
            cls: 'tree-item-flair clickable-icon',
            attr: {
                'role': 'button',
                'aria-label': `Remove template ${node.name}`,
                'tabindex': '0'
            }
        });
        setIcon(deleteButton, 'trash-2');
        setTooltip(deleteButton, `Remove template ${node.name}`);
        
        // For directories, handle expansion/collapse
        if (node.isDirectory) {
            // Create children container with ID for aria-controls
            const childrenId = `children-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const childrenEl = itemEl.createDiv({ 
                cls: 'tree-item-children',
                attr: {
                    'id': childrenId,
                    'role': 'group',
                    'aria-label': `${node.name} contents`
                }
            });
            
            // Set visibility based on expanded state
            if (!this.expandedPaths.has(node.path)) {
                childrenEl.style.display = 'none';
            }
            
            // Register click handler for toggling
            this.registerDomEventWithCleanup(selfEl, 'click', (e: MouseEvent) => {
                // Don't handle clicks on the delete button
                if (e.target === deleteButton || deleteButton.contains(e.target as Node)) {
                    return;
                }
                
                // Toggle expanded state
                const isExpanded = this.expandedPaths.has(node.path);
                
                if (isExpanded) {
                    // Folder going from expanded to collapsed
                    this.expandedPaths.delete(node.path);
                    childrenEl.style.display = 'none';
                    selfEl.setAttribute('aria-expanded', 'false');
                    selfEl.querySelector('.collapse-icon')?.addClass('is-collapsed');
                } else {
                    // Folder going from collapsed to expanded
                    this.expandedPaths.add(node.path);
                    childrenEl.style.display = '';
                    selfEl.setAttribute('aria-expanded', 'true');
                    selfEl.querySelector('.collapse-icon')?.removeClass('is-collapsed');
                    
                    // Lazy load children if needed
                    if (childrenEl.childElementCount === 0 && node.children.length > 0) {
                        // Add children
                        for (const child of node.children) {
                            this.renderTreeItem(childrenEl, child, level + 1);
                        }
                    } else if (node.children.length === 0 && childrenEl.childElementCount === 0) {
                        // Show empty folder message
                        const emptyEl = childrenEl.createDiv({ cls: 'nav-empty-state' });
                        emptyEl.createSpan({ 
                            text: 'Empty folder', 
                            cls: 'nav-empty-state-text'
                        });
                    }
                }
                
                // Save expanded paths to settings
                this.saveExpandedPathsToSettings();
            });
            
            // Enhanced keyboard navigation
            this.registerDomEventWithCleanup(selfEl, 'keydown', (e: KeyboardEvent) => {
                const isExpanded = this.expandedPaths.has(node.path);
                
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selfEl.click();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (!isExpanded) {
                        // Expand the folder if it's collapsed
                        selfEl.click();
                    } else {
                        // Move to the first child if folder is already expanded
                        const firstChild = childrenEl.querySelector('[tabindex="0"]') as HTMLElement;
                        if (firstChild) firstChild.focus();
                    }
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    if (isExpanded) {
                        // Collapse the folder if it's expanded
                        selfEl.click();
                    } else {
                        // Move to parent if folder is already collapsed
                        const parentFolder = itemEl.parentElement?.closest('.tree-item-self') as HTMLElement;
                        if (parentFolder) parentFolder.focus();
                    }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextFocusable = findNextFocusableElement(selfEl);
                    if (nextFocusable) nextFocusable.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prevFocusable = findPrevFocusableElement(selfEl);
                    if (prevFocusable) prevFocusable.focus();
                }
            });
            
            // Render children if expanded initially
            if (this.expandedPaths.has(node.path)) {
                if (node.children.length > 0) {
                    for (const child of node.children) {
                        this.renderTreeItem(childrenEl, child, level + 1);
                    }
                } else {
                    // Show empty folder message
                    const emptyEl = childrenEl.createDiv({ cls: 'nav-empty-state' });
                    emptyEl.createSpan({ 
                        text: 'Empty folder', 
                        cls: 'nav-empty-state-text'
                    });
                }
            }
        }
        
        // Handle delete button keyboard and click events
        this.registerDomEventWithCleanup(deleteButton, 'click', async (e: MouseEvent) => {
            e.stopPropagation();
            deleteButton.addClass('is-disabled');
            try {
                await this.removeTemplateWithScrollPreservation(node.templatePathIndex, node, itemEl);
            } catch (error) {
                console.error("Removal failed:", error);
                deleteButton.removeClass('is-disabled');
            }
        });
        
        this.registerDomEventWithCleanup(deleteButton, 'keydown', async (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                deleteButton.addClass('is-disabled');
                try {
                    await this.removeTemplateWithScrollPreservation(node.templatePathIndex, node, itemEl);
                } catch (error) {
                    console.error("Removal failed:", error);
                    deleteButton.removeClass('is-disabled');
                }
            }
        });
    }

    private debouncedSaveSettings(delay: number = 500): void {
        // Clear any existing timeout
        if (this.settingsSaveTimeout) {
            clearTimeout(this.settingsSaveTimeout);
        }
        
        // Schedule a new save operation
        this.settingsSaveTimeout = setTimeout(() => {
            this.plugin.saveSettings();
            this.settingsSaveTimeout = null;
        }, delay);
    }
    
    // Helper to save expanded paths to settings
    private saveExpandedPathsToSettings(): void {
        this.plugin.settings.expandedTemplatePaths = Array.from(this.expandedPaths);
        this.debouncedSaveSettings(300); // 300ms debounce for UI interactions
    }

    private registerDomEventWithCleanup(element: HTMLElement, type: string, callback: (event: any) => void): void {
        this.plugin.registerDomEvent(element, type as keyof HTMLElementEventMap, callback);
    }

    hide(): void {
        // Call the parent class hide method
        super.hide();
    }
}