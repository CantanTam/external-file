const { Plugin, Notice, Menu } = require('obsidian');
const fs = require('fs');
const path = require('path');
const { remote } = require('electron');

module.exports = class ExternalFilePlugin extends Plugin {
    async onload() {
        console.log('ExternalFilePlugin loaded');

        this.basePath = this.app.vault.adapter.getBasePath();
        this.externalFileFolder = path.join(this.basePath, 'ExternalFile');
        this.pluginFolder = path.join(this.basePath, '.obsidian/plugins', this.manifest.id);

        this.ensureDirectoryExists(this.externalFileFolder);
        this.ensureDataFileExists();
        this.ensureCSSFileExists();
        this.updateFolderVisibility();
        this.watchFolder(this.externalFileFolder);
        this.registerEvent(this.app.workspace.on('layout-change', () => this.updateFolderVisibility()));
        this.startFolderMonitoring();
        this.addContextMenuItem();

        this.addCommand({
            id: 'external-file-command',
            name: 'External File Command',
            callback: () => this.showCustomDialog()
        });
    }

    onunload() {
        console.log('ExternalFilePlugin unloaded');
    }

    showCustomDialog() {
        const dialogContainer = document.createElement('div');
        dialogContainer.id = 'custom-dialog';
        dialogContainer.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 300px; height: 100px; background-color: #fff; border: 1px solid #ccc;
        border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); z-index: 9999;
        padding: 15px; text-align: center;
        `;
        dialogContainer.innerHTML = `
        <div id="drop-area" style="border: 2px dashed #ccc; padding: 15px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center; height: 60px; box-sizing: border-box;">
        <span style="white-space: nowrap;">外部 Markdown 拖放到此</span>
        </div>
        `;
        document.body.appendChild(dialogContainer);

        const dropArea = dialogContainer.querySelector('#drop-area');
        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault(); dropArea.style.backgroundColor = '#f0f0f0';
        });
        dropArea.addEventListener('dragleave', () => dropArea.style.backgroundColor = '#fff');
        dropArea.addEventListener('drop', (e) => {
            e.preventDefault(); dropArea.style.backgroundColor = '#fff';
            this.handleFilesDrop(e.dataTransfer.files);
        });
        document.addEventListener('click', (e) => {
            if (!dialogContainer.contains(e.target)) this.closeCustomDialog();
        });
    }

    async handleFilesDrop(files) {
        for (const file of files) {
            if (file.name.endsWith('.md')) await this.handleFileDrop(file.path);
        }
        this.closeCustomDialog();
    }

    async handleFileDrop(filePath) {
        const dataFilePath = path.join(this.pluginFolder, 'data.json');
        let data = fs.existsSync(dataFilePath) ? JSON.parse(fs.readFileSync(dataFilePath, 'utf8')) : {};

        if (data[filePath]) {
            new Notice(`${path.basename(filePath)} 已添加`);
            return;
        }

        const newFileName = `${path.basename(filePath, '.md')}-EXTFILE-${this.getTimestamp()}.md`;
        const newFilePath = path.join(this.externalFileFolder, newFileName);

        data[filePath] = newFileName;
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 4), 'utf8');
        fs.copyFileSync(filePath, newFilePath);
        this.updateFolderVisibility();
    }

    getTimestamp() {
        const now = new Date();
        return `${now.getFullYear()}${this.padZero(now.getMonth() + 1)}${this.padZero(now.getDate())}${this.padZero(now.getHours())}${this.padZero(now.getMinutes())}${this.padZero(now.getSeconds())}`;
    }

    padZero(num) {
        return num < 10 ? '0' + num : num;
    }

    closeCustomDialog() {
        const dialogContainer = document.getElementById('custom-dialog');
        if (dialogContainer) dialogContainer.remove();
    }

    ensureDirectoryExists(folderPath) {
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
    }

    ensureDataFileExists() {
        const dataFilePath = path.join(this.pluginFolder, 'data.json');
        if (!fs.existsSync(dataFilePath)) fs.writeFileSync(dataFilePath, JSON.stringify({}), 'utf8');
    }

    ensureCSSFileExists() {
        const cssFilePath = path.join(this.basePath, '.obsidian/snippets', 'hide-ExternalFile.css');
        if (!fs.existsSync(cssFilePath)) fs.writeFileSync(cssFilePath, '', 'utf8');
    }

    updateFolderVisibility() {
        const hide = fs.readdirSync(this.externalFileFolder).length === 0;
        this.setHideCSS(hide);
    }

    setHideCSS(hide) {
        const cssFilePath = path.join(this.basePath, '.obsidian/snippets', 'hide-ExternalFile.css');
        const cssContent = hide ? `
        .nav-folder-title[data-path="ExternalFile"] { display: none; }
        ` : `
        .nav-folder-title[data-path="ExternalFile"] { opacity: 0.35; }
        .nav-file-title[data-path^="ExternalFile/"] { opacity: 0.35; }
        `;
        fs.writeFileSync(cssFilePath, cssContent, 'utf8');
        this.app.workspace.trigger('css-change');
    }

    watchFolder(folderPath) {
        fs.watch(folderPath, () => {
            this.updateFolderVisibility();
            this.syncDataFileWithFolder();
        });
    }

    syncDataFileWithFolder() {
        const dataFilePath = path.join(this.pluginFolder, 'data.json');
        if (!fs.existsSync(dataFilePath)) return;

        const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
        const files = new Set(fs.readdirSync(this.externalFileFolder));
        for (const [key, value] of Object.entries(data)) {
            if (!files.has(value)) delete data[key];
        }
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 4), 'utf8');
    }

    startFolderMonitoring() {
        this.monitoringInterval = setInterval(() => this.syncDataFileWithFolder(), 1000);
    }

    addContextMenuItem() {
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                const filePath = view.file.path;
                if (filePath.startsWith('ExternalFile/') && filePath.endsWith('.md')) {
                    menu.addItem((item) => {
                        item.setTitle('ExtFile另存为').setIcon('document').onClick(() => {
                            this.handleSaveAs(filePath, editor);
                        });
                    });
                }
            })
        );
    }

    handleSaveAs(filePath, editor) {
        const { dialog } = remote;
        const dataFilePath = path.join(this.pluginFolder, 'data.json');
        if (!fs.existsSync(dataFilePath)) {
            new Notice('数据文件不存在');
            return;
        }

        const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
        const documentName = path.basename(filePath);
        const originalPath = Object.keys(data).find(key => data[key] === documentName);

        if (!originalPath) {
            new Notice('未找到对应的原文件路径');
            return;
        }

        const fullFilePath = path.join(this.basePath, filePath);
        dialog.showSaveDialog({
            defaultPath: originalPath,
                filters: [{ name: 'Markdown Files', extensions: ['md'] }]
        }).then(result => {
            if (!result.canceled && result.filePath) {
                fs.copyFileSync(fullFilePath, result.filePath);
                fs.unlinkSync(fullFilePath);
                new Notice('文件已保存并删除');
            }
        }).catch(err => {
            new Notice('保存文件时出错: ' + err.message);
        });
    }
};
