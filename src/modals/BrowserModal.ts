// BrowserModal.ts
import { App, Modal, TFile, TFolder, Setting, setIcon, Plugin, normalizePath } from 'obsidian';
import { TreeNode } from '../interfaces';
import { findNextFocusableElement, findPrevFocusableElement } from '../commonHelpers';

export interface BrowserModalResult {
    files: TFile[], 
    folders: TFolder[], 
    folderSettings: Map<string, boolean>,
    removedFilePaths: string[],
    removedFolderPaths: string[]
}

export class BrowserModal extends Modal {
    private plugin: Plugin;
    onSelect: (result: BrowserModalResult) => void;
    selectedFiles: TFile[] = [];
    selectedFolders: TFolder[] = [];
    folderSettings: Map<string, boolean> = new Map();
    initialSelectedFilePaths: string[] = [];
    initialSelectedFolderPaths: string[] = [];
    singleFileSelectionMode: boolean = false;
    title: string = "Select files and folders";
    description: string = "Select files or folders to use.";
    confirmButtonText: string = "Confirm selection";
    expandedFolders: Set<string> = new Set();
    
    // New property for tree structure
    private rootNode!: TreeNode;

    constructor(
        app: App,
        plugin: Plugin, // Add this parameter
        onSelect: (result: BrowserModalResult) => void,
        options: {
            existingPathsToHighlight?: {type: string, path: string}[],
            singleFileSelectionMode?: boolean,
            title?: string,
            description?: string,
            confirmButtonText?: string
        } = {}
    ) {
        super(app);
        this.plugin = plugin; // Store the plugin reference
        this.onSelect = onSelect;
        
        // Set optional configurations
        if (options.existingPathsToHighlight) {
            // Store initial selection paths
            this.initialSelectedFilePaths = options.existingPathsToHighlight
                .filter(tp => tp.type === 'file')
                .map(tp => tp.path);
            this.initialSelectedFolderPaths = options.existingPathsToHighlight
                .filter(tp => tp.type === 'directory')
                .map(tp => tp.path);
        }
        if (options.singleFileSelectionMode !== undefined) this.singleFileSelectionMode = options.singleFileSelectionMode;
        if (options.title) this.title = options.title;
        if (options.description) this.description = options.description;
        if (options.confirmButtonText) this.confirmButtonText = options.confirmButtonText;
    }

    // Handle keyboard navigation
    private handleKeyDown(e: KeyboardEvent) {
        // If Escape key, close the modal
        if (e.key === 'Escape') {
            this.close();
            return;
        }
        
        // If Enter key on a focused element
        if (e.key === 'Enter') {
            const focused = activeDocument.activeElement;
            if (focused && focused.classList.contains('tree-item-self')) {
                // Simulate click on focused item
                (focused as HTMLElement).click();
            }
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('yaml-property-manager-modal');

        // Set title and instructions using Setting component
        new Setting(contentEl)
            .setName(this.title)
            .setHeading();
        
        new Setting(contentEl)
            .setDesc(this.description);
        
        // Initialize selection from existing paths  
        this.selectedFiles = [];
        this.selectedFolders = [];
                
        // Load files and folders from initial paths
        for (const filePath of this.initialSelectedFilePaths) {
            const file = this.app.vault.getFileByPath(normalizePath(filePath));
            if (file && file instanceof TFile) {
                this.selectedFiles.push(file);
            }
        }

        for (const folderPath of this.initialSelectedFolderPaths) {
            const normalizedFolderPath = normalizePath(folderPath);
            const folder = this.app.vault.getFolderByPath(normalizedFolderPath);
            if (folder && folder instanceof TFolder) {
                this.selectedFolders.push(folder);
                this.folderSettings.set(normalizedFolderPath, true);
            }
        }

        // Reconcile: if a saved folder's children are no longer fully selected
        // (e.g. a file was removed from settings after the folder was saved),
        // demote it from selectedFolders so the checkbox shows "−" instead of "✓".
        this.selectedFolders = this.selectedFolders.filter(folder => {
            if (this.areAllChildrenSelected(folder)) return true;
            this.folderSettings.delete(folder.path);
            return false;
        });

        // Ensure all folder selections are properly set based on child selections
        this.ensureAllFolderSelections();
        
        // Selection counter
        const selectionCountEl = contentEl.createDiv({ cls: 'selection-counter' });
        const countTextSpan = selectionCountEl.createSpan({ cls: 'selection-text' });
        selectionCountEl.createSpan({ cls: 'selection-warning', text: 'No .md files in the current selection.' });
        this.updateSelectionCount(countTextSpan);
        
        // File tree container - change class name
        const fileTreeContainer = contentEl.createDiv({ cls: 'file-tree-container' });
        
        // Build and render the file tree
        this.buildFileTree();
        this.renderFileTree(fileTreeContainer, countTextSpan);
        
        // Button container
        const buttonContainer = this.modalEl.createDiv({ cls: 'modal-button-container' });

        // Confirm button
        const confirmButton = buttonContainer.createEl('button', {
            text: this.confirmButtonText,
            cls: 'mod-cta',
            attr: { type: 'button' }
        });

        // Initial state
        confirmButton.disabled = this.singleFileSelectionMode ?
            this.selectedFiles.length !== 1 :
            !this.hasResolvableMdFiles();

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel',
            attr: { type: 'button' }
        });
        
        // Register event handlers with proper cleanup
        this.plugin.registerDomEvent(cancelButton, 'click', () => {
            this.close();
        });
        
        this.plugin.registerDomEvent(confirmButton, 'click', () => {
            // Track which initially selected items were removed
            const removedFilePaths = this.initialSelectedFilePaths.filter(
                path => !this.selectedFiles.some(f => f.path === path)
            );
            
            const removedFolderPaths = this.initialSelectedFolderPaths.filter(
                path => !this.selectedFolders.some(f => f.path === path)
            );
            
            this.onSelect({
                files: this.selectedFiles,
                folders: this.selectedFolders,
                folderSettings: this.folderSettings,
                removedFilePaths: removedFilePaths,
                removedFolderPaths: removedFolderPaths
            });
            this.close();
        });
        
        // Register keyboard event handler
        this.plugin.registerDomEvent(contentEl, 'keydown', this.handleKeyDown.bind(this));
    }

    // Build hierarchical tree structure
    private buildFileTree() {
        // Initialize root node
        this.rootNode = {
            name: this.app.vault.getName(),
            path: '',
            isDirectory: true,
            children: []
        };
        
        // Get all markdown files and folders
        const allFiles = this.app.vault.getMarkdownFiles();
        const allFolders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && !file.path.startsWith('.'));
        
        // Sort folders by path length to process parent folders first
        allFolders.sort((a, b) => a.path.length - b.path.length);
        
        // Add all folders to the tree
        for (const folder of allFolders) {
            if (folder.path === '') continue; // Skip root
            
            this.addNodeToTree(this.rootNode, folder.path, folder.name, true);
        }
        
        // Add all files to the tree
        for (const file of allFiles) {
            this.addNodeToTree(this.rootNode, file.path, file.name, false);
        }
        
        // Sort all nodes
        this.sortTreeNodes(this.rootNode.children);
    }

    // Helper to filter out invalid nodes (e.g., empty names)
    private filterInvalidNodes(node: TreeNode): boolean {
        // Filter children recursively
        node.children = node.children.filter(child => {
            // Remove nodes with empty names
            if (!child.name || !child.name.trim()) {
                return false;
            }
            
            // Recursively filter children
            return this.filterInvalidNodes(child);
        });
        
        return true;
    }

    // Helper to add a node to the tree
    private addNodeToTree(root: TreeNode, path: string, _name: string, isDirectory: boolean) {
        const parts = path.split('/').filter(part => part.trim() !== ''); // Filter out empty parts
        let currentNode = root;
        let currentPath = '';
        
        // Navigate/create the path structure
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            // Skip empty parts
            if (!part || !part.trim()) continue;
            
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLastPart = i === parts.length - 1;
            
            // Look for existing node
            let found = currentNode.children.find(c => c.name === part);
            
            if (!found) {
                // Create a new node
                const newNode: TreeNode = {
                    name: part,
                    path: currentPath,
                    isDirectory: isLastPart ? isDirectory : true,
                    children: []
                };
                
                currentNode.children.push(newNode);
                found = newNode;
            }
            
            currentNode = found;
        }
    }
    

    // Sort helper for tree nodes
    private sortTreeNodes(nodes: TreeNode[]) {
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
                this.sortTreeNodes(node.children);
            }
        }
    }

    // Render file tree based on tree structure
    private renderFileTree(container: HTMLElement, countTextSpan: HTMLElement) {
        // Clear the container first
        container.empty();
        
        // Create a tree container
        const treeRoot = container.createDiv({ cls: 'tree-item nav-folder mod-root' });
        
        // Filter and render only valid children
        const validChildren = this.rootNode.children.filter(child => 
            child && child.name && child.name.trim() !== ''
        );
        
        // Render the tree starting with the valid root's children
        for (const child of validChildren) {
            this.renderTreeItem(treeRoot, child, countTextSpan);
        }
        
        // Add an info message if no items are available
        if (validChildren.length === 0) {
            const emptyState = container.createDiv({
                cls: 'nav-empty-state'  // This is already an Obsidian native class
            });
            
            emptyState.createSpan({
                text: 'No files or folders found.',
                cls: 'nav-empty-state-text'  // Also an Obsidian native class
            });
        }
    }

    private renderTreeItem(parentEl: HTMLElement, node: TreeNode, countTextSpan: HTMLElement) {
        // Create a tree item container
        const itemEl = parentEl.createDiv({ 
            cls: 'tree-item ' + (node.isDirectory ? 'nav-folder' : 'nav-file'),
            attr: { 'data-path': node.path }
        });
        
        // Track if this item is selected
        const isSelected = node.isDirectory 
            ? this.selectedFolders.some(f => f.path === node.path)
            : this.selectedFiles.some(f => f.path === node.path);
        
        // Track if item was initially selected
        const wasInitiallySelected = node.isDirectory
            ? this.initialSelectedFolderPaths.includes(node.path)
            : this.initialSelectedFilePaths.includes(node.path);
        
        if (wasInitiallySelected) {
            itemEl.addClass('initially-selected');
        }
        
        if (isSelected) {
            itemEl.addClass('is-selected');
        }
        
        // Check for indeterminate state for folders
        let isIndeterminate = false;
        if (node.isDirectory && !isSelected) {
            const folder = this.app.vault.getFolderByPath(node.path);
            if (folder) {
                isIndeterminate = this.hasIndeterminateSelection(folder);
                if (isIndeterminate) {
                    itemEl.addClass('is-partially-selected');
                }
            }
        }
        
        // Create the self (clickable title area)
        const selfEl = itemEl.createDiv({ 
            cls: 'tree-item-self ' + (node.isDirectory ? 'mod-collapsible' : ''),
            attr: {
                'aria-label': node.isDirectory 
                    ? `Folder: ${node.name}, ${isSelected ? 'Selected' : isIndeterminate ? 'Partially selected' : 'Not selected'}`
                    : `File: ${node.name}, ${isSelected ? 'Selected' : 'Not selected'}`,
                'data-path': node.path,
                'tabindex': '0',
                'role': node.isDirectory ? 'button' : 'listitem',
                ...(node.isDirectory ? { 
                    'aria-expanded': this.expandedFolders.has(node.path).toString(),
                    'aria-controls': `children-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}` 
                } : {})
            }
        });
        
        // Add collapse indicator for directories (ONLY the triangle arrow, no folder icon)
        if (node.isDirectory) {
            const collapseIconEl = selfEl.createDiv({ cls: 'tree-item-icon collapse-icon' });
            setIcon(collapseIconEl, 'right-triangle');
            
            if (!this.expandedFolders.has(node.path)) {
                collapseIconEl.addClass('is-collapsed');
            }
        }
        
        // Add the main content
        const innerEl = selfEl.createDiv({ cls: 'tree-item-inner' });
        innerEl.createSpan({ 
            text: node.name,
            cls: 'tree-item-inner-text'
        });
        
        // Add checkbox for selection at the END of the tree item
        if (!this.singleFileSelectionMode || !node.isDirectory) {
            // Create checkbox container at the end
            const checkboxContainer = selfEl.createDiv({ cls: 'tree-item-checkbox-container' });
            
            // Create custom checkbox element (using actual checkbox for accessibility)
            const checkbox = checkboxContainer.createEl('input', {
                type: 'checkbox',
                cls: 'tree-item-checkbox custom-styled-checkbox', // Add a new class
                attr: {
                    'checked': isSelected ? 'checked' : '',
                    'aria-label': `Select ${node.name}`,
                    'tabindex': '-1',
                    'data-indeterminate': isIndeterminate ? 'true' : 'false' // Add data attribute
                }
            });
            
            // Set initial checkbox state
            checkbox.checked = isSelected;
            
            // Handle indeterminate state for folders
            if (node.isDirectory && isIndeterminate) {
                checkbox.indeterminate = true;
            }
            
            // Add change handler
            this.plugin.registerDomEvent(checkbox, 'change', () => {
                if (node.isDirectory) {
                    this.handleFolderSelection(node, checkbox.checked, itemEl);
                } else {
                    this.handleFileSelection(node, checkbox.checked, itemEl);
                }
                
                // Update the selection count
                this.updateSelectionCount(countTextSpan);
                
                // Update all visible toggles
                this.updateVisibleCheckboxes();
            });
        }
        
        // For directories, create children container
        if (node.isDirectory) {
            const childrenId = `children-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const childrenEl = itemEl.createDiv({ 
                cls: 'tree-item-children',
                attr: {
                    'id': childrenId,
                    'role': 'group',
                    'aria-label': `${node.name} contents`
                }
            });
            
            // Hide if not expanded
            if (!this.expandedFolders.has(node.path)) {
                childrenEl.hide();
            }
            
            // Add click handler for expansion toggling
            this.plugin.registerDomEvent(selfEl, 'click', (e: MouseEvent) => {
                // Only process clicks that aren't on the checkbox
                const clickTarget = e.target as Node | null;
                if (!clickTarget?.instanceOf(HTMLElement) ||
                    !(e.target as HTMLElement).closest('.tree-item-checkbox-container') &&
                    !(e.target as HTMLElement).classList.contains('tree-item-checkbox')) {
                    
                    // Toggle expanded state
                    const isExpanded = this.expandedFolders.has(node.path);
                    
                    if (isExpanded) {
                            // Collapse folder
                            this.expandedFolders.delete(node.path);
                            childrenEl.hide();
                            selfEl.setAttribute('aria-expanded', 'false');
                            const collapseIcon = selfEl.querySelector('.collapse-icon');
                            if (collapseIcon) {
                                collapseIcon.addClass('is-collapsed');
                            }
                        } else {
                            // Expand folder
                            this.expandedFolders.add(node.path);
                            childrenEl.show();
                            selfEl.setAttribute('aria-expanded', 'true');
                            const collapseIcon = selfEl.querySelector('.collapse-icon');
                            if (collapseIcon) {
                                collapseIcon.removeClass('is-collapsed');
                            }
                        
                        // Lazy load children if needed
                        if (childrenEl.childElementCount === 0 && node.children.length > 0) {
                            for (const child of node.children) {
                                this.renderTreeItem(childrenEl, child, countTextSpan);
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
                }
            });
            
            // Add keyboard handler for folder
            this.plugin.registerDomEvent(selfEl, 'keydown', (e: KeyboardEvent) => {
                this.handleItemKeyDown(e, node, selfEl, childrenEl);
            });
            
            // Render children if expanded initially
            if (this.expandedFolders.has(node.path)) {
                if (node.children.length > 0) {
                    for (const child of node.children) {
                        this.renderTreeItem(childrenEl, child, countTextSpan);
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
        } else {
            // Add keyboard handler for file
            this.plugin.registerDomEvent(selfEl, 'keydown', (e: KeyboardEvent) => {
                this.handleItemKeyDown(e, node, selfEl);
            });
        }
    }

    // Handle folder selection toggle
    private handleFolderSelection(node: TreeNode, isSelected: boolean, itemEl: HTMLElement) {
        const folder = this.app.vault.getFolderByPath(node.path);
        if (!folder) return;
        
        if (isSelected) {
            // Add to selection if not already selected
            if (!this.selectedFolders.some(f => f.path === node.path)) {
                this.selectedFolders.push(folder);
                this.folderSettings.set(node.path, true);
                itemEl.addClass('is-selected');
                itemEl.removeClass('is-partially-selected');
            }
            
            // Select all children
            this.selectAllChildren(folder);
            
            // Check if this completes the parent folder selection
            if (node.path.includes('/')) {
                this.updateParentFoldersState(node.path);
            }
        } else {
            // Deselect folder and all children
            this.deselectFolderAndChildren(folder);
            itemEl.removeClass('is-selected');
            itemEl.removeClass('is-partially-selected');
        }
    }

    // Handle file selection toggle
    private handleFileSelection(node: TreeNode, isSelected: boolean, itemEl: HTMLElement) {
        const file = this.app.vault.getFileByPath(node.path);
        if (!(file instanceof TFile)) return;
        
        if (this.singleFileSelectionMode && isSelected) {
            // In single file mode, clear all other selections
            this.selectedFiles = [];

            // Clear all file selections visually (scoped to this modal)
            this.contentEl.querySelectorAll('.nav-file').forEach((el: Element) => {
                if (el.instanceOf(HTMLElement)) {
                    el.removeClass('is-selected');
                }
            });

            // Reset all checkboxes in single selection mode (scoped to this modal)
            this.contentEl.querySelectorAll('.tree-item-checkbox').forEach((cb: Element) => {
                if (cb.instanceOf(HTMLInputElement) && cb.closest('.nav-file') && cb.checked) {
                    cb.checked = false;
                }
            });
        }
        
        if (isSelected) {
            // Add to selection
            if (!this.selectedFiles.some(f => f.path === node.path)) {
                this.selectedFiles.push(file);
                itemEl.addClass('is-selected');
                
                // Ensure all parent folder states are correct
                this.ensureAllFolderSelections();
            }
        } else {
            // Remove from selection
            this.selectedFiles = this.selectedFiles.filter(f => f.path !== node.path);
            itemEl.removeClass('is-selected');
            
            // Update parent folders when a file is deselected
            this.updateParentFoldersState(node.path);
        }
    }

    // Update all visible checkboxes to match current selection state
    private updateVisibleCheckboxes() {
        // Ensure all folder selections are consistent
        this.ensureAllFolderSelections();
        
        // Update folder checkboxes (scoped to this modal)
        this.contentEl.querySelectorAll('.nav-folder').forEach((folderEl: Element) => {
            if (!folderEl.instanceOf(HTMLElement)) return;
            
            const pathEl = folderEl.querySelector('.tree-item-self')?.getAttribute('data-path');
            if (!pathEl) return;
            
            const isSelected = this.selectedFolders.some(f => f.path === pathEl);
            
            // Get checkbox
            const checkboxEl = folderEl.querySelector<HTMLInputElement>('.tree-item-checkbox');
            if (!checkboxEl) return;
            
            // Check for indeterminate state
            const folder = this.app.vault.getFolderByPath(pathEl);
            let isIndeterminate = false;
            
            if (folder && !isSelected) {
                isIndeterminate = this.hasIndeterminateSelection(folder);
            }
            
            // Update checkbox state
            checkboxEl.checked = isSelected;
            checkboxEl.indeterminate = isIndeterminate;
            checkboxEl.setAttribute('data-indeterminate', isIndeterminate ? 'true' : 'false');

            // Update folder classes
            if (isSelected) {
                folderEl.addClass('is-selected');
                folderEl.removeClass('is-partially-selected');
            } else if (isIndeterminate) {
                folderEl.removeClass('is-selected');
                folderEl.addClass('is-partially-selected');
            } else {
                folderEl.removeClass('is-selected');
                folderEl.removeClass('is-partially-selected');
            }
        });
        
        // Update file checkboxes (scoped to this modal)
        this.contentEl.querySelectorAll('.nav-file').forEach((fileEl: Element) => {
            if (!fileEl.instanceOf(HTMLElement)) return;
            
            const pathEl = fileEl.querySelector('.tree-item-self')?.getAttribute('data-path');
            if (!pathEl) return;
            
            const isSelected = this.selectedFiles.some(f => f.path === pathEl);
            
            // Get checkbox
            const checkboxEl = fileEl.querySelector<HTMLInputElement>('.tree-item-checkbox');
            if (!checkboxEl) return;
            
            // Update checkbox state
            checkboxEl.checked = isSelected;
            
            // Update file classes
            if (isSelected) {
                fileEl.addClass('is-selected');
            } else {
                fileEl.removeClass('is-selected');
            }
        });
    }

    // Handle keyboard navigation for tree items
    private handleItemKeyDown(e: KeyboardEvent, node: TreeNode, selfEl: HTMLElement, childrenEl?: HTMLElement) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            
            // For files or selecting folders, toggle checkbox
            const checkbox = selfEl.querySelector<HTMLInputElement>('.tree-item-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
            
            // For folders, also toggle expanded state if it was Space key
            if (node.isDirectory && childrenEl && e.key === ' ') {
                const isExpanded = this.expandedFolders.has(node.path);
                
                if (isExpanded) {
                    this.expandedFolders.delete(node.path);
                    childrenEl.hide();
                    selfEl.setAttribute('aria-expanded', 'false');
                    const collapseIcon = selfEl.querySelector('.collapse-icon');
                    if (collapseIcon) {
                        collapseIcon.addClass('is-collapsed');
                    }
                } else {
                    this.expandedFolders.add(node.path);
                    childrenEl.show();
                    selfEl.setAttribute('aria-expanded', 'true');
                    const collapseIcon = selfEl.querySelector('.collapse-icon');
                    if (collapseIcon) {
                        collapseIcon.removeClass('is-collapsed');
                    }
                    
                    // Lazy load children if needed
                    if (childrenEl.childElementCount === 0 && node.children.length > 0) {
                        const selectionText = this.contentEl.querySelector('.selection-text');
                        if (selectionText?.instanceOf(HTMLElement)) {
                            for (const child of node.children) {
                                this.renderTreeItem(childrenEl, child, selectionText);
                            }
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
            }
        } else if (e.key === 'ArrowRight' && node.isDirectory && childrenEl) {
            e.preventDefault();
            const isExpanded = this.expandedFolders.has(node.path);
            
            if (!isExpanded) {
                // Expand if collapsed
                selfEl.click();
            } else {
                // Move to first child if expanded
                const firstChild = childrenEl.querySelector<HTMLElement>('.tree-item-self');
                if (firstChild) firstChild.focus();
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            
            if (node.isDirectory && this.expandedFolders.has(node.path) && childrenEl) {
                // Collapse if expanded
                selfEl.click();
            } else {
                // Move to parent
                const parentItem = selfEl.closest('.tree-item-children')?.parentElement;
                const parentSelf = parentItem?.querySelector<HTMLElement>('.tree-item-self') ?? null;
                if (parentSelf) parentSelf.focus();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            
            // Find the next item to focus
            const nextFocusable = findNextFocusableElement(selfEl, this.contentEl);
            if (nextFocusable) nextFocusable.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();

            const prevFocusable = findPrevFocusableElement(selfEl, this.contentEl);
            if (prevFocusable) prevFocusable.focus();
        }
    }

    // Other methods remain largely the same...
    selectAllChildren(folder: TFolder) {
        for (const child of folder.children) {
            if (child instanceof TFolder && !child.path.startsWith('.')) {
                if (!this.selectedFolders.some(f => f.path === child.path)) {
                    this.selectedFolders.push(child);
                    this.folderSettings.set(child.path, true);
                }
                this.selectAllChildren(child);
            } else if (child instanceof TFile && child.extension === 'md') {
                if (!this.selectedFiles.some(f => f.path === child.path)) {
                    this.selectedFiles.push(child);
                }
            }
        }
        
        // After selecting all children, ensure parent folders are updated
        this.ensureAllFolderSelections();
    }

    deselectFolderAndChildren(folder: TFolder) {
        // Remove this folder
        this.selectedFolders = this.selectedFolders.filter(f => f.path !== folder.path);
        this.folderSettings.delete(folder.path);
        
        // Remove all child folders and files
        const folderPrefix = folder.path + '/';
        this.selectedFolders = this.selectedFolders.filter(f => !f.path.startsWith(folderPrefix));
        this.selectedFiles = this.selectedFiles.filter(f => !f.path.startsWith(folderPrefix));
        
        // Update parent folders when a folder is deselected (if not root)
        if (folder.path.includes('/')) {
            this.updateParentFoldersState(folder.path);
        }
    }

    updateSelectionCount(countEl: HTMLElement) {
        const fileCount = this.selectedFiles.length;
        const folderCount = this.selectedFolders.length;
        
        // Add or remove the has-selection class based on selection state
        const selCountEl = countEl.closest('.selection-counter');  // Changed from '.selected-count'
        if (selCountEl?.instanceOf(HTMLElement)) {
            if (fileCount === 0 && folderCount === 0) {
                selCountEl.addClass('has-no-selection');
                selCountEl.removeClass('has-selection');
            } else {
                selCountEl.removeClass('has-no-selection');
                selCountEl.addClass('has-selection');
            }
        }
        
        // Update count text
        if (fileCount === 0 && folderCount === 0) {
            countEl.textContent = this.singleFileSelectionMode ? 'No file selected' : 'Nothing selected';
        } else {
            let text = '';
            if (fileCount > 0) {
                text += `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
            }
            if (!this.singleFileSelectionMode && folderCount > 0) {
                if (fileCount > 0) text += ' and ';
                text += `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
            }
            text += ' selected';
            countEl.textContent = text;
        }
        
        // Show warning when folders are selected but none contain .md files
        const warningEl = selCountEl?.querySelector<HTMLElement>('.selection-warning') ?? null;
        if (warningEl) {
            const showWarning = !this.singleFileSelectionMode &&
                                folderCount > 0 &&
                                !this.hasResolvableMdFiles();
            warningEl.toggleClass('is-shown', showWarning);
        }

        // Update confirm button state
        const confirmButton = this.modalEl.querySelector<HTMLButtonElement>('.mod-cta');
        if (confirmButton) {
            if (this.singleFileSelectionMode) {
                confirmButton.disabled = fileCount !== 1;
            } else {
                confirmButton.disabled = !this.hasResolvableMdFiles();
            }
        }
    }

    hasIndeterminateSelection(folder: TFolder): boolean {
        // If the folder itself is selected, it's not in an indeterminate state
        if (this.selectedFolders.some(f => f.path === folder.path)) {
            return false;
        }
        
        // Check if ALL children are selected - if so, this should NOT be indeterminate
        if (this.areAllChildrenSelected(folder)) {
            return false;
        }
        
        // First check: is at least one child file selected (but not all)?
        const hasAnySelectedFile = folder.children.some(child => 
            child instanceof TFile && 
            child.extension === 'md' && 
            this.selectedFiles.some(f => f.path === child.path)
        );
        
        if (hasAnySelectedFile) {
            return true;
        }
        
        // Second check: are any immediate child folders selected (but not all)?
        const hasSelectedChildFolder = folder.children.some(child => 
            child instanceof TFolder && 
            !child.path.startsWith('.') && 
            this.selectedFolders.some(f => f.path === child.path)
        );
        
        if (hasSelectedChildFolder) {
            return true;
        }
        
        // Final check: do any child folders have an indeterminate state?
        const hasIndeterminateChild = folder.children.some(child => 
            child instanceof TFolder && 
            !child.path.startsWith('.') && 
            this.hasIndeterminateSelection(child)
        );
        
        return hasIndeterminateChild;
    }

    areAllChildrenSelected(folder: TFolder): boolean {
        // Track if we've found any valid children
        let hasValidChildren = false;
        
        for (const child of folder.children) {
            if (child instanceof TFolder && !child.path.startsWith('.')) {
                // Skip empty folders in the calculation - they don't affect the parent's state
                if (this.isFolderEmpty(child)) {
                    continue;
                }
                
                // Found a valid non-empty child folder
                hasValidChildren = true;
                
                // If this folder is directly selected, that's sufficient
                if (this.selectedFolders.some(f => f.path === child.path)) {
                    continue;
                }
                
                // If this folder isn't selected, check if all its children are selected
                if (!this.areAllChildrenSelected(child)) {
                    return false;
                }
            } else if (child instanceof TFile && child.extension === 'md') {
                // Found a valid child file
                hasValidChildren = true;
                
                // If this file isn't selected, we can return false immediately
                if (!this.selectedFiles.some(f => f.path === child.path)) {
                    return false;
                }
            }
        }
        
        // If no valid children were found (all empty folders or truly empty), 
        // we'll consider this based on if the parent is selected
        if (!hasValidChildren) {
            // Check if this folder is explicitly selected by the user
            return this.selectedFolders.some(f => f.path === folder.path);
        }
        
        // Otherwise all children must be selected or we would have returned false already
        return true;
    }
    
    // Helper method to determine if a folder is empty (has no MD files or non-empty subfolders)
    isFolderEmpty(folder: TFolder): boolean {
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                return false; // Has a markdown file, not empty
            }
            
            if (child instanceof TFolder && !child.path.startsWith('.')) {
                if (!this.isFolderEmpty(child)) {
                    return false; // Has a non-empty subfolder, not empty
                }
            }
        }
        
        return true; // No markdown files or non-empty subfolders found
    }

    private hasResolvableMdFiles(): boolean {
        if (this.selectedFiles.length > 0) return true;
        return this.selectedFolders.some(folder => !this.isFolderEmpty(folder));
    }

    ensureAllFolderSelections() {
        let selectionChanged = false;
        
        // Work with a snapshot to avoid modifying while iterating
        
        // Process all folders in the vault
        const allFolders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && !file.path.startsWith('.'));
        
        // Sort by path length to process parent folders first
        allFolders.sort((a, b) => a.path.length - b.path.length);
        
        // Check each folder
        for (const folder of allFolders) {
            // Skip already selected folders
            if (this.selectedFolders.some(f => f.path === folder.path)) {
                continue;
            }
            
            // Check if all children are selected
            if (this.areAllChildrenSelected(folder)) {
                this.selectedFolders.push(folder);
                this.folderSettings.set(folder.path, true);
                selectionChanged = true;
            }
        }
        
        return selectionChanged;
    }

    updateParentFoldersState(path: string) {
        // Skip for root files
        if (!path.includes('/')) return;
        
        // Get the parent folder path
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        const parentFolder = this.app.vault.getFolderByPath(parentPath);
        
        if (!parentFolder) return;
        
        // Check parent folder selection state
        const hasAllChildrenSelected = this.areAllChildrenSelected(parentFolder);
        const isParentSelected = this.selectedFolders.some(f => f.path === parentPath);
        
        if (isParentSelected && !hasAllChildrenSelected) {
            // Remove from selected folders to make it indeterminate
            this.selectedFolders = this.selectedFolders.filter(f => f.path !== parentPath);
        } else if (!isParentSelected && hasAllChildrenSelected) {
            // Add to selected folders
            if (!this.selectedFolders.some(f => f.path === parentPath)) {
                this.selectedFolders.push(parentFolder);
                this.folderSettings.set(parentPath, true);
            }
        }
        
        // Continue up the tree
        this.updateParentFoldersState(parentPath);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}