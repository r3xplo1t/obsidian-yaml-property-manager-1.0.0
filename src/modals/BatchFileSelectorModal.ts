import { App, Modal, Notice, TFile, TFolder } from 'obsidian';

export class BatchFileSelectorModal extends Modal {
    onSelect: (files: TFile[]) => void;
    selectedFiles: TFile[] = [];
    
    constructor(app: App, onSelect: (files: TFile[]) => void) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__batch-selector');
        
        // Add header with back button
        const headerContainer = contentEl.createDiv({ cls: 'yaml-header' });
        
        headerContainer.createEl('h2', { text: 'Select Files', cls: 'yaml-header__title' });
        
        // Instructions
        contentEl.createEl('p', { 
            text: 'Select files to apply properties to. Use checkboxes to select individual files or entire folders.'
        });
        
        // File tree container
        const fileTreeContainer = contentEl.createDiv({ cls: 'yaml-file-tree' });
        
        // Selected files count
        const selectedCountEl = contentEl.createEl('div', {
            cls: 'yaml-selected-count',
            text: 'No files selected'
        });
        
        // File tree
        const fileTree = fileTreeContainer.createDiv({ cls: 'yaml-file-tree__container' });
        
        // Add root folder
        this.addFolderToTree(fileTree, this.app.vault.getRoot(), selectedCountEl);
        
        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container yaml-button-container--sticky' });
        
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Apply to Selected Files',
            cls: 'yaml-button yaml-button--confirm yaml-button--disabled'
        });
        
        confirmButton.disabled = true;
        
        confirmButton.addEventListener('click', () => {
            // Make a copy of the selected files
            const selectedFilesCopy = [...this.selectedFiles];
            
            const plugin = (this.app as any).plugins.plugins["yaml-property-manager"];
            if (plugin) {
                plugin.debug(`Batch selector confirming ${selectedFilesCopy.length} files`);
            }
            
            // Call the onSelect callback with the selected files
            this.onSelect(selectedFilesCopy);
            
            // Close this modal
            this.close();
        });
        
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'yaml-button yaml-button--cancel'
        });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }
    
    addFolderToTree(parentEl: HTMLElement, folder: any, selectedCountEl: HTMLElement, level: number = 0) {
        const children = folder.children;
        if (!children) return;
        
        // Sort: folders first, then files
        const sorted = [...children].sort((a, b) => {
            const aIsFolder = a.children !== undefined;
            const bIsFolder = b.children !== undefined;
            
            if (aIsFolder !== bIsFolder) {
                return aIsFolder ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        for (const child of sorted) {
            const isFolder = child.children !== undefined;
            const isMarkdownFile = !isFolder && child instanceof TFile && child.extension === 'md';
            
            // Create main container
            const itemEl = parentEl.createDiv({
                cls: isFolder ? 'yaml-folder-item' : 'yaml-file-item'
            });

            // Store path data attribute on the item itself
            itemEl.setAttribute('data-path', child.path);
            
            // Create header row (contains checkbox, icon, name)
            const headerEl = itemEl.createEl('div', {
                cls: 'yaml-file-tree-header'
            });
            
            // Custom checkbox container
            const checkboxContainer = headerEl.createEl('div', {
                cls: 'yaml-custom-checkbox-container'
            });
            
            // Custom checkbox element
            const checkbox = checkboxContainer.createEl('div', {
                cls: `yaml-custom-checkbox${!isMarkdownFile && !isFolder ? ' yaml-custom-checkbox--disabled' : ''}`
            });

            // Store path data attribute on the checkbox too
            checkbox.setAttribute('data-path', child.path);
            
            // Checkmark that appears when checked
            const checkmark = checkbox.createEl('div', {
                cls: 'yaml-checkbox-checkmark'
            });
            
            // Icon
            const icon = headerEl.createEl('span', { 
                text: isFolder ? '📁 ' : '📄 ',
                cls: isFolder ? 'yaml-folder-icon' : 'yaml-file-icon'
            });
            
            // Name
            headerEl.createEl('span', { 
                text: child.name, 
                cls: isFolder ? 'yaml-folder-name' : 'yaml-file-name' 
            });
            
            // Create container for children if it's a folder
            let childrenContainer: HTMLElement | null = null;
            if (isFolder) {
                childrenContainer = itemEl.createDiv({ 
                    cls: 'yaml-folder-children yaml-folder-children--collapsed'
                });
            }

            // Store the folder path on the children container too
            if (childrenContainer) {
                childrenContainer.setAttribute('data-parent-path', child.path);
            }
            
            // Shared selection logic for both folders and files
            const selectItem = (selected: boolean) => {
                if (selected) {
                    checkbox.classList.add('is-checked');
                    checkmark.classList.add('yaml-checkbox-checkmark--visible');
                } else {
                    checkbox.classList.remove('is-checked');
                    checkmark.classList.remove('yaml-checkbox-checkmark--visible');
                }
                
                if (isFolder) {
                    // Recursively select/deselect all markdown files in the folder
                    const markdownFiles = this.getMarkdownFilesInFolder(child);
                    
                    if (selected) {
                        // Add files not already selected
                        markdownFiles.forEach(file => {
                            if (!this.selectedFiles.includes(file)) {
                                this.selectedFiles.push(file);
                            }
                        });
                    } else {
                        // Remove files in this folder
                        const folderPath = child.path;
                        this.selectedFiles = this.selectedFiles.filter(file => 
                            !file.path.startsWith(folderPath + '/')
                        );
                    }
                    
                    // Update all child checkboxes (even if not expanded)
                    this.updateChildCheckboxes(child, selected);
                } else if (isMarkdownFile) {
                    // For individual markdown files
                    if (selected) {
                        if (!this.selectedFiles.includes(child)) {
                            this.selectedFiles.push(child);
                        }
                    } else {
                        this.selectedFiles = this.selectedFiles.filter(f => f !== child);
                    }
                }
                
                // Update count and button
                this.updateSelectedCount(selectedCountEl);
            };
            
            if (isFolder) {
                // Toggle expand/collapse when clicking on the header (but not checkbox)
                headerEl.addEventListener('click', (e) => {
                    // Don't trigger if clicked on checkbox
                    if (e.target === checkbox || e.target === checkmark || checkboxContainer.contains(e.target as Node)) return;
                    e.stopPropagation();
                    
                    if (childrenContainer) {
                        const isCollapsed = childrenContainer.classList.contains('yaml-folder-children--collapsed');
                        const isChecked = checkbox.classList.contains('is-checked');
                        
                        if (isCollapsed) {
                            // Expanding the folder
                            childrenContainer.classList.remove('yaml-folder-children--collapsed');
                            icon.textContent = '📂 '; // Open folder icon
                            
                            // Load children if not yet loaded
                            if (childrenContainer.childElementCount === 0) {
                                this.addFolderToTree(childrenContainer, child, selectedCountEl, level + 1);
                            }
                            
                            // Use setTimeout to ensure DOM is fully updated before we check children
                            setTimeout(() => {
                                // If this folder is checked, manually check all visible child checkboxes
                                if (isChecked) {
                                    const allChildCheckboxes = childrenContainer.querySelectorAll('.yaml-custom-checkbox');
                                    allChildCheckboxes.forEach(childCheckbox => {
                                        childCheckbox.classList.add('is-checked');
                                        const childCheckmark = childCheckbox.querySelector('.yaml-checkbox-checkmark');
                                        if (childCheckmark) {
                                            childCheckmark.classList.add('yaml-checkbox-checkmark--visible');
                                        }
                                    });
                                }
                                this.syncCheckboxesWithSelection(childrenContainer);
                            }, 0);
                        } else {
                            // Collapsing the folder
                            childrenContainer.classList.add('yaml-folder-children--collapsed');
                            icon.textContent = '📁 '; // Closed folder icon
                        }
                    }
                });
                
                // Custom checkbox click handler for folders
                checkbox.addEventListener('click', (e: MouseEvent) => {
                    e.stopPropagation(); // Prevent parent click
                    
                    const isChecked = checkbox.classList.contains('is-checked');
                    selectItem(!isChecked);
                    
                    // If the folder is expanded and we're checking it, also update visible child checkboxes
                    if (!isChecked && childrenContainer && !childrenContainer.classList.contains('yaml-folder-children--collapsed')) {
                        const allChildCheckboxes = childrenContainer.querySelectorAll('.yaml-custom-checkbox');
                        allChildCheckboxes.forEach(childCheckbox => {
                            childCheckbox.classList.add('is-checked');
                            const childCheckmark = childCheckbox.querySelector('.yaml-checkbox-checkmark');
                            if (childCheckmark) {
                                childCheckmark.classList.add('yaml-checkbox-checkmark--visible');
                            }
                        });
                    }
                    // If the folder is expanded and we're unchecking it, also update visible child checkboxes
                    else if (isChecked && childrenContainer && !childrenContainer.classList.contains('yaml-folder-children--collapsed')) {
                        const allChildCheckboxes = childrenContainer.querySelectorAll('.yaml-custom-checkbox');
                        allChildCheckboxes.forEach(childCheckbox => {
                            childCheckbox.classList.remove('is-checked');
                            const childCheckmark = childCheckbox.querySelector('.yaml-checkbox-checkmark');
                            if (childCheckmark) {
                                childCheckmark.classList.remove('yaml-checkbox-checkmark--visible');
                            }
                        });
                    }
                });
            } else if (isMarkdownFile) {
                // Custom checkbox click handler for markdown files
                checkbox.addEventListener('click', (e: MouseEvent) => {
                    e.stopPropagation(); // Prevent parent click
                    
                    const isChecked = checkbox.classList.contains('is-checked');
                    selectItem(!isChecked);
                });
            } else {
                // Non-markdown files are disabled
                checkbox.classList.add('yaml-custom-checkbox--disabled');
                itemEl.classList.add('yaml-file-item--disabled');
            }
        }
    }
    
    // New method to update child checkboxes recursively
    updateChildCheckboxes(folder: any, selected: boolean) {
        if (!folder.children) return;
        
        for (const child of folder.children) {
            const isMarkdownFile = child instanceof TFile && child.extension === 'md';
            const isFolder = child.children !== undefined;
            
            // Find all elements with this path (there may be multiple due to our enhanced data attributes)
            const elements = this.contentEl.querySelectorAll(`[data-path="${child.path}"]`);
            
            elements.forEach(el => {
                // If this is a checkbox, update its state
                if (el.classList.contains('yaml-custom-checkbox') && (isMarkdownFile || isFolder)) {
                    const checkmark = el.querySelector('.yaml-checkbox-checkmark');
                    
                    if (selected) {
                        el.classList.add('is-checked');
                        if (checkmark) checkmark.classList.add('yaml-checkbox-checkmark--visible');
                    } else {
                        el.classList.remove('is-checked');
                        if (checkmark) checkmark.classList.remove('yaml-checkbox-checkmark--visible');
                    }
                }
            });
            
            // Recursively update child folders
            if (isFolder) {
                this.updateChildCheckboxes(child, selected);
            }
        }
    }
    
    getMarkdownFilesInFolder(folder: any): TFile[] {
        const files: TFile[] = [];
        
        const processFolder = (f: any) => {
            if (!f.children) return;
            
            for (const child of f.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    files.push(child);
                } else if (child.children) {
                    processFolder(child);
                }
            }
        };
        
        processFolder(folder);
        return files;
    }
    
    updateSelectedCount(selectedCountEl: HTMLElement) {
        const count = this.selectedFiles.length;
        selectedCountEl.textContent = count === 0 
            ? 'No files selected' 
            : `${count} ${count === 1 ? 'file' : 'files'} selected`;
        
        // Enable/disable confirm button
        const confirmButton = this.contentEl.querySelector('.yaml-button--confirm') as HTMLButtonElement;
        if (confirmButton) {
            confirmButton.disabled = count === 0;
            if (count === 0) {
                confirmButton.addClass('yaml-button--disabled');
            } else {
                confirmButton.removeClass('yaml-button--disabled');
            }
        }
    }

    // Synchronize checkboxes with the actual selection state
    syncCheckboxesWithSelection(container: HTMLElement) {
    // Process all file checkboxes
    const fileCheckboxes = container.querySelectorAll('.yaml-file-item .yaml-custom-checkbox');
    fileCheckboxes.forEach(checkbox => {
        // Find the associated file path
        const fileNameEl = checkbox.closest('.yaml-file-tree-header')?.querySelector('.yaml-file-name');
        const filePath = fileNameEl?.getAttribute('data-path');
        
        if (filePath) {
            // Check if this file is in the selected files array
            const isSelected = this.selectedFiles.some(file => file.path === filePath);
            
            // Update checkbox state
            if (isSelected) {
                checkbox.classList.add('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkmark.classList.add('yaml-checkbox-checkmark--visible');
            } else {
                checkbox.classList.remove('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkmark.classList.remove('yaml-checkbox-checkmark--visible');
            }
        }
    });

    // Process all folder checkboxes
    const folderCheckboxes = container.querySelectorAll('.yaml-folder-item > .yaml-file-tree-header > .yaml-custom-checkbox-container > .yaml-custom-checkbox');
    folderCheckboxes.forEach(checkbox => {
        // Find the folder path
        const folderNameEl = checkbox.closest('.yaml-file-tree-header')?.querySelector('.yaml-folder-name');
        const folderPath = folderNameEl?.getAttribute('data-path');
        
        if (folderPath) {
            // A folder is "selected" if ALL files within it are selected
            const folderFiles = this.getMarkdownFilesInFolder({path: folderPath, children: this.getFolderByPath(folderPath)?.children});
            const allFilesSelected = folderFiles.length > 0 && folderFiles.every(file => 
                this.selectedFiles.some(selectedFile => selectedFile.path === file.path)
            );
            
            // Update checkbox state
            if (allFilesSelected) {
                checkbox.classList.add('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkmark.classList.add('yaml-checkbox-checkmark--visible');
            } else {
                checkbox.classList.remove('is-checked');
                const checkmark = checkbox.querySelector('.yaml-checkbox-checkmark');
                if (checkmark) checkmark.classList.remove('yaml-checkbox-checkmark--visible');
            }
        }
    });
    }

    // Helper to get a folder by path
    getFolderByPath(path: string): TFolder | null {
    // Root folder case
    if (path === '/') return this.app.vault.getRoot();

    // Try to get the folder directly
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (folder instanceof TFolder) return folder;

    return null;
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}