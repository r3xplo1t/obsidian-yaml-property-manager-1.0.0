# YAML Property Manager

An [Obsidian](https://obsidian.md) plugin for managing YAML frontmatter properties across your notes. Select files from a visual file browser, edit properties in bulk, and apply templates — all without touching raw YAML.

---

## Features

### File Browser
A tree-based file picker that lets you select individual notes or entire folders before performing any operation. Supports partial folder selection (mixed state), real-time selection counts, and remembers your previous selection when reopening.

### Bulk Property Editor
Open the editor with any set of selected files and see every YAML property found across them in one unified view. For each property you can:

- Enable or disable it for the current operation
- Change its type (text, number, date, date & time, checkbox, list, list of properties, tags, aliases)
- Edit its value, with per-file overrides for files where the value differs
- Expand or collapse the row to show or hide file-level detail
- Reorder properties by dragging

Master controls at the top let you enable/disable all properties at once and expand/collapse all rows in one click.

### Template Application
Choose a template file from your configured template folders (or search the entire vault) and apply its properties to any number of notes. Per-property controls let you include or exclude individual properties and choose whether to override values that already exist in the target files.

---

## Commands

The plugin registers three commands accessible from the Command Palette (`Ctrl/Cmd + P`):

| Command | Description |
|---|---|
| Open Property Manager | Opens the main menu to access all features |
| Apply Template to Current File | Applies a template directly to the active note |
| Apply Template to Multiple Files | Opens the file browser to select files, then applies a template |

---

## Installation

### Manual Installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/r3xplo1t/obsidian-yaml-property-manager/releases/latest)
2. Create a folder at `<your vault>/.obsidian/plugins/yaml-property-manager/`
3. Place the three files inside that folder
4. Reload Obsidian and enable the plugin under **Settings** → **Community plugins**

---

## Settings

### Template Paths
Add files or folders from your vault as template sources. Templates listed here appear in the template suggester when you run Apply Template. You can add multiple paths and remove them individually.

### Max Recent Templates
Controls how many recently used templates are remembered and shown at the top of the template suggester. Default is 5.

### Recent Templates
Clear the list of recently used templates.

---

## Workarounds

### Adding a New Property Across Multiple Files

The Bulk Property Editor only shows properties that already exist in the selected files. If you want to introduce a brand new property and deploy it across many notes, use the Template Application workflow instead:

1. Create a note to serve as your template (or use an existing one). Add the new property to its YAML frontmatter with a default value, for example:
   ```yaml
   ---
   status: draft
   ---
   ```
2. Open the Command Palette (`Ctrl/Cmd + P`) and run **Apply Template to Multiple Files**
3. In the File Browser, select all the notes you want to update and click **Confirm**
4. In the template suggester, choose the template note you prepared
5. In the Template Application modal, make sure the new property is set to **Include**. Exclude any other properties from the template that you do not want to touch
6. Leave **Override All Values** off if the property already exists in some files and you want to keep their current values — or turn it on to overwrite everything with the template value
7. Click **Apply**

The new property will be added to every selected file. Files that already had the property keep their value unless Override All Values was enabled.

---

## Compatibility

- Minimum Obsidian version: **1.5.0**
- Desktop only (Windows, macOS, Linux)

---

## Support

If you find this plugin useful, you can support its development here:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow)](https://www.buymeacoffee.com/r3xplo1t)

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Robert Aikler-L.
