import { App, Modal, TFile, Setting, ButtonComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import type { PropertyWithType } from '../PropertyTypeService';

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
        contentEl.empty();
        
        // Main header
        new Setting(contentEl)
            .setName('Bulk Property Editor')
            .setHeading();
            
        // Add description
        new Setting(contentEl)
            .setDesc(`Viewing common properties across ${this.files.length} files.`);
            
        // Content container for properties list
        const propertiesContainer = contentEl.createDiv({ 
            cls: 'property-list-container'
        });
        
        // Loading indicator
        const loadingEl = propertiesContainer.createEl('div', {
            cls: 'property-loading-container',
            text: 'Loading properties...'
        });
        
        try {
            // We'll implement property loading later
            await this.loadProperties(propertiesContainer);
            loadingEl.remove();
        } catch (error) {
            console.error('Error loading properties:', error);
            loadingEl.setText('Error loading properties. Please try again.');
            loadingEl.addClass('property-error');
        }
        
        // Button container at the bottom of the modal
        const buttonContainer = this.modalEl.createDiv({ 
            cls: 'modal-button-container' 
        });
        
        // Cancel button
        const cancelButton = new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.plugin.navigateToModal(this, 'main');
            });
            
        // Apply button
        const applyButton = new ButtonComponent(buttonContainer)
            .setButtonText('Apply Changes')
            .setCta() // Makes it the primary action button
            .setDisabled(true) // Initially disabled
            .onClick(() => {
                // We'll implement this later
                this.applyChanges();
            });
    }
    
    // Placeholder for property loading implementation
    async loadProperties(container: HTMLElement) {
        // We'll implement this later
        container.createEl('div', {
            cls: 'property-empty-state',
            text: 'No common properties found across the selected files.'
        });
    }
    
    // Placeholder for applying changes
    async applyChanges() {
        // We'll implement this later
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}