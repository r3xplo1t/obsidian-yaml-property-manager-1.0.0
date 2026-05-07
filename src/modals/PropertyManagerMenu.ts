import { App, Modal, Notice, MarkdownView, TFile, Setting, ButtonComponent } from 'obsidian';
import YAMLPropertyManagerPlugin from '../../main';
import { TemplateApplication } from './TemplateApplication';
import { BrowserModal } from './BrowserModal';
import { BulkEditor } from './BulkEditor';

export class PropertyManagerMenu extends Modal {
    plugin: YAMLPropertyManagerPlugin;
    applyTemplateButtonComponent: ButtonComponent | null = null;
    bulkEditButtonComponent: ButtonComponent | null = null;
    // Element to display the file count
    private fileCountEl: HTMLElement | null = null;

    constructor(app: App, plugin: YAMLPropertyManagerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('yaml-property-manager-menu');
        this.titleEl.setText('YAML Property Manager');

        // Create file selection section
        this.createFileSelectionSection(contentEl);
    
        // Create batch operations section
        this.createBatchOperationsSection(contentEl);
    
        // Create file counter
        const fileCountContainer = new Setting(contentEl);
        this.fileCountEl = fileCountContainer.descEl;
        
        // Initial update
        this.updateSelectedFilesCount();
    }

    /**
     * Creates the file selection section with buttons
     */
    private createFileSelectionSection(containerEl: HTMLElement) {
        // Section heading
        new Setting(containerEl)
            .setName('File(s) selection options')
            .setHeading()
            .settingEl.setAttrs({ role: 'heading', 'aria-level': '2' });

        // Button: Select Current File (NEW)
        new Setting(containerEl)
        .setName('Current file')
        .setDesc('Select only the currently active file')
        .addButton(button => {
            button
                .setButtonText('Select File')
                .setTooltip('Selects only the currently active file.')
                .onClick(() => {
                    this.selectCurrentFile();
                });
            // Add aria-label for screen readers
            button.buttonEl.setAttribute('aria-label', 'Select only the currently active file');
        });
    
        // Button: Select All in Current Folder
        new Setting(containerEl)
            .setName('Current folder')
            .setDesc('Select all Markdown files in the currently active file\'s folder')
            .addButton(button => {
                button
                    .setButtonText('Select Files')
                    .setTooltip('Selects all Markdown files directly within the currently active file\'s folder.')
                    .onClick(() => {
                        this.selectFilesInCurrentFolder();
                    });
                // Add aria-label for screen readers
                button.buttonEl.setAttribute('aria-label', 'Select all Markdown files in the currently active file\'s folder');
            });

        // Button: Select All in Current Folder and Subfolders
        new Setting(containerEl)
            .setName('Current folder and subfolders')
            .setDesc('Select all Markdown files in the current folder and all its subfolders')
            .addButton(button => {
                 button
                    .setButtonText('Select Files')
                    .setTooltip('Selects all Markdown files in the current folder and all its subfolders.')
                    .onClick(() => {
                        this.selectFilesInCurrentFolderAndSubfolders();
                    });
                // Add aria-label for screen readers
                button.buttonEl.setAttribute('aria-label', 'Select all Markdown files in the current folder and all its subfolders');
            });


        // Button: Browse and Select Files
        new Setting(containerEl)
            .setName('Manual selection')
            .setDesc('Browse and select specific files or folders from your vault')
            .addButton(button => {
                 button
                    .setButtonText('Browse Files')
                    .setTooltip('Manually select specific files or folders from your vault.')
                    .onClick(() => {
                        this.browseFiles();
                    });
                // Add aria-label for screen readers
                button.buttonEl.setAttribute('aria-label', 'Browse and manually select specific files or folders from your vault');
            });

    }

    /**
     * Selects only the current active file
     */
    private selectCurrentFile() {
        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file) {
                new Notice('No file is currently active');
                return;
            }

            const currentFile = activeView.file;
            if (!(currentFile instanceof TFile) || currentFile.extension !== 'md') {
                new Notice('The current file is not a Markdown file');
                return;
            }

            this.plugin.selectedFiles = [currentFile];
            this.updateSelectedFilesCount();
        } catch (error) {
            console.error(`[YAML Property Manager] Error selecting current file: ${error}`);
            new Notice('Failed to select current file');
        }
    }

    /**
     * Selects all Markdown files in the current folder
     */
    private selectFilesInCurrentFolder() {
        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file) {
                new Notice('No file is currently active');
                return;
            }

            const currentFolder = activeView.file.parent;
            if (!currentFolder) {
                new Notice('Could not determine current folder');
                return;
            }

            this.plugin.selectedFiles = this.app.vault.getMarkdownFiles()
                .filter(file => file.parent?.path === currentFolder.path); // More robust parent check

            // Add a warning if too many files are selected
            if (this.plugin.selectedFiles.length > 100) {
                new Notice(`Selected ${this.plugin.selectedFiles.length} files. Processing large numbers of files may be slow.`, 8000);
            }

            this.updateSelectedFilesCount();
        } catch (error) {
            console.error(`[YAML Property Manager] Error selecting files in current folder: ${error}`);
            new Notice('Failed to select files in current folder');
        }
    }

    /**
     * Selects all Markdown files in the current folder and subfolders
     */
    private selectFilesInCurrentFolderAndSubfolders() {
        try {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file) {
                new Notice('No file is currently active');
                return;
            }

            const currentFolder = activeView.file.parent;
            if (!currentFolder) {
                new Notice('Could not determine current folder');
                return;
            }

            const currentFolderPath = currentFolder.path === '/' ? '' : currentFolder.path + '/';
            // Correct logic to include files IN the current folder AND subfolders
            this.plugin.selectedFiles = this.app.vault.getMarkdownFiles()
                .filter(file => file.path.startsWith(currentFolderPath)); // Simpler check: starts with path


            // Add a warning if too many files are selected
            if (this.plugin.selectedFiles.length > 100) {
                new Notice(`Selected ${this.plugin.selectedFiles.length} files. Processing large numbers of files may be slow.`, 8000);
            }

            this.updateSelectedFilesCount();
        } catch (error) {
            console.error(`[YAML Property Manager] Error selecting files in folder and subfolders: ${error}`);
            new Notice('Failed to select files in folder and subfolders');
        }
    }

    /**
     * Creates the batch operations section with buttons
     */
    private createBatchOperationsSection(containerEl: HTMLElement) {
        // Section heading
        new Setting(containerEl)
            .setName('Batch operations')
            .setHeading()
            .settingEl.setAttrs({ role: 'heading', 'aria-level': '2' }); // Accessibility

        // Button: Apply Template to Selected Files
        const applyTemplateSetting = new Setting(containerEl)
            .setName('Apply template')
            .setDesc('Apply properties from a template file to the selected files');

        // Create and store the button component
        applyTemplateSetting.addButton(button => {
            // Store reference to the button
            this.applyTemplateButtonComponent = button;

             button
                .setButtonText('Apply Template')
                .setCta() // Primary action
                .setDisabled(this.plugin.selectedFiles.length === 0)
                .onClick(() => {
                    if (this.plugin.selectedFiles.length > 0) {
                        this.close();
                        new TemplateApplication(this.app, this.plugin, this.plugin.selectedFiles).open();
                    } else {
                        new Notice('Please select files first');
                    }
                });
             // Add aria-label
             button.buttonEl.setAttribute('aria-label', 'Apply properties from a template file to the selected files');
        });

        // Button: Bulk Edit Properties
        const bulkEditSetting = new Setting(containerEl)
            .setName('Bulk edit')
            .setDesc('View and edit properties common across the selected files');

        // Create and store the button component
        bulkEditSetting.addButton(button => {
            // Store reference to the button
            this.bulkEditButtonComponent = button;

             button
                .setButtonText('Edit Properties')
                .setCta() // <<< Added .setCta() here
                .setDisabled(this.plugin.selectedFiles.length === 0)
                .onClick(() => {
                    if (this.plugin.selectedFiles.length > 0) {
                        this.close();
                        new BulkEditor(this.app, this.plugin, [...this.plugin.selectedFiles]).open();
                    } else {
                        new Notice('Please select files first');
                    }
                });
            // Add aria-label
            button.buttonEl.setAttribute('aria-label', 'View and edit properties common across the selected files');
        });
    }


    /**
     * Gets the text for the selection counter
     */
    private getSelectionCountText(): string {
        const count = this.plugin.selectedFiles.length;
        if (count === 0) {
            return 'No files selected';
        } else if (count === 1) {
            return '1 file selected';
        } else {
            return `${count} files selected`;
        }
    }

    /**
     * Updates the file selection counter display - Changed to use dedicated div
     */
    updateSelectedFilesCount() {
        if (this.fileCountEl) {
            this.fileCountEl.empty();
            this.fileCountEl.setText(this.getSelectionCountText());

            // Add aria-live region for screen readers
            this.fileCountEl.setAttrs({
                'aria-live': 'polite',
                'role': 'status'
            });
        }

        // Update button states
        this.updateButtonState();
    }

    /**
     * Updates the enabled/disabled state of action buttons
     */
    updateButtonState() {
        const hasSelection = this.plugin.selectedFiles.length > 0;

        // Using Obsidian's built-in disabled state handling
        this.applyTemplateButtonComponent?.setDisabled(!hasSelection);
        this.bulkEditButtonComponent?.setDisabled(!hasSelection);
    }

    /**
     * Opens the browser modal to select files
     */
    browseFiles() {
        try {
            // Create an array of existing paths to highlight
            const existingPaths = this.plugin.selectedFiles.map(file => ({
                type: 'file' as 'file' | 'directory', // Explicit type casting
                path: file.path
            }));

            const browser = new BrowserModal(
                this.app,
                this.plugin,
                (result) => {
                    // Check if files were selected (result might be empty)
                    if (result.files) { // Check if files property exists
                        // Store files in the plugin's storage
                        this.plugin.selectedFiles = [...result.files];

                        // Update the count display AFTER the selection is made
                        this.updateSelectedFilesCount();
                    }
                    // If the user cancelled, result might be different, handle appropriately if needed
                },
                {
                    title: "Select Files",
                    description: "Select files to process. Use checkboxes to select individual files or entire folders.",
                    confirmButtonText: "Confirm Selection", // Changed text
                    existingPathsToHighlight: existingPaths
                }
            );
            browser.open();
        } catch (error) {
            console.error(`[YAML Property Manager] Error opening file browser: ${error}`);
            new Notice('Failed to open file browser');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}