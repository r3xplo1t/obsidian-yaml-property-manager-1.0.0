import { App, Modal, TFile, TFolder } from 'obsidian';

export class TemplateFileSelectorModal extends Modal {
    onSelect: (result: { 
        files: TFile[], 
        folders: TFolder[], 
        folderSettings: Map<string, boolean> 
    }) => void;
    selectedFiles: TFile[] = [];
    selectedFolders: TFolder[] = [];
    folderSubdirectoryOptions: Map<string, boolean> = new Map();
    existingTemplatePaths: {type: string, path: string}[] = [];  

    constructor(app: App, 
        onSelect: (result: { 
            files: TFile[], 
            folders: TFolder[], 
            folderSettings: Map<string, boolean> 
        }) => void,
        existingTemplatePaths: {type: string, path: string}[] = []
    ) {
        super(app);
        this.onSelect = onSelect;
        this.existingTemplatePaths = existingTemplatePaths;
    }

    isAlreadyInTemplatePaths(path: string, type: 'file' | 'directory'): boolean {
        return this.existingTemplatePaths.some(
            tp => tp.type === type && tp.path === path
        );
    }

    updateSelectionCount(countEl: HTMLElement) {
        const fileCount = this.selectedFiles.length;
        const folderCount = this.selectedFolders.length;
        const totalCount = fileCount + folderCount;
        
        if (totalCount === 0) {
            countEl.textContent = 'Nothing selected';
        } else {
            let text = '';
            if (fileCount > 0) {
                text += `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
            }
            if (folderCount > 0) {
                if (fileCount > 0) text += ' and ';
                text += `${folderCount} ${folderCount === 1 ? 'file' : 'files'}`;
            }
            text += ' selected';
            countEl.textContent = text;
        }
        
        // Enable/disable confirm button
        const confirmButton = this.contentEl.querySelector('.mod-cta') as HTMLButtonElement;
        if (confirmButton) {
            confirmButton.disabled = totalCount === 0;
            if (totalCount === 0) {
                confirmButton.addClass('yaml-button--disabled');
            } else {
                confirmButton.removeClass('yaml-button--disabled');
            }
        }
    }

    createCustomCheckbox(isChecked: boolean, className: string): HTMLElement {
        // Create container to ensure proper alignment and spacing
        const checkboxContainer = document.createElement('span');
        checkboxContainer.addClass('yaml-custom-checkbox-container');
        
        // Create the custom checkbox element
        const checkbox = document.createElement('div');
        checkbox.addClass('yaml-custom-checkbox');
        checkbox.addClass(className);
        
        // Set initial state
        if (isChecked) {
            checkbox.addClass('is-checked');
            
            // Add checkmark icon when checked
            const checkmark = document.createElement('span');
            checkmark.addClass('yaml-checkbox-checkmark');
            checkmark.innerHTML = '✓';
            checkbox.appendChild(checkmark);
        }
        
        // Add to container
        checkboxContainer.appendChild(checkbox);
        return checkboxContainer;
    }

    updateCustomChildCheckboxes(container: HTMLElement, isChecked: boolean) {
        const checkboxes = container.querySelectorAll('.yaml-custom-checkbox');
        checkboxes.forEach((cb: HTMLElement) => {
            if (isChecked && !cb.hasClass('is-checked')) {
                cb.addClass('is-checked');
                const checkmark = document.createElement('span');
                checkmark.addClass('yaml-checkbox-checkmark');
                checkmark.innerHTML = '✓';
                cb.appendChild(checkmark);
            } else if (!isChecked && cb.hasClass('is-checked')) {
                cb.removeClass('is-checked');
                const checkmark = cb.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) cb.removeChild(checkmark);
            }
        });
    }

    // Helper to check if a folder is selected
    isFolderSelected(folder: TFolder): boolean {
        // Direct match
        if (this.selectedFolders.some(f => f.path === folder.path)) {
            return true;
        }
        
        // Parent folder match (if any parent folder is selected)
        let parentPath = folder.path;
        while (parentPath.includes('/')) {
            parentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
            if (this.selectedFolders.some(f => f.path === parentPath)) {
                return true;
            }
        }
        
        return false;
    }

    // Helper to select all children recursively
    selectAllChildrenRecursively(folder: TFolder) {
        // Process each child
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                // Add folder to selection if not already there
                if (!this.selectedFolders.some(f => f.path === child.path)) {
                    this.selectedFolders.push(child);
                    this.folderSubdirectoryOptions.set(child.path, true);
                }
                
                // Process folder's children recursively
                this.selectAllChildrenRecursively(child);
            } else if (child instanceof TFile && child.extension === 'md') {
                // Add file to selection if not already there
                if (!this.selectedFiles.some(f => f.path === child.path)) {
                    this.selectedFiles.push(child);
                }
            }
        }
    }

    // Helper to deselect a folder and all its children
    deselectFolderAndChildren(folder: TFolder) {
        // Remove this folder
        this.selectedFolders = this.selectedFolders.filter(f => f.path !== folder.path);
        this.folderSubdirectoryOptions.delete(folder.path);
        
        // Remove all child folders and files
        const folderPrefix = folder.path + '/';
        this.selectedFolders = this.selectedFolders.filter(f => !f.path.startsWith(folderPrefix));
        this.selectedFiles = this.selectedFiles.filter(f => !f.path.startsWith(folderPrefix));
    }

    // Helper to update UI checkboxes for visible children
    updateChildCheckboxes(container: HTMLElement, isChecked: boolean) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb: HTMLInputElement) => {
            cb.checked = isChecked;
        });
    }

    // Update visible children checkboxes based on data selection
    updateVisibleChildrenCheckboxes(folder: TFolder, container: HTMLElement) {
        // Find all folder checkboxes
        const folderCheckboxes = container.querySelectorAll('.yaml-custom-checkbox.yaml-folder-checkbox');
        folderCheckboxes.forEach((cb: HTMLElement) => {
            const folderItem = cb.closest('.yaml-folder-item');
            if (folderItem) {
                const path = folderItem.getAttribute('data-path');
                if (path) {
                    const isSelected = this.selectedFolders.some(f => f.path === path);
                    if (isSelected && !cb.hasClass('is-checked')) {
                        cb.addClass('is-checked');
                        const checkmark = document.createElement('span');
                        checkmark.addClass('yaml-checkbox-checkmark');
                        checkmark.innerHTML = '✓';
                        cb.appendChild(checkmark);
                    } else if (!isSelected && cb.hasClass('is-checked')) {
                        cb.removeClass('is-checked');
                        const checkmark = cb.querySelector('.yaml-checkbox-checkmark');
                        if (checkmark) cb.removeChild(checkmark);
                    }
                }
            }
        });
        
        // Find all file checkboxes
        const fileCheckboxes = container.querySelectorAll('.yaml-custom-checkbox.yaml-file-checkbox');
        fileCheckboxes.forEach((cb: HTMLElement) => {
            const fileItem = cb.closest('.yaml-file-item');
            if (fileItem) {
                const path = fileItem.getAttribute('data-path');
                if (path) {
                    const isSelected = this.selectedFiles.some(f => f.path === path);
                    if (isSelected && !cb.hasClass('is-checked')) {
                        cb.addClass('is-checked');
                        const checkmark = document.createElement('span');
                        checkmark.addClass('yaml-checkbox-checkmark');
                        checkmark.innerHTML = '✓';
                        cb.appendChild(checkmark);
                    } else if (!isSelected && cb.hasClass('is-checked')) {
                        cb.removeClass('is-checked');
                        const checkmark = cb.querySelector('.yaml-checkbox-checkmark');
                        if (checkmark) cb.removeChild(checkmark);
                    }
                }
            }
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Add class for template file selector
        contentEl.addClass('yaml-template-file-selector');
        
        // Use only minimal styling to avoid nesting containers
        contentEl.createEl('h2', { 
            text: 'Select Template Files and Directories'
        });
        
        // Instructions
        contentEl.createEl('p', { 
            text: 'Select files to use as templates, or select entire directories. Check the box to include a file or folder.',
            cls: 'setting-item-description' 
        });
        
        // File tree container - single container without nesting
        const fileTreeContainer = contentEl.createDiv({ 
            cls: 'yaml-file-tree' 
        });
        
        // Selection counter
        const selectionCountEl = contentEl.createDiv({ 
            cls: 'yaml-selected-count' 
        });
        selectionCountEl.textContent = 'Nothing selected';
        
        // Add root folder contents directly to the file tree container
        this.addFolderToTree(fileTreeContainer, this.app.vault.getRoot(), selectionCountEl);
        
        // Button container
        const buttonContainer = contentEl.createDiv({
            cls: 'modal-button-container'
        });

        // Use Obsidian's standard button classes
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Add Selected Files & Folders',
            cls: 'mod-cta', // This is Obsidian's standard call-to-action button class
            attr: {
                type: 'button' // Ensure it's recognized as a button
            }
        });

        confirmButton.disabled = true;

        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel',
            attr: {
                type: 'button' // Ensure it's recognized as a button
            }
            // No additional classes for standard buttons
        });
        
        // Event handlers
        confirmButton.addEventListener('click', () => {
            this.onSelect({
                files: this.selectedFiles,
                folders: this.selectedFolders,
                folderSettings: this.folderSubdirectoryOptions
            });
            this.close();
        });
        
        cancelButton.addEventListener('click', () => {
            this.onSelect({ 
                files: [], 
                folders: [], 
                folderSettings: new Map() 
            });
            this.close();
        });

        setTimeout(() => {
            // Force Obsidian to re-apply its styling
            const buttons = this.contentEl.querySelectorAll('button');
            buttons.forEach(button => {
                // Remove any classes that might interfere with Obsidian's styling
                button.className = button.className.replace(/yaml-button[^ ]*/g, '');
                
                // Re-add the mod-cta class to the confirm button if needed
                if (button.textContent?.includes('Add Selected')) {
                    button.addClass('mod-cta');
                }
            });
        }, 10);
    }

    addFolderToTree(parentEl: HTMLElement, folder: TFolder, selectionCountEl: HTMLElement, level: number = 0) {
        const children = folder.children;
        if (!children) return;
        
        // Skip the root folder name display
        if (folder.isRoot()) {
            // Sort all children: ALWAYS folders before files
            const sortedChildren = [...children].sort((a, b) => {
                const aIsFolder = a instanceof TFolder;
                const bIsFolder = b instanceof TFolder;
                
                // Folder/file comparison - folders always first
                if (aIsFolder !== bIsFolder) {
                    return aIsFolder ? -1 : 1;
                }
                
                // Same type, sort by name
                return a.name.localeCompare(b.name);
            });
            
            // Add children directly
            for (const child of sortedChildren) {
                if (child instanceof TFolder && !child.path.startsWith('.')) {
                    this.addFolderToTree(parentEl, child, selectionCountEl, level);
                } else if (child instanceof TFile && child.extension === 'md') {
                    this.addFileToTree(parentEl, child, selectionCountEl, level);
                }
            }
            return;
        }
        
        // For non-root folders
        const folderItem = parentEl.createDiv({ 
            cls: 'yaml-folder-item',
            attr: { 'data-path': folder.path }
        });
        
        // Check if this folder is already in template paths
        const isAlreadySelected = this.isAlreadyInTemplatePaths(folder.path, 'directory');
        if (isAlreadySelected) {
            folderItem.addClass('already-selected');
        }
        
        // Header row
        const headerRow = folderItem.createDiv({ cls: 'yaml-file-tree-header' });
        if (isAlreadySelected) {
            headerRow.addClass('already-in-templates');
        }
        
        // Use inline style for indentation
        headerRow.style.paddingLeft = `${level * 16}px`;
        
        // Checkbox
        const isSelected = this.isFolderSelected(folder);
        const checkboxContainer = this.createCustomCheckbox(isSelected, 'yaml-folder-checkbox');
        headerRow.appendChild(checkboxContainer);
        const checkbox = checkboxContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;

        const isAlreadyInPaths = this.isAlreadyInTemplatePaths(folder.path, 'directory');
        if (isAlreadyInPaths && !isSelected) {
            // Add 'checked' styling to checkbox
            checkbox.addClass('is-checked');
            const checkmark = document.createElement('span');
            checkmark.addClass('yaml-checkbox-checkmark');
            checkmark.innerHTML = '✓';
            checkbox.appendChild(checkmark);
            
            // Add to selected folders list if not already there
            if (!this.selectedFolders.some(f => f.path === folder.path)) {
                this.selectedFolders.push(folder);
                this.folderSubdirectoryOptions.set(folder.path, true);
            }
        }
        
        // Add to selected folders if checked
        if (isSelected && !this.selectedFolders.some(f => f.path === folder.path)) {
            this.selectedFolders.push(folder);
            this.folderSubdirectoryOptions.set(folder.path, true);
        }
        
        // Folder icon - using emoji
        const folderIcon = headerRow.createSpan({ 
            text: '📁 ', 
            cls: 'yaml-folder-icon' 
        });
        
        // Folder name
        headerRow.createSpan({ text: folder.name, cls: 'yaml-folder-name' });
        
        // Children container
        const childrenContainer = folderItem.createDiv({ 
            cls: 'yaml-folder-children yaml-folder-children--collapsed'
        });
        
        // Checkbox event handler with improved child handling
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Toggle checked state
            const isCurrentlyChecked = checkbox.hasClass('is-checked');
            const newState = !isCurrentlyChecked;
            
            if (newState) {
                // Add checked styling
                checkbox.addClass('is-checked');
                const checkmark = document.createElement('span');
                checkmark.addClass('yaml-checkbox-checkmark');
                checkmark.innerHTML = '✓';
                checkbox.appendChild(checkmark);
                
                // Add folder to selection
                if (!this.selectedFolders.some(f => f.path === folder.path)) {
                    this.selectedFolders.push(folder);
                    console.log(`Added folder to selection: ${folder.path}`);
                }
                
                // Set folder to include subdirectories
                this.folderSubdirectoryOptions.set(folder.path, true);
                
                // Mark all child folders and files as selected
                this.selectAllChildrenRecursively(folder);
            } else {
                // Remove checked styling
                checkbox.removeClass('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkbox.removeChild(checkmark);
                
                // Remove folder and all children from selection
                this.deselectFolderAndChildren(folder);
            }
            
            // Update UI for any visible children
            this.updateCustomChildCheckboxes(childrenContainer, newState);
            
            // Update the count display
            this.updateSelectionCount(selectionCountEl);
        });
        
        // Toggle expand/collapse
        headerRow.addEventListener('click', (e) => {
            // Only toggle if not clicking the checkbox
            if (!(e.target instanceof HTMLElement) || 
                (!e.target.closest('.yaml-custom-checkbox-container') && !e.target.classList.contains('yaml-custom-checkbox'))) {
                
                const isCollapsed = childrenContainer.hasClass('yaml-folder-children--collapsed');
                childrenContainer.toggleClass('yaml-folder-children--collapsed', !isCollapsed);
                
                // Update folder icon to show collapsed/expanded state
                if (childrenContainer.hasClass('yaml-folder-children--collapsed')) {
                    folderIcon.textContent = '📁 '; // Collapsed folder
                } else {
                    folderIcon.textContent = '📂 '; // Expanded folder
                }
                
                // If expanding and no children loaded yet
                if (!childrenContainer.hasClass('yaml-folder-children--collapsed') && childrenContainer.childElementCount === 0) {
                    // Sort children first
                    const sortedChildren = [...folder.children].sort((a, b) => {
                        const aIsFolder = a instanceof TFolder;
                        const bIsFolder = b instanceof TFolder;
                        
                        if (aIsFolder !== bIsFolder) {
                            return aIsFolder ? -1 : 1;
                        }
                        
                        return a.name.localeCompare(b.name);
                    });
                    
                    // Add children
                    for (const child of sortedChildren) {
                        if (child instanceof TFolder && !child.path.startsWith('.')) {
                            this.addFolderToTree(childrenContainer, child, selectionCountEl, level + 1);
                        } else if (child instanceof TFile && child.extension === 'md') {
                            this.addFileToTree(childrenContainer, child, selectionCountEl, level + 1);
                        }
                    }
                    
                    // Update checkboxes based on selection state
                    this.updateVisibleChildrenCheckboxes(folder, childrenContainer);
                }
            }
        });
    }

    addFileToTree(parentEl: HTMLElement, file: TFile, selectionCountEl: HTMLElement, level: number = 0) {
        const fileItem = parentEl.createDiv({ 
            cls: 'yaml-file-item',
            attr: { 'data-path': file.path }
        });
        
        // Check if this file is already in template paths
        const isAlreadySelected = this.isAlreadyInTemplatePaths(file.path, 'file');
        if (isAlreadySelected) {
            fileItem.addClass('already-selected');
        }
        
        const headerRow = fileItem.createDiv({ cls: 'yaml-file-tree-header' });
        if (isAlreadySelected) {
            headerRow.addClass('already-in-templates');
        }
        
        // Use inline style for indentation - smaller increment for better nesting
        headerRow.style.paddingLeft = `${level * 16}px`;
        
        // Use the SAME custom checkbox implementation as folders
        const isSelected = this.isFileSelected(file);
        const checkboxContainer = this.createCustomCheckbox(isSelected, 'yaml-file-checkbox');
        headerRow.appendChild(checkboxContainer);
        const checkbox = checkboxContainer.querySelector('.yaml-custom-checkbox') as HTMLElement;

        const isAlreadyInPaths = this.isAlreadyInTemplatePaths(file.path, 'file');
        if (isAlreadyInPaths && !isSelected) {
            // Add 'checked' styling to checkbox
            checkbox.addClass('is-checked');
            const checkmark = document.createElement('span');
            checkmark.addClass('yaml-checkbox-checkmark');
            checkmark.innerHTML = '✓';
            checkbox.appendChild(checkmark);
            
            // Add to selected files list if not already there
            if (!this.selectedFiles.some(f => f.path === file.path)) {
                this.selectedFiles.push(file);
            }
        }
        
        // Add to selected files if checked
        if (isSelected && !this.selectedFiles.some(f => f.path === file.path)) {
            this.selectedFiles.push(file);
        }
        
        // File icon - using emoji
        const fileIcon = headerRow.createSpan({ 
            text: '📄 ', 
            cls: 'yaml-file-icon' 
        });
        
        // File name
        headerRow.createSpan({ text: file.name, cls: 'yaml-file-name' });
        
        // Checkbox event handler - CONSISTENT with folder implementation
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Toggle checked state
            const isCurrentlyChecked = checkbox.hasClass('is-checked');
            const newState = !isCurrentlyChecked;
            
            if (newState) {
                // Add checked styling
                checkbox.addClass('is-checked');
                const checkmark = document.createElement('span');
                checkmark.addClass('yaml-checkbox-checkmark');
                checkmark.innerHTML = '✓';
                checkbox.appendChild(checkmark);
                
                // Add file to selection
                if (!this.selectedFiles.some(f => f.path === file.path)) {
                    this.selectedFiles.push(file);
                    console.log(`Added file to selection: ${file.path}`);
                }
            } else {
                // Remove checked styling
                checkbox.removeClass('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkbox.removeChild(checkmark);
                
                // Remove file from selection
                this.selectedFiles = this.selectedFiles.filter(f => f.path !== file.path);
                console.log(`Removed file from selection: ${file.path}`);
            }
            
            // Update the count display
            this.updateSelectionCount(selectionCountEl);
        });
        
        // Make row clickable (but not the checkbox itself)
        headerRow.addEventListener('click', (e) => {
            // Only handle clicks that aren't on the checkbox itself
            if (!(e.target instanceof HTMLElement) || !e.target.closest('.yaml-custom-checkbox-container')) {
                // Simulate a click on the checkbox
                checkbox.click();
            }
        });
    }

    // Helper to check if a file is selected or part of a selected folder
    isFileSelected(file: TFile): boolean {
        // Direct match
        if (this.selectedFiles.some(f => f.path === file.path)) {
            return true;
        }
        
        // Parent folder match (if any parent folder is selected)
        let parentPath = file.path;
        while (parentPath.includes('/')) {
            parentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
            if (this.selectedFolders.some(f => f.path === parentPath)) {
                return true;
            }
        }
        
        return false;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}