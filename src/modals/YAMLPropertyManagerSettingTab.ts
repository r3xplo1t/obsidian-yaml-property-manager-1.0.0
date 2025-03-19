import { App, PluginSettingTab, Setting, TFile, TFolder, Notice, ButtonComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { BrowserModal } from './BrowserModal'; // Changed from TemplateFileSelectorModal
import { TreeNode } from '../models/interfaces';

export class YAMLPropertyManagerSettingTab extends PluginSettingTab {
    plugin: YAMLPropertyManagerPlugin;

    constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private expandedPaths: Set<string> = new Set();

    private async removeTemplateWithScrollPreservation(templatePathIndex: number | undefined, node: TreeNode): Promise<void> {
        // Find the template paths container
        const templatePathsContainer = document.querySelector('.yaml-template-paths');
        let scrollTop = 0;
        
        // Save scroll position if container exists
        if (templatePathsContainer) {
            scrollTop = templatePathsContainer.scrollTop;
        }
        
        if (templatePathIndex !== undefined) {
            // Direct template path
            this.plugin.settings.templatePaths.splice(templatePathIndex, 1);
        } else {
            // Find all child templates
            const pathPrefix = node.path + '/';
            const indicesToRemove: number[] = [];
            
            this.plugin.settings.templatePaths.forEach((tp, index) => {
                if (tp.path === node.path || tp.path.startsWith(pathPrefix)) {
                    indicesToRemove.push(index);
                }
            });
            
            // Remove in reverse order
            for (let i = indicesToRemove.length - 1; i >= 0; i--) {
                this.plugin.settings.templatePaths.splice(indicesToRemove[i], 1);
            }
        }
        
        // Save settings
        await this.plugin.saveSettings();
        
        // Refresh display
        this.display();
        
        // Restore scroll position after a small delay to ensure DOM is updated
        setTimeout(() => {
            const newTemplatePathsContainer = document.querySelector('.yaml-template-paths');
            if (newTemplatePathsContainer) {
                newTemplatePathsContainer.scrollTop = scrollTop;
            }
        }, 10);
    }

    display(): void {
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
        }
        
        // Single button to add templates - using Obsidian's native Setting API
        const templateButtonSetting = new Setting(containerEl)
            .setName('Template Selection')
            .setDesc('Browse and select template files or folders to use with YAML Property Manager')
            .addButton(button => button
                .setButtonText('Browse and Select Templates')
                .setCta() // This applies Obsidian's call-to-action styling
                .onClick(() => {
                    new BrowserModal(
                        this.app, 
                        async (result) => {
                            // Process selected files and folders
                            let countAdded = 0;
                            
                            // Debug logging
                console.log('Processing selection result:');
                console.log('- Files:', result.files.map(f => f.path));
                console.log('- Folders:', result.folders.map(f => f.path));
                
                // Add individual files
                for (const file of result.files) {
                    // Check if already exists
                    const alreadyExists = this.plugin.settings.templatePaths.some(
                        tp => tp.type === 'file' && tp.path === file.path
                    );
                    
                    if (!alreadyExists) {
                        this.plugin.settings.templatePaths.push({
                            type: 'file',
                            path: file.path,
                            includeSubdirectories: true // Always include subdirectories
                        });
                        countAdded++;
                        console.log(`Added file to template paths: ${file.path}`);
                    } else {
                        console.log(`File already exists in template paths: ${file.path}`);
                    }
                }
                
                // Add folders
                for (const folder of result.folders) {
                    // Check if already exists
                    const alreadyExists = this.plugin.settings.templatePaths.some(
                        tp => tp.type === 'directory' && tp.path === folder.path
                    );
                    
                    if (!alreadyExists) {
                        this.plugin.settings.templatePaths.push({
                            type: 'directory',
                            path: folder.path,
                            includeSubdirectories: true // Always include subdirectories
                        });
                        countAdded++;
                        console.log(`Added folder to template paths: ${folder.path}`);
                    } else {
                        console.log(`Folder already exists in template paths: ${folder.path}`);
                    }
                }
                
                // Save settings and refresh
                if (countAdded > 0) {
                    await this.plugin.saveSettings();
                    new Notice(`Added ${countAdded} template source${countAdded !== 1 ? 's' : ''}`);
                    this.display(); // Refresh view
                } else if (result.files.length > 0 || result.folders.length > 0) {
                    new Notice('All selected templates were already in your list');
                }
                
                // Debug current template paths after update
                console.log('Current template paths:');
                this.plugin.settings.templatePaths.forEach((path, index) => {
                    console.log(`${index}: ${path.type} - ${path.path}`);
                });
            },
            {
                title: "Select Template Files and Directories",
                description: "Select files to use as templates, or select entire directories. Check the box to include a file or folder.",
                confirmButtonText: "Add Selected Files & Folders",
                existingPathsToHighlight: this.plugin.settings.templatePaths
            }
        ).open();
    })
);
        
        // Max recent templates
        new Setting(containerEl)
            .setName('Max Recent Templates')
            .setDesc('Maximum number of recent templates to remember')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.maxRecentTemplates)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxRecentTemplates = value;
                    // Trim the list if needed
                    if (this.plugin.settings.recentTemplates.length > value) {
                        this.plugin.settings.recentTemplates = 
                            this.plugin.settings.recentTemplates.slice(0, value);
                    }
                    await this.plugin.saveSettings();
                }));
        
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
    }

    // Render template paths as a hierarchy
    renderTemplatePathsHierarchy(container: HTMLElement) {
        // Clear the container first
        container.empty();
        
        console.log('Rendering template paths hierarchy:');
        console.log('Template paths in settings:', this.plugin.settings.templatePaths);
        
        // First, build a hierarchical tree structure
        const rootNode: TreeNode = {
            name: this.app.vault.getName(),
            path: '',
            isDirectory: true,
            children: []
        };
        
        // Add debug code - List all top-level paths
        console.log("Top-level template paths:");
        this.plugin.settings.templatePaths.forEach(tp => {
            if (!tp.path.includes('/')) {
                console.log(`  Top-level path: ${tp.type} - ${tp.path}`);
            }
        });
        
        // Helper to find or create a node for a path
        const getNodeForPath = (path: string, isDirectory: boolean): TreeNode => {
            if (path === '') return rootNode;
            
            const parts = path.split('/');
            let currentNode = rootNode;
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
        sortTreeNodes(rootNode.children);
        
        // Create a unique ID for each node
        let nodeCounter = 0;
        
        // Simple recursive render function that uses data attributes for connections
        const renderNode = (node: TreeNode, parentEl: HTMLElement, level: number = 0) => {
            if (node === rootNode) {
                // Root node - render each child directly
                console.log("Rendering root node children:", node.children.map(c => c.path));
                
                for (const child of node.children) {
                    // Render all child nodes without exception
                    renderNode(child, parentEl, level);
                }
                return;
            }
            
            // Generate a unique ID for this node
            const nodeId = `template-node-${nodeCounter++}`;
            const childrenId = `children-${nodeId}`;
            
            // Create node container with class
            const nodeEl = parentEl.createDiv({ 
                cls: 'yaml-template-node',
                attr: { 'data-node-id': nodeId }
            });
            
            // Create the header with class
            const headerEl = nodeEl.createDiv({
                cls: node.isDirectory 
                    ? 'yaml-template-node__header yaml-template-node__header--folder' 
                    : 'yaml-template-node__header'
            });
            
            // Use inline style only for indentation level
            headerEl.style.paddingLeft = `${level * 20}px`;
            
            // Add folder/file icon with class
            const iconEl = headerEl.createSpan({ cls: 'yaml-template-node__icon' });
            iconEl.textContent = node.isDirectory ? '📁 ' : '📄 ';
            
            // Add name with class
            const nameEl = headerEl.createSpan({
                text: node.name,
                cls: 'yaml-template-node__name'
            });
            
            // Create a span to hold the button
            const btnContainer = headerEl.createSpan({
                cls: 'yaml-template-node__actions'
            });
        
            // Keep track of button clicks to prevent accidental double processing
            let processingClick = false;
        
            // Create Obsidian's native button with improved event handling
            new ButtonComponent(btnContainer)
                .setButtonText('Remove')
                .setTooltip('Remove this template')
                .onClick(async (e) => {
                    // Add additional measures to ensure the event is fully captured and not propagated
                    e.stopPropagation();
                    e.preventDefault();
        
                    // Prevent double-processing if already handling a click
                    if (processingClick) return;
                    processingClick = true;
        
                    try {
                        await this.removeTemplateWithScrollPreservation(node.templatePathIndex, node);
                    } finally {
                        processingClick = false;
                    }
                });
            
            // If this is a directory node, add children container
            if (node.isDirectory && node.children.length > 0) {
                // Create children container (initially collapsed with class)
                const childrenEl = nodeEl.createDiv({
                    cls: 'yaml-template-node__children yaml-template-node__children--collapsed',
                    attr: { 'id': childrenId }
                });
                
                // Check if this node path is in our expanded paths set
                if (this.expandedPaths.has(node.path)) {
                    childrenEl.removeClass('yaml-template-node__children--collapsed');
                    iconEl.textContent = '📂 '; // Show as expanded
                }
                
                // Add expand/collapse handler to the header
                headerEl.addEventListener('click', (e) => {
                    // Only toggle if not clicking a button or inside the button container
                    if (!(e.target instanceof HTMLElement) || !e.target.closest('.yaml-template-node__actions')) {
                        const isCollapsed = childrenEl.hasClass('yaml-template-node__children--collapsed');
                        childrenEl.toggleClass('yaml-template-node__children--collapsed', !isCollapsed);
                        
                        // Update icon
                        iconEl.textContent = childrenEl.hasClass('yaml-template-node__children--collapsed') ? '📁 ' : '📂 ';
                        
                        // Update our expanded paths tracking
                        if (childrenEl.hasClass('yaml-template-node__children--collapsed')) {
                            this.expandedPaths.delete(node.path);
                        } else {
                            this.expandedPaths.add(node.path);
                        }
                    }
                });
                
                // Render children
                for (const child of node.children) {
                    renderNode(child, childrenEl, level + 1);
                }
            }
        };
        
        // Render the entire tree
        renderNode(rootNode, container);
        
        // Add an info message if no templates are configured
        if (rootNode.children.length === 0) {
            container.createEl('p', {
                text: 'No template paths configured. Add template files or directories below.',
                cls: 'yaml-settings-description'
            });
        }
    }
}