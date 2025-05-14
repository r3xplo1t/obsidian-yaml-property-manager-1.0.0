import { App, Modal, Setting } from 'obsidian';
import YAMLPropertyManager from '../../main';

export class QRCodeModal extends Modal {
    plugin: YAMLPropertyManager;
    private imagePath: string;

    constructor(app: App, plugin: YAMLPropertyManager, imagePath: string) {
        super(app);
        this.plugin = plugin;
        this.imagePath = imagePath;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty(); 

        // Add a class to the modal's content element for specific styling
        contentEl.addClass('yaml-property-manager-qr-modal-content');
        // Add a class to the modal's main element for sizing the modal itself if needed
        this.modalEl.addClass('yaml-property-manager-qr-modal-frame');

        // The title creation has been removed.

        const img = contentEl.createEl('img');
        img.setAttribute('src', this.imagePath);
        img.setAttribute('alt', 'Support QR Code'); // Updated alt text
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}