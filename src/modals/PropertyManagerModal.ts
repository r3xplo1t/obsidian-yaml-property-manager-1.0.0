import { App, Modal, Notice, MarkdownView, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { TemplateSelectionModal } from './TemplateSelectionModal';
import { BatchFileSelectorModal } from './BatchFileSelectorModal';
import { BulkPropertyEditorModal } from './BulkPropertyEditorModal';

export class PropertyManagerModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    selectedFiles: TFile[] = [];
    
    constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
        super(app);
        this.plugin = plugin;
    }
    
    // Modified PropertyManagerModal class onOpen method
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Apply window-specific class
        contentEl.addClass('yaml-window');
        contentEl.addClass('yaml-window__property-manager');
        
        contentEl.createEl('h2', { text: 'YAML Property Manager', cls: 'yaml-header__title' });
        
        // Actions container
        const actionsContainer = contentEl.createDiv({ cls: 'yaml-actions' });
        
        // Only create the batch container
        const batchContainer = actionsContainer.createDiv({ cls: 'yaml-action-section' });
        batchContainer.createEl('h3', { text: 'Batch Operations' });
        
        // File selection
        batchContainer.createEl('p', { text: 'Select files to process:' });
        
        // Add buttons directly to batch container
        const currentFolderButton = batchContainer.createEl('button', { 
            text: 'Select All in Current Folder',
            cls: 'yaml-button yaml-button--file-selection'
        });
        
        currentFolderButton.addEventListener('click', () => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file) {
                const currentFolder = activeView.file.parent;
                if (currentFolder) {
                    // Store files in the plugin's central storage
                    this.plugin.selectedFiles = this.app.vault.getMarkdownFiles()
                        .filter(file => file.parent === currentFolder);
                    
                    this.plugin.debug(`Selected ${this.plugin.selectedFiles.length} files from current folder`);
                    this.updateSelectedFilesCount();
                }
            } else {
                new Notice('No file is currently active');
            }
        });
        
        const browseButton = batchContainer.createEl('button', { 
            text: 'Browse and Select Files',
            cls: 'yaml-button yaml-button--file-selection'
        });
        
        browseButton.addEventListener('click', () => {
            this.browseFiles();
        });
        
        // Apply template button
        const applyTemplateButton = batchContainer.createEl('button', {
            text: 'Apply Template to Selected Files',
            cls: 'yaml-button yaml-button--primary'
        });
        
        applyTemplateButton.disabled = this.plugin.selectedFiles.length === 0;
        if (this.plugin.selectedFiles.length === 0) {
            applyTemplateButton.addClass('yaml-button--disabled');
        }
        
        applyTemplateButton.addEventListener('click', () => {
            if (this.plugin.selectedFiles.length > 0) {
                this.plugin.navigateToModal(this, 'template');
            } else {
                new Notice('Please select files first');
            }
        });

        // Bulk edit button
        const bulkEditButton = batchContainer.createEl('button', {
            text: 'Bulk Edit Properties',
            cls: 'yaml-button yaml-button--bulk-edit'
        });
        
        bulkEditButton.disabled = this.plugin.selectedFiles.length === 0;
        if (this.plugin.selectedFiles.length === 0) {
            bulkEditButton.addClass('yaml-button--disabled');
        }
        
        bulkEditButton.addEventListener('click', () => {
            this.plugin.debug(`Bulk edit clicked with ${this.plugin.selectedFiles.length} files selected`);
            
            if (this.plugin.selectedFiles.length > 0) {
                this.plugin.navigateToModal(this, 'bulkEdit');
            } else {
                new Notice('Please select files first');
            }
        });

        // Add divider before counter
        const divider = batchContainer.createEl('hr', { cls: 'yaml-action-section__divider' });
        
        // Files counter at the bottom with special styling
        const selectedFilesCountEl = batchContainer.createDiv({
            cls: 'yaml-file-selection__count yaml-direct-path-container'
        });
        
        selectedFilesCountEl.createSpan({
            text: this.plugin.selectedFiles.length > 0 
                ? `${this.plugin.selectedFiles.length} ${this.plugin.selectedFiles.length === 1 ? 'file' : 'files'} selected` 
                : 'No files selected',
            cls: 'yaml-direct-path-text'
        });
    }
    
    updateSelectedFilesCount() {
        const countEl = this.contentEl.querySelector('.yaml-file-selection__count');
        if (countEl) {
            const textSpan = countEl.querySelector('.yaml-direct-path-text');
            if (textSpan) {
                textSpan.textContent = this.plugin.selectedFiles.length === 0 
                    ? 'No files selected' 
                    : `${this.plugin.selectedFiles.length} files selected`;
            }
        }
        
        // Enable/disable buttons
        this.updateButtonState();
    }

    updateButtonState() {
        // Enable/disable buttons
        const buttons = this.contentEl.querySelectorAll('.yaml-button--primary, .yaml-button--bulk-edit') as NodeListOf<HTMLButtonElement>;
        buttons.forEach(button => {
            button.disabled = this.plugin.selectedFiles.length === 0;
            
            if (this.plugin.selectedFiles.length === 0) {
                button.addClass('yaml-button--disabled');
            } else {
                button.removeClass('yaml-button--disabled');
            }
        });
    }

    browseFiles() {
        const batchSelector = new BatchFileSelectorModal(this.app, (files: TFile[]) => {
            if (files && files.length > 0) {
                this.plugin.debug(`Received ${files.length} files from batch selection`);
                
                // Store files in the plugin's storage
                this.plugin.selectedFiles = [...files];
                
                // Reopen main modal to show updated selection
                this.plugin.navigateToModal(this, 'main');
            }
        });
        batchSelector.open();
    }
}