import { App, Modal, TFile } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';

export class BulkPropertyEditorModal extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    files: TFile[];

    constructor(app: App, plugin: YAMLPropertyManagerPlugin, files: TFile[]) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('yaml-window__bulk-editor');
                
        // Empty modal with no content

        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: 'yaml-button-container' });

        // Apply button
        const applyButton = buttonContainer.createEl('button', { 
            text: 'Apply Changes',
            cls: 'bulk-editor-button bulk-editor-button--apply'
        });
        
        applyButton.disabled = true;  // Initially disabled until changes are made
        applyButton.addClass('bulk-editor-button--disabled');
        
        applyButton.addEventListener('click', async () => {
            // This will be implemented in a future feature
            // For now, just close the modal
            this.close();
        });
        
        // Close button
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'bulk-editor-button bulk-editor-button--cancel'
        });

        cancelButton.addEventListener('click', () => {
            this.plugin.navigateToModal(this, 'main');
        });
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}