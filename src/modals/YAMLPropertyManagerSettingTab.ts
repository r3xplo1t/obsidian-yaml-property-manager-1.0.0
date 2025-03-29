import { App, PluginSettingTab, Setting, Notice, ButtonComponent, Modal } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { BrowserModal } from './BrowserModal';
import { TreeNode } from '../interfaces';

export class YAMLPropertyManagerSettingTab extends PluginSettingTab {
    plugin: YAMLPropertyManagerPlugin;
    private expandedPaths: Set<string> = new Set();
    private tooltips: {element: HTMLElement, tooltip: HTMLElement}[] = [];
    private hasScrollHandler: boolean = false;
    private titleObservers: Map<HTMLElement, MutationObserver> | null = null;
    private rootNode: TreeNode;

    constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        
        // Initialize expanded paths from settings
        if (this.plugin.settings.expandedTemplatePaths) {
            this.expandedPaths = new Set(this.plugin.settings.expandedTemplatePaths);
        }
    }

    // Override hide method to ensure tooltips are cleaned up
    hide() {
        this.cleanup();
        super.hide();
    }

    private async removeTemplateWithScrollPreservation(templatePathIndex: number | undefined, node: TreeNode, nodeElement: HTMLElement): Promise<void> {
        // Create a notice that will stay until completion
        const debugNotice = new Notice(`Removing template: ${node.path}...`, 0);
        
        try {
            // Save the current scroll position of the container
            const container = nodeElement.closest('.yaml-template-paths');
            const scrollPosition = container ? container.scrollTop : 0;
            
            // Start animation
            nodeElement.addClass('yaml-template-node--removing');
            
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
            
            // Remove node from DOM - this is a targeted removal, much smoother than full refresh
            nodeElement.remove();
            
            // Refresh display ONLY if there are no template paths left
            if (this.plugin.settings.templatePaths.length === 0) {
                const templatePathsContainer = container as HTMLElement;
                
                // Instead of full refresh, just update the container
                if (templatePathsContainer) {
                    templatePathsContainer.empty();
                    templatePathsContainer.createEl('p', {
                        text: 'No template paths configured. Add template files or directories below.',
                        cls: 'yaml-settings-description'
                    });
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
        // Save the current scroll position if a template paths container exists
        const existingContainer = document.querySelector('.yaml-template-paths');
        const savedScrollPosition = existingContainer ? (existingContainer as HTMLElement).scrollTop : 0;
        
        // Remove any ghost elements or tooltips 
        document.querySelectorAll('.yaml-custom-tooltip--visible').forEach(el => el.remove());
        
        // Remove stale tooltip-related attributes
        document.querySelectorAll('[data-has-tooltip-listeners="true"]').forEach(el => {
            if (el instanceof HTMLElement) {
                delete el.dataset.hasTooltipListeners;
                delete el.dataset.tooltipId;
            }
        });
        
        // Clean up any existing tooltips first
        this.cleanupTooltips();
        
        const { containerEl } = this;
        containerEl.empty();
        
        // Apply settings-specific classes
        containerEl.addClass('yaml-settings-tab');
        
        containerEl.createEl('h2', { text: 'YAML Property Manager Settings' });
        
        // Template Paths Section
        containerEl.createEl('h3', { text: 'Template Paths' });
        
        const templatePathsContainer = containerEl.createDiv({ cls: 'yaml-template-paths' });
        
        // Display existing template paths in a hierarchical structure
        if (this.plugin.settings.templatePaths.length === 0) {
            templatePathsContainer.createEl('p', {
                text: 'No template paths configured. Add template files or directories below.',
                cls: 'yaml-settings-description'
            });
        } else {
            // Generate a tree structure of the templates
            this.renderTemplatePathsHierarchy(templatePathsContainer);
            
            // Restore the scroll position
            setTimeout(() => {
                templatePathsContainer.scrollTop = savedScrollPosition;
            }, 50);
        }
        
        // Single button to add templates - using Obsidian's native Setting API
        new Setting(containerEl)
            .setName('Template Selection')
            .setDesc('Browse and select template files or folders to use with YAML Property Manager')
            .addButton(button => button
                .setButtonText('Browse and Select Templates')
                .setCta()
                .onClick(() => {
                    new BrowserModal(
                        this.app, 
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
        );
        
        // Max recent templates
        new Setting(containerEl)
        .setName('Max Recent Templates')
        .setDesc('Maximum number of recent templates to remember')
        .addSlider(slider => {
            slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.maxRecentTemplates)
                .onChange(async (value) => {
                    this.plugin.settings.maxRecentTemplates = value;
                    // Trim the list if needed
                    if (this.plugin.settings.recentTemplates.length > value) {
                        this.plugin.settings.recentTemplates = 
                            this.plugin.settings.recentTemplates.slice(0, value);
                    }
                    await this.plugin.saveSettings();
                    
                    // Add a manual value display
                    const sliderEl = slider.sliderEl;
                    const valueDisplay = sliderEl.parentElement?.querySelector('.slider-value');
                    if (valueDisplay) {
                        valueDisplay.textContent = value.toString();
                    } else {
                        // Create a value display if it doesn't exist
                        const valueEl = document.createElement('div');
                        valueEl.className = 'slider-value';
                        valueEl.textContent = value.toString();
                        sliderEl.parentElement?.appendChild(valueEl);
                    }
                });
                
            // Create a value display right away
            const sliderEl = slider.sliderEl;
            const valueEl = document.createElement('div');
            valueEl.className = 'slider-value';
            valueEl.textContent = this.plugin.settings.maxRecentTemplates.toString();
            sliderEl.parentElement?.appendChild(valueEl);
            
            return slider;
        });
        
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

        // Add the reset button at the bottom
        this.addResetButton(containerEl);
        
        // Initialize scrollable status check
        setTimeout(() => {
            this.checkScrollableStatus();
        }, 100);
    }

    // Check if the container is scrollable and add appropriate class
    private checkScrollableStatus() {
        const container = document.querySelector('.yaml-template-paths');
        if (container) {
            // Check if the container is scrollable
            const isScrollable = container.scrollHeight > container.clientHeight;
            
            // Add or remove the is-scrollable class accordingly
            if (isScrollable) {
                container.classList.add('is-scrollable');
            } else {
                container.classList.remove('is-scrollable');
            }
        }
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
        
        // Render all tree nodes directly
        for (const child of this.rootNode.children) {
            this.renderNode(child, container, 0);
        }
        
        // Add an info message if no templates are configured
        if (this.rootNode.children.length === 0) {
            container.createEl('p', {
                text: 'No template paths configured. Add template files or directories below.',
                cls: 'yaml-settings-description'
            });
        }
        
        // Check scrollable status after rendering
        setTimeout(() => {
            this.checkScrollableStatus();
        }, 50);
    }

    // Render an individual node in the tree
    private renderNode(node: TreeNode, parentEl: HTMLElement, level: number = 0) {
        // Skip root node - render each child directly
        if (node === this.rootNode) {
            for (const child of node.children) {
                this.renderNode(child, parentEl, level);
            }
            return;
        }
        
        // Generate a unique ID for this node
        const nodeCounter = Math.floor(Math.random() * 10000);
        const nodeId = `template-node-${nodeCounter}`;
        const childrenId = `children-${nodeId}`;
        
        // Create node container with class
        const nodeEl = parentEl.createDiv({ 
            cls: 'yaml-template-node',
            attr: { 
                'data-node-id': nodeId,
                'aria-label': node.isDirectory ? `Folder: ${node.name}` : `File: ${node.name}`
            }
        });
        
        // Create the header with class
        const headerEl = nodeEl.createDiv({
            cls: node.isDirectory 
                ? 'yaml-template-node__header yaml-template-node__header--folder' 
                : 'yaml-template-node__header',
            attr: {
                'role': node.isDirectory ? 'button' : 'none',
                ...(node.isDirectory ? { 'aria-expanded': this.expandedPaths.has(node.path).toString() } : {})
            }
        });
        
        // Use inline style only for indentation level
        headerEl.style.paddingLeft = `${level * 20}px`;
        
        // Add folder/file icon with class
        const iconEl = headerEl.createSpan({ cls: 'yaml-template-node__icon' });
        
        // Use SVG icon directly
        const svgContent = this.getSvgIcon(node.isDirectory ? 
            (this.expandedPaths.has(node.path) ? 'folder-open' : 'folder-closed') : 'file');
        iconEl.innerHTML = svgContent;

        // Add name with class
        const nameEl = headerEl.createSpan({
            text: node.name,
            cls: 'yaml-template-node__name'
        });

        this.setupCustomTooltip(nameEl, node.name);

        // Create a span to hold the button
        const btnContainer = headerEl.createSpan({
            cls: 'yaml-template-node__actions'
        });

        // Create button with improved styling
        const removeButton = new ButtonComponent(btnContainer)
            .setButtonText('')
            .setIcon('trash-2')
            .setTooltip('Remove this template')
            .setClass('clickable-icon');

        // Set up the click handler
        removeButton.buttonEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeButton.setDisabled(true);
            try {
                await this.removeTemplateWithScrollPreservation(node.templatePathIndex, node, nodeEl);
            } catch (error) {
                console.error("Removal failed:", error);
            }
        });
        
        // If this is a directory node, add children container (even if empty)
        if (node.isDirectory) {
            // Create children container
            const childrenEl = nodeEl.createDiv({
                cls: 'yaml-template-node__children' + 
                    (this.expandedPaths.has(node.path) ? '' : ' yaml-template-node__children--collapsed'),
                attr: { 
                    'id': childrenId,
                    'role': 'group'
                }
            });
            
            // If expanded, either render children or show "Empty" message
            if (this.expandedPaths.has(node.path)) {
                if (node.children.length > 0) {
                    // Render all children immediately
                    for (const child of node.children) {
                        this.renderNode(child, childrenEl, 0);
                    }
                } else {
                    // Show empty message if folder is empty
                    const emptyMessage = childrenEl.createDiv({
                        cls: 'yaml-empty-folder-message'
                    });

                    // Add file icon
                    const iconSpan = emptyMessage.createSpan({
                        cls: 'yaml-empty-folder-message-icon'
                    });
                    iconSpan.innerHTML = this.getSvgIcon('file');

                    // Add text
                    emptyMessage.createSpan({
                        text: 'Empty folder'
                    });
                }
            }
            
            // Add expand/collapse handler to the header
            headerEl.addEventListener('click', (e) => {
                // Only toggle if not clicking a button or inside the button container
                if (!(e.target instanceof HTMLElement) || !e.target.closest('.yaml-template-node__actions')) {
                    const isCollapsed = childrenEl.hasClass('yaml-template-node__children--collapsed');
                    childrenEl.toggleClass('yaml-template-node__children--collapsed', !isCollapsed);
                    
                    // Update aria-expanded state
                    headerEl.setAttribute('aria-expanded', (!isCollapsed).toString());
                    
                    // Update icon
                    const newIsCollapsed = childrenEl.hasClass('yaml-template-node__children--collapsed');
                    const svgContent = this.getSvgIcon(newIsCollapsed ? 'folder-closed' : 'folder-open');
                    iconEl.empty();
                    iconEl.innerHTML = svgContent;
                    
                    // Update expanded paths
                    if (childrenEl.hasClass('yaml-template-node__children--collapsed')) {
                        this.expandedPaths.delete(node.path);
                    } else {
                        this.expandedPaths.add(node.path);
                        
                        // If the folder was previously collapsed and now expanded
                        if (childrenEl.childElementCount === 0) {
                            // Check if the folder actually has any files in the current template paths
                            const folderPrefix = node.path + '/';
                            const hasChildren = this.plugin.settings.templatePaths.some(tp => tp.path.startsWith(folderPrefix));
                            
                            if (hasChildren && node.children.length > 0) {
                                // Show a loading indicator briefly
                                const loadingEl = childrenEl.createDiv({
                                    cls: 'yaml-template-children-loading',
                                    text: 'Loading items...'
                                });
                                
                                // Render all children after a brief delay
                                setTimeout(() => {
                                    loadingEl.remove();
                                    
                                    // Render ALL children directly
                                    for (const child of node.children) {
                                        this.renderNode(child, childrenEl, level + 1);
                                    }
                                }, 50);
                            } else {
                                // Show empty message if folder is empty
                                const emptyMessage = childrenEl.createDiv({
                                    cls: 'yaml-empty-folder-message'
                                });

                                // Add file icon
                                const iconSpan = emptyMessage.createSpan({
                                    cls: 'yaml-empty-folder-message-icon'
                                });
                                iconSpan.innerHTML = this.getSvgIcon('file');

                                // Add text
                                emptyMessage.createSpan({
                                    text: 'Empty folder'
                                });
                            }
                        }
                    }
                    
                    // Save expanded paths to settings
                    this.saveExpandedPaths();
                }
            });
        }
    }

    // Helper to save expanded paths to settings
    private saveExpandedPaths(): void {
        this.plugin.settings.expandedTemplatePaths = Array.from(this.expandedPaths);
        this.plugin.saveSettings();
    }

    // Helper method for SVG icons
    private getSvgIcon(type: 'folder-closed' | 'folder-open' | 'file'): string {
        if (type === 'folder-closed') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder-closed"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path><path d="M2 10h20"></path></svg>';
        } else if (type === 'folder-open') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder-open"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"></path></svg>';
        } else {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg>';
        }
    }

    private setupCustomTooltip(element: HTMLElement, tooltipText: string) {
        try {
            // Remove titles from element
            this.removeAllTitles(element);
            
            // Check for existing tooltip
            const existingTooltipIndex = this.tooltips.findIndex(t => t.element === element);
            if (existingTooltipIndex >= 0) {
                const existingTooltip = this.tooltips[existingTooltipIndex].tooltip;
                existingTooltip.remove();
                this.tooltips.splice(existingTooltipIndex, 1);
            }
            
            // Create tooltip element
            const tooltip = document.createElement('div');
            tooltip.addClass('yaml-custom-tooltip');
            tooltip.textContent = tooltipText;
            tooltip.setAttribute('role', 'tooltip');
            tooltip.setAttribute('aria-hidden', 'true');
            
            // Generate unique ID
            const uniqueId = `tooltip-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            element.setAttribute('aria-describedby', uniqueId);
            tooltip.id = uniqueId;
            
            // Store reference for cleanup
            this.tooltips.push({element, tooltip});
            
            // Helper to show tooltip
            const showTooltip = () => {
                // Re-remove titles
                this.removeAllTitles(element);
                
                // Hide any other visible tooltips
                this.hideAllTooltips();
                
                // Add to DOM when showing
                if (!tooltip.parentNode) {
                    document.body.appendChild(tooltip);
                }
                
                // Calculate position
                const rect = element.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;
                
                // Position horizontally
                tooltip.style.left = `${Math.min(rect.left, viewportWidth - 250)}px`;
                
                // Position vertically - prefer below but go above if not enough space
                const tooltipHeight = 40; // Approximate height before rendering
                const spaceBelow = viewportHeight - rect.bottom;
                
                if (spaceBelow >= tooltipHeight) {
                    // Position below
                    tooltip.style.top = `${rect.bottom + 5}px`;
                } else {
                    // Position above
                    tooltip.style.top = `${rect.top - tooltipHeight - 5}px`;
                }
                
                // Make visible
                tooltip.addClass('yaml-custom-tooltip--visible');
                tooltip.setAttribute('aria-hidden', 'false');
                
                // Adjust position after rendering if needed
                setTimeout(() => {
                    const tooltipRect = tooltip.getBoundingClientRect();
                    
                    // Adjust horizontal position if clipped
                    if (tooltipRect.right > viewportWidth) {
                        tooltip.style.left = `${viewportWidth - tooltipRect.width - 10}px`;
                    }
                    
                    // Adjust vertical position if clipped
                    if (tooltipRect.bottom > viewportHeight) {
                        tooltip.style.top = `${rect.top - tooltipRect.height - 5}px`;
                    }
                    
                    if (tooltipRect.top < 0) {
                        tooltip.style.top = `${rect.bottom + 5}px`;
                    }
                }, 0);
            };
            
            // Helper to hide tooltip
            const hideTooltip = () => {
                tooltip.removeClass('yaml-custom-tooltip--visible');
                tooltip.setAttribute('aria-hidden', 'true');
                
                // Remove from DOM after animation
                setTimeout(() => {
                    if (tooltip.parentNode && !tooltip.hasClass('yaml-custom-tooltip--visible')) {
                        tooltip.remove();
                    }
                }, 200);
            };
            
            // Setup observer to prevent title attributes from being added
            this.setupTitleObserver(element);
            
            // Clean up existing listeners
            const newElement = this.removeExistingListeners(element);
            
            // Add event listeners to the (possibly new) element
            newElement.addEventListener('mouseenter', showTooltip);
            newElement.addEventListener('mouseleave', hideTooltip);
            newElement.addEventListener('touchstart', showTooltip, { passive: true });
            
            // Add data attributes for CSS targeting
            newElement.dataset.hasTooltipListeners = 'true';
            newElement.dataset.tooltipId = uniqueId;
            
            // Ensure the global scroll handler exists
            if (!this.hasScrollHandler) {
                document.addEventListener('scroll', this.hideAllTooltips.bind(this), { passive: true });
                this.hasScrollHandler = true;
            }
            
            // Return the possibly new element
            return newElement;
        } catch (error) {
            console.error('Error setting up tooltip:', error);
            return element;
        }
    }

    private removeAllTitles(element: HTMLElement) {
        // Remove title from element
        element.removeAttribute('title');
        element.removeAttribute('aria-label');
        element.removeAttribute('data-tooltip');
        
        // Remove from all parent elements up to 5 levels
        let parent = element.parentElement;
        let depth = 0;
        while (parent && depth < 5) {
            parent.removeAttribute('title');
            parent.removeAttribute('aria-label');
            parent.removeAttribute('data-tooltip');
            parent = parent.parentElement;
            depth++;
        }
        
        // Remove from all child elements
        const children = element.querySelectorAll('*');
        children.forEach(child => {
            if (child instanceof HTMLElement) {
                child.removeAttribute('title');
                child.removeAttribute('aria-label');
                child.removeAttribute('data-tooltip');
            }
        });
    }

    private setupTitleObserver(element: HTMLElement) {
        // Clean up existing observer
        if (this.titleObservers && this.titleObservers.has(element)) {
            this.titleObservers.get(element)?.disconnect();
            this.titleObservers.delete(element);
        }
        
        // Create new observer
        const titleObserver = new MutationObserver((mutations) => {
            let needsCleanup = false;
            
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && 
                   (mutation.attributeName === 'title' || 
                    mutation.attributeName === 'aria-label' ||
                    mutation.attributeName === 'data-tooltip')) {
                    needsCleanup = true;
                }
            });
            
            if (needsCleanup) {
                this.removeAllTitles(element);
            }
        });
        
        // Start observing
        titleObserver.observe(element, {
            attributes: true,
            attributeFilter: ['title', 'aria-label', 'data-tooltip']
        });
        
        // Store for cleanup
        if (!this.titleObservers) this.titleObservers = new Map();
        this.titleObservers.set(element, titleObserver);
    }

    private removeExistingListeners(element: HTMLElement) {
        // If already has listeners, clone and replace to remove them
        if (element.dataset.hasTooltipListeners === 'true') {
            const parent = element.parentNode;
            if (parent) {
                const clone = element.cloneNode(true) as HTMLElement;
                clone.textContent = element.textContent;
                
                // Copy over dataset properties
                Object.keys(element.dataset).forEach(key => {
                    if (key !== 'hasTooltipListeners' && key !== 'tooltipId') {
                        clone.dataset[key] = element.dataset[key] || '';
                    }
                });
                
                // Replace the element
                parent.replaceChild(clone, element);
                
                // Return the new element
                return clone;
            }
        }
        return element;
    }

    private hideAllTooltips() {
        this.tooltips.forEach(({tooltip}) => {
            tooltip.removeClass('yaml-custom-tooltip--visible');
            tooltip.setAttribute('aria-hidden', 'true');
            
            // Remove from DOM to reduce elements
            setTimeout(() => {
                if (tooltip.parentNode && !tooltip.hasClass('yaml-custom-tooltip--visible')) {
                    tooltip.remove();
                }
            }, 200);
        });
    }

    private cleanupTooltips() {
        // First hide all tooltips
        this.hideAllTooltips();
        
        // Then clean up each tooltip and its associated element
        this.tooltips.forEach(({element, tooltip}) => {
            // Remove the tooltip element
            if (tooltip.parentNode) {
                tooltip.remove();
            }
            
            // Remove attributes from the element
            if (element) {
                element.removeAttribute('aria-describedby');
                
                // Clear dataset properties
                if (element.dataset) {
                    delete element.dataset.hasTooltipListeners;
                    delete element.dataset.tooltipId;
                }
            }
            
            // Disconnect any observers
            if (this.titleObservers && this.titleObservers.has(element)) {
                const observer = this.titleObservers.get(element);
                if (observer) {
                    observer.disconnect();
                    this.titleObservers.delete(element);
                }
            }
        });
        
        // Clear the tooltips array
        this.tooltips = [];
    }

    private addResetButton(containerEl: HTMLElement) {
        const resetContainer = containerEl.createDiv({ cls: 'template-paths-reset-container' });
        
        resetContainer.createEl('h3', { text: 'Troubleshooting' });
        
        // Existing Reset Template Paths button
        new Setting(resetContainer)
            .setName('Reset Template Paths')
            .setDesc('If you experience issues with template paths not being removed correctly, use this button to reset all template paths.')
            .addButton(button => button
                .setButtonText('Reset All Template Paths')
                .setWarning()
                .onClick(async () => {
                    const confirmed = await new Promise<boolean>(resolve => {
                        const modal = new Modal(this.app);
                        modal.titleEl.setText('Confirm Reset');
                        
                        const content = modal.contentEl.createDiv();
                        content.setText('Are you sure you want to reset all template paths? This cannot be undone.');
                        
                        const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
                        
                        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
                        cancelButton.addEventListener('click', () => {
                            modal.close();
                            resolve(false);
                        });
                        
                        const confirmButton = buttonContainer.createEl('button', { 
                            text: 'Reset All Paths',
                            cls: 'mod-warning'
                        });
                        confirmButton.addEventListener('click', () => {
                            modal.close();
                            resolve(true);
                        });
                        
                        modal.open();
                    });
                    
                    if (confirmed) {
                        // Reset all template paths
                        this.plugin.settings.templatePaths = [];
                        await this.plugin.saveSettings();
                        new Notice('All template paths have been reset');
                        this.display();
                    }
                })
            );
        
        // Add new Reload Plugin button
        new Setting(resetContainer)
            .setName('Reload Plugin')
            .setDesc('Reload the plugin if you encounter issues or changes are not being applied correctly.')
            .addButton(button => button
                .setButtonText('Reload Plugin')
                .onClick(async () => {
                    await this.plugin.reloadPlugin();
                })
            );
    } 


    public cleanup() {
        this.cleanupTooltips();
        
        // Clean up global scroll handler
        if (this.hasScrollHandler) {
            document.removeEventListener('scroll', this.hideAllTooltips.bind(this));
            this.hasScrollHandler = false;
        }
        
        // Disconnect all remaining observers
        if (this.titleObservers) {
            this.titleObservers.forEach(observer => observer.disconnect());
            this.titleObservers.clear();
        }
    }
}