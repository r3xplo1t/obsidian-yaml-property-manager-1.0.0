// For BrowserModal.ts:
import { App, Modal, TFile, TFolder } from 'obsidian';

export interface BrowserModalResult {
    files: TFile[], 
    folders: TFolder[], 
    folderSettings: Map<string, boolean>,
    removedFilePaths: string[],
    removedFolderPaths: string[]
}

export class BrowserModal extends Modal {
    onSelect: (result: BrowserModalResult) => void;
    selectedFiles: TFile[] = [];
    selectedFolders: TFolder[] = [];
    folderSettings: Map<string, boolean> = new Map();
    initialSelectedFilePaths: string[] = [];
    initialSelectedFolderPaths: string[] = [];
    singleFileSelectionMode: boolean = false;
    title: string = "Select Files and Folders";
    description: string = "Select files or folders to use.";
    confirmButtonText: string = "Confirm Selection";
    expandedFolders: Set<string> = new Set();

    constructor(app: App, 
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
            const focused = document.activeElement;
            if (focused && focused.classList.contains('yaml-file-header')) {
                // Simulate click on focused file
                const checkbox = focused.querySelector('.yaml-custom-checkbox') as HTMLElement;
                if (checkbox) checkbox.click();
            } else if (focused && focused.classList.contains('yaml-folder-header')) {
                // Simulate click on focused folder
                (focused as HTMLElement).click();
            }
        }
        
        // Allow tab navigation to work normally
    }

    // Helper method to get checkbox icon SVG HTML
    private getCheckboxIconSvg(state: 'checked' | 'unchecked' | 'indeterminate'): string {
        if (state === 'checked') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="svg-icon yaml-checkbox-svg"><path d="M20 6L9 17l-5-5"/></svg>';
        } else if (state === 'indeterminate') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="svg-icon yaml-checkbox-svg"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        } else {
            return ''; // Empty for unchecked state
        }
    }

    // Helper to update checkbox state
    private updateCheckboxState(checkbox: HTMLElement, state: 'checked' | 'unchecked' | 'indeterminate'): void {
        // Remove existing states
        checkbox.removeClass('is-checked');
        checkbox.removeClass('is-indeterminate');
        checkbox.empty();
        
        if (state === 'checked') {
            checkbox.addClass('is-checked');
            checkbox.innerHTML = this.getCheckboxIconSvg('checked');
        } else if (state === 'indeterminate') {
            checkbox.addClass('is-indeterminate');
            checkbox.innerHTML = this.getCheckboxIconSvg('indeterminate');
        }
        // For unchecked, just leave it empty
    }

    createCustomCheckbox(isChecked: boolean, className: string): HTMLElement {
        // Container for checkbox
        const checkboxContainer = document.createElement('span');
        checkboxContainer.addClass('yaml-custom-checkbox-container');
        
        // Create the custom checkbox element
        const checkbox = document.createElement('div');
        checkbox.addClass('yaml-custom-checkbox');
        checkbox.addClass(className);
        
        // Set initial state
        if (isChecked) {
            checkbox.addClass('is-checked');
            checkbox.innerHTML = this.getCheckboxIconSvg('checked');
        }
        
        // Add to container
        checkboxContainer.appendChild(checkbox);
        return checkboxContainer;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Enable keyboard navigation when the modal opens
        contentEl.addEventListener('keydown', this.handleKeyDown.bind(this));
        
        // Initialize selection from existing paths  
        this.selectedFiles = [];
        this.selectedFolders = [];
                
        // Load files and folders from initial paths
        for (const filePath of this.initialSelectedFilePaths) {
            const file = this.app.vault.getFileByPath(filePath);
            if (file && file instanceof TFile) {
                this.selectedFiles.push(file);
            }
        }
        
        for (const folderPath of this.initialSelectedFolderPaths) {
            const folder = this.app.vault.getFolderByPath(folderPath);
            if (folder && folder instanceof TFolder) {
                this.selectedFolders.push(folder);
                this.folderSettings.set(folderPath, true);
            }
        }
        
        // Ensure all folder selections are properly set based on child selections
        this.ensureAllFolderSelections();
        
        // Add class for browser modal
        contentEl.addClass('yaml-browser-modal');
        
        // Set title and instructions based on configuration
        contentEl.createEl('h2', { text: this.title });
        contentEl.createEl('p', { 
            text: this.description,
            cls: 'setting-item-description' 
        });
        
        // File tree container
        const fileTreeContainer = contentEl.createDiv({ cls: 'yaml-file-tree' });
        
        // Selection counter
        const selectionCountEl = contentEl.createDiv({ cls: 'yaml-selected-count' });
        const countTextSpan = selectionCountEl.createSpan({ cls: 'yaml-selection-text' });
        this.updateSelectionCount(countTextSpan);
        
        // Add root folder contents
        this.renderFileTree(fileTreeContainer, this.app.vault.getRoot(), countTextSpan);
        
        // Button container
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        // Confirm button
        const confirmButton = buttonContainer.createEl('button', {
            text: this.confirmButtonText,
            cls: 'mod-cta',
            attr: { type: 'button' }
        });
        
        confirmButton.disabled = this.selectedFiles.length === 0 && this.selectedFolders.length === 0;

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel',
            attr: { type: 'button' }
        });
        
        cancelButton.addEventListener('click', () => {
            // Just close the modal without saving any changes
            this.close();
        });
        
        // Event handlers
        confirmButton.addEventListener('click', () => {
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
    }

    renderFileTree(container: HTMLElement, folder: TFolder, countEl: HTMLElement, level: number = 0) {
        // Skip hidden folders
        if (folder.path.startsWith('.') && !folder.isRoot()) return;
        
        // For non-root folders, create folder item
        if (!folder.isRoot()) {
            this.renderFolderItem(container, folder, countEl, level);
            return;
        }
        
        // For root folder, render children directly
        const sortedChildren = [...folder.children].sort((a, b) => {
            const aIsFolder = a instanceof TFolder;
            const bIsFolder = b instanceof TFolder;
            
            // Folders first, then files
            if (aIsFolder !== bIsFolder) {
                return aIsFolder ? -1 : 1;
            }
            
            // Alphabetical within type
            return a.name.localeCompare(b.name);
        });
        
        for (const child of sortedChildren) {
            if (child instanceof TFolder && !child.path.startsWith('.')) {
                this.renderFileTree(container, child, countEl, level);
            } else if (child instanceof TFile && child.extension === 'md') {
                this.renderFileItem(container, child, countEl, level);
            }
        }
    }

    renderFolderItem(container: HTMLElement, folder: TFolder, countEl: HTMLElement, level: number) {
        const isSelected = this.selectedFolders.some(f => f.path === folder.path);
        const wasInitiallySelected = this.initialSelectedFolderPaths.includes(folder.path);
        
        const folderItem = container.createDiv({ 
            cls: 'yaml-folder-item',
            attr: { 'data-path': folder.path }
        });
        
        if (wasInitiallySelected) {
            folderItem.addClass('initially-selected');
        }
        
        // Check if this folder has the indeterminate state before applying classes
        const isIndeterminate = !isSelected && this.hasIndeterminateSelection(folder);
        
        if (isSelected) {
            folderItem.addClass('is-selected');
        } else if (isIndeterminate) {
            folderItem.addClass('is-partially-selected');
        }
        
        // Create folder header
        const headerRow = folderItem.createDiv({ 
            cls: 'yaml-folder-header',
            attr: { 
                tabindex: '0',
                'aria-label': `Folder: ${folder.name}, ${isSelected ? 'Selected' : isIndeterminate ? 'Partially selected' : 'Not selected'}`,
                'aria-expanded': 'false' // Will be toggled when clicked
            }
        });
        headerRow.style.paddingLeft = `${level * 0}px`;
        
        // Only show checkboxes for folders if not in single file selection mode
        if (!this.singleFileSelectionMode) {
            const checkboxContainer = this.createCustomCheckbox(isSelected, 'yaml-folder-checkbox');
            headerRow.appendChild(checkboxContainer);
            const checkbox = checkboxContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
            
            // Apply indeterminate styling if needed
            if (isIndeterminate) {
                this.updateCheckboxState(checkbox, 'indeterminate');
            }
            
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const isCurrentlyChecked = checkbox.hasClass('is-checked');
                const isCurrentlyIndeterminate = checkbox.hasClass('is-indeterminate');

                if (!isCurrentlyChecked) {
                    // Select folder
                    this.updateCheckboxState(checkbox, 'checked');
                    
                    if (!this.selectedFolders.some(f => f.path === folder.path)) {
                        this.selectedFolders.push(folder);
                        this.folderSettings.set(folder.path, true);
                        folderItem.addClass('is-selected');
                        folderItem.removeClass('is-partially-selected');
                    }
                    
                    // Select all children
                    this.selectAllChildren(folder);
                    
                    // Check if this completes the parent folder selection
                    if (folder.path.includes('/')) {
                        this.updateParentFoldersOnSelection(folder.path);
                    }
                } else {
                    // Deselect folder and all children
                    this.updateCheckboxState(checkbox, 'unchecked');
                    this.deselectFolderAndChildren(folder);
                    folderItem.removeClass('is-selected');
                    folderItem.removeClass('is-partially-selected');
                }
                
                // Update selection count
                this.updateSelectionCount(countEl);
                
                // Update all visible checkboxes to match data
                this.updateVisibleCheckboxes();
            });
        }
        
        // Folder icon
        const folderIcon = headerRow.createSpan({ cls: 'yaml-folder-icon' });
        folderIcon.innerHTML = this.getSvgIcon(this.expandedFolders.has(folder.path) ? 'folder-open' : 'folder-closed');
        
        // Folder name
        headerRow.createSpan({ 
            text: folder.name, 
            cls: 'yaml-folder-name' 
        });
        
        // Children container
        const childrenContainer = folderItem.createDiv({ 
            cls: `yaml-folder-children ${!this.expandedFolders.has(folder.path) ? 'yaml-folder-children--collapsed' : ''}`
        });
        
        // Toggle expansion on click
        headerRow.addEventListener('click', (e) => {
            // Only toggle if not clicking the checkbox
            if (!(e.target instanceof HTMLElement) || 
                (!e.target.closest('.yaml-custom-checkbox-container') && !e.target.classList.contains('yaml-custom-checkbox'))) {
                
                const isCollapsed = childrenContainer.hasClass('yaml-folder-children--collapsed');
                
                // Toggle collapsed state
                childrenContainer.toggleClass('yaml-folder-children--collapsed', !isCollapsed);

                // Update aria-expanded attribute for accessibility
                headerRow.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
                
                // Log state before and after for debugging
                console.log('Folder toggled:', {
                    path: folder.path,
                    wasCollapsed: isCollapsed,
                    isNowCollapsed: !isCollapsed
                });
                
                // Update folder icon
                folderIcon.empty();
                folderIcon.innerHTML = this.getSvgIcon(isCollapsed ? 'folder-open' : 'folder-closed');
                
                // Track expanded state
                if (isCollapsed) {
                    this.expandedFolders.add(folder.path);
                    
                    // If the folder was previously collapsed and now expanded
                    if (childrenContainer.childElementCount === 0) {
                        // First, show a loading indicator
                        const loadingEl = childrenContainer.createDiv({
                            cls: 'yaml-folder-loading',
                        });
                        
                        // Add spinner
                        loadingEl.createDiv({
                            cls: 'yaml-folder-loading-spinner'
                        });
                        
                        // Add loading text
                        loadingEl.createSpan({
                            text: 'Loading...'
                        });
                        
                        // Use setTimeout to give the UI time to show the loading state
                        setTimeout(() => {
                            // Remove loading indicator
                            loadingEl.remove();
                            
                            // Check if folder is empty after filtering hidden items
                            const visibleChildren = folder.children.filter(child => 
                                (child instanceof TFolder && !child.path.startsWith('.')) || 
                                (child instanceof TFile && child.extension === 'md')
                            );
                            
                            if (visibleChildren.length === 0) {
                                // Show empty message if folder is empty
                                const emptyMessage = childrenContainer.createDiv({
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
                            } else {
                                // Non-empty folder, render all visible children
                                const sortedChildren = [...visibleChildren].sort((a, b) => {
                                    const aIsFolder = a instanceof TFolder;
                                    const bIsFolder = b instanceof TFolder;
                                    
                                    // Folders first, then files
                                    if (aIsFolder !== bIsFolder) {
                                        return aIsFolder ? -1 : 1;
                                    }
                                    
                                    // Alphabetical within type
                                    return a.name.localeCompare(b.name);
                                });
                                
                                for (const child of sortedChildren) {
                                    if (child instanceof TFolder && !child.path.startsWith('.')) {
                                        this.renderFolderItem(childrenContainer, child, countEl, level + 1);
                                    } else if (child instanceof TFile && child.extension === 'md') {
                                        this.renderFileItem(childrenContainer, child, countEl, level + 1);
                                    }
                                }
                            }
                        }, 300); // Short delay to show loading state
                    }
                } else {
                    this.expandedFolders.delete(folder.path);
                }
            }
        });
    }

    renderFileItem(container: HTMLElement, file: TFile, countEl: HTMLElement, level: number) {
        const isSelected = this.selectedFiles.some(f => f.path === file.path);
        const wasInitiallySelected = this.initialSelectedFilePaths.includes(file.path);
        
        const fileItem = container.createDiv({ 
            cls: 'yaml-file-item',
            attr: { 'data-path': file.path }
        });
        
        if (wasInitiallySelected) {
            fileItem.addClass('initially-selected');
        }
        
        if (isSelected) {
            fileItem.addClass('is-selected');
        }
        
        const headerRow = fileItem.createDiv({ 
            cls: 'yaml-file-header',
            attr: { 
                tabindex: '0',
                'aria-label': `File: ${file.name}, ${isSelected ? 'Selected' : 'Not selected'}`
            }
        });
        headerRow.style.paddingLeft = `${level * 0}px`;
        
        // Create checkbox
        const checkboxContainer = this.createCustomCheckbox(isSelected, 'yaml-file-checkbox');
        headerRow.appendChild(checkboxContainer);
        const checkbox = checkboxContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;
        
        // File icon
        const fileIcon = headerRow.createSpan({ cls: 'yaml-file-icon' });
        fileIcon.innerHTML = this.getSvgIcon('file');
        
        // File name
        headerRow.createSpan({ 
            text: file.name, 
            cls: 'yaml-file-name' 
        });
        
        // Checkbox handling
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const isCurrentlyChecked = checkbox.hasClass('is-checked');
            
            if (this.singleFileSelectionMode && !isCurrentlyChecked) {
                // In single file mode, clear all other selections
                this.selectedFiles = [];
                document.querySelectorAll('.yaml-custom-checkbox.yaml-file-checkbox').forEach((cb: HTMLElement) => {
                    cb.removeClass('is-checked');
                    const checkmark = cb.querySelector('.yaml-checkbox-checkmark');
                    if (checkmark) cb.removeChild(checkmark);
                });
                document.querySelectorAll('.yaml-file-item').forEach((item: HTMLElement) => {
                    item.removeClass('is-selected');
                });
            }
            
            if (!isCurrentlyChecked) {
                // Add to selection
                this.updateCheckboxState(checkbox, 'checked');
                
                if (!this.selectedFiles.some(f => f.path === file.path)) {
                    this.selectedFiles.push(file);
                    fileItem.addClass('is-selected');
                    
                    // Check if this completes the parent folder selection
                    this.updateParentFoldersOnSelection(file.path);
                    
                    // Additional: ensure all parent folder states are correct
                    this.ensureAllFolderSelections();
                }
            } else {
                // Remove from selection
                this.updateCheckboxState(checkbox, 'unchecked');
                
                this.selectedFiles = this.selectedFiles.filter(f => f.path !== file.path);
                fileItem.removeClass('is-selected');
                
                // Update parent folders when a file is deselected
                this.updateParentFoldersState(file.path);
            }
            
            // Update selection count
            this.updateSelectionCount(countEl);
            
            // Update all visible checkboxes
            this.updateVisibleCheckboxes();
        }); 
        
        // Make row clickable to toggle checkbox
        headerRow.addEventListener('click', (e) => {
            // Only handle clicks that aren't on the checkbox itself
            if (!(e.target instanceof HTMLElement) || 
                (!e.target.closest('.yaml-custom-checkbox-container') && !e.target.classList.contains('yaml-custom-checkbox'))) {
                
                // Simulate a click on the checkbox
                checkbox.click();
            }
        });
    }

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
        // This will cascade upwards from any selection changes
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
        if (fileCount > 0 || folderCount > 0) {
            countEl.addClass('has-selection');
        } else {
            countEl.removeClass('has-selection');
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
        
        // Update confirm button state
        const confirmButton = this.contentEl.querySelector('.mod-cta') as HTMLButtonElement;
        if (confirmButton) {
            // In single file mode, require exactly one file selected
            // In multi-selection mode, always enable the button (even with nothing selected)
            confirmButton.disabled = this.singleFileSelectionMode ? fileCount !== 1 : false;
        }
    }

    updateVisibleCheckboxes() {
        // First ensure all folder selections are consistent
        this.ensureAllFolderSelections();
        
        // Now update folder checkboxes
        document.querySelectorAll('.yaml-folder-item').forEach((item: HTMLElement) => {
            const path = item.getAttribute('data-path');
            if (path) {
                const isSelected = this.selectedFolders.some(f => f.path === path);
                const checkbox = item.querySelector('.yaml-custom-checkbox.yaml-folder-checkbox') as HTMLElement;
                
                if (checkbox) {
                    // Check for indeterminate state - only if not selected
                    const folder = this.app.vault.getFolderByPath(path);
                    let isIndeterminate = false;
                    
                    if (folder && !isSelected) {
                        isIndeterminate = this.hasIndeterminateSelection(folder);
                    }
                    
                    if (isSelected) {
                        // Add checked state and checkmark
                        this.updateCheckboxState(checkbox, 'checked');
                        item.addClass('is-selected');
                        item.removeClass('is-partially-selected');
                    } else if (isIndeterminate) {
                        // Apply indeterminate styling
                        this.updateCheckboxState(checkbox, 'indeterminate');
                        
                        item.removeClass('is-selected');
                        item.addClass('is-partially-selected');
                    } else {
                        this.updateCheckboxState(checkbox, 'unchecked');
                        item.removeClass('is-selected');
                        item.removeClass('is-partially-selected');
                    }
                }
            }
        });
        
        // Update file checkboxes
        document.querySelectorAll('.yaml-file-item').forEach((item: HTMLElement) => {
            const path = item.getAttribute('data-path');
            if (path) {
                const isSelected = this.selectedFiles.some(f => f.path === path);
                const checkbox = item.querySelector('.yaml-custom-checkbox.yaml-file-checkbox') as HTMLElement;
                
                if (checkbox) {
                    if (isSelected) {
                        // Add checked state and checkmark
                        this.updateCheckboxState(checkbox, 'checked');
                        item.addClass('is-selected');
                    } else {
                        this.updateCheckboxState(checkbox, 'unchecked');
                        item.removeClass('is-selected');
                    }
                }
            }
        });
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
                // Found a valid child folder
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
        
        // If no valid children were found (empty folder), return false instead of true
        // Empty folders should not be considered as having "all children selected"
        if (!hasValidChildren) {
            return false;
        }
        
        // Otherwise all children must be selected or we would have returned false already
        return true;
    }

    ensureAllFolderSelections() {
        let selectionChanged = false;
        
        // Work with a temporary copy to avoid modifying while iterating
        const currentSelections = [...this.selectedFolders];
        
        // Process all folders in the vault
        const allFolders = this.app.vault.getAllLoadedFiles()
            .filter(file => file instanceof TFolder && !file.path.startsWith('.')) as TFolder[];
        
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
                console.log(`Auto-selecting folder ${folder.path} because all children are selected`);
                this.selectedFolders.push(folder);
                this.folderSettings.set(folder.path, true);
                selectionChanged = true;
            }
        }
        
        // If we made changes, update the UI
        if (selectionChanged) {
            // We'll update UI separately
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
        
        // Check if parent folder is currently selected
        const isParentSelected = this.selectedFolders.some(f => f.path === parentPath);
        
        // If parent is selected but has partially selected children, update to indeterminate
        if (isParentSelected) {
            const hasAllChildrenSelected = this.areAllChildrenSelected(parentFolder);
            
            if (!hasAllChildrenSelected) {
                // Remove from selected folders to make it indeterminate
                this.selectedFolders = this.selectedFolders.filter(f => f.path !== parentPath);
                
                // Continue up the tree
                this.updateParentFoldersState(parentPath);
            }
        } else {
            // Even if parent isn't selected, we need to update visual state
            // of all ancestors when a deep change occurs
            this.updateParentFoldersState(parentPath);
        }
    }
    
    updateParentFoldersOnSelection(path: string) {
        // Skip for root files
        if (!path.includes('/')) return;
        
        // Get the parent folder path
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        const parentFolder = this.app.vault.getFolderByPath(parentPath);
        
        if (!parentFolder) return;
        
        // Check if parent folder is currently selected
        const isParentSelected = this.selectedFolders.some(f => f.path === parentPath);
        
        if (!isParentSelected) {
            // Check if all children are now selected
            const allChildrenSelected = this.areAllChildrenSelected(parentFolder);
            
            if (allChildrenSelected) {
                console.log(`All children selected for ${parentPath}, selecting the folder`);
                
                // Add the parent to selected folders
                if (!this.selectedFolders.some(f => f.path === parentPath)) {
                    this.selectedFolders.push(parentFolder);
                    this.folderSettings.set(parentPath, true);
                }
                
                // Continue up the tree
                this.updateParentFoldersOnSelection(parentPath);
            }
        }
    }

    // Helper method to get SVG icon HTML
    private getSvgIcon(type: 'folder-closed' | 'folder-open' | 'file'): string {
        if (type === 'folder-closed') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder-closed"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path><path d="M2 10h20"></path></svg>';
        } else if (type === 'folder-open') {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-folder-open"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"></path></svg>';
        } else {
            return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg>';
        }
    }

    onClose() {
        const { contentEl } = this;
        
        // Remove keyboard event listener
        contentEl.removeEventListener('keydown', this.handleKeyDown.bind(this));
        
        contentEl.empty();
    }
}